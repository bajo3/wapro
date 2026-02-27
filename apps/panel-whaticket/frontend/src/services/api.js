import axios from "axios";
import { getBackendUrl } from "../config";

const api = axios.create({
  baseURL: getBackendUrl(),
  withCredentials: true,
});

// --- Global auth interceptors (avoid race conditions) ---
// Some pages (e.g. Connections) fire requests on mount, before the Auth hook
// has time to register interceptors. That caused noisy 401s in the console and
// UI glitches. We install a single set of interceptors here, once.
if (!api.__authInterceptorsInstalled) {
  api.__authInterceptorsInstalled = true;

  api.interceptors.request.use(
    (config) => {
      const raw = localStorage.getItem("token");
      if (!raw) {
        if (config?.headers) delete config.headers.Authorization;
        return config;
      }

      let token;
      try {
        token = JSON.parse(raw);
      } catch {
        token = raw;
      }

      // Some deployments store `{ token: "..." }` or similar.
      // Normalize aggressively to avoid sending `Bearer [object Object]`.
      if (token && typeof token === "object") {
        token = token.token || token.accessToken || token.jwt || token.value;
      }

      if (typeof token === "string") {
        // strip accidental quotes
        token = token.replace(/^\"|\"$/g, "").trim();
      }

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else if (config?.headers) {
        delete config.headers.Authorization;
      }

      return config;
    },
    (error) => Promise.reject(error)
  );

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const hasAccessToken = !!localStorage.getItem("token");

      // --- Rate limit (429) backoff ---
      // The Panel can fire bursts of GETs (mount + polling). If the backend rate-limits,
      // do a short exponential backoff and retry a couple of times to avoid error loops.
      try {
        const status = error?.response?.status;
        const url = String(originalRequest?.url || "");
        const method = String(originalRequest?.method || "get").toLowerCase();

        const shouldHandle429 =
          status === 429 &&
          !!originalRequest &&
          method === "get" &&
          !url.includes("/auth/login") &&
          !url.includes("/auth/refresh_token");

        if (shouldHandle429) {
          originalRequest.__retry429Count = Number(originalRequest.__retry429Count || 0) + 1;
          if (originalRequest.__retry429Count <= 2) {
            const retryAfterRaw =
              error?.response?.headers?.["retry-after"] || error?.response?.headers?.["Retry-After"];
            const retryAfterSec = Number.parseInt(String(retryAfterRaw || ""), 10);

            const base = 800; // ms
            const exp = base * Math.pow(2, originalRequest.__retry429Count - 1);
            const delayMs =
              Number.isFinite(retryAfterSec) && retryAfterSec > 0
                ? Math.min(5000, retryAfterSec * 1000)
                : Math.min(4000, exp);

            await new Promise((r) => setTimeout(r, delayMs));
            return api(originalRequest);
          }
        }
      } catch {
        // ignore
      }

      if (
        (error?.response?.status === 401 || error?.response?.status === 403) &&
        originalRequest &&
        !originalRequest._retry &&
        hasAccessToken &&
        !String(originalRequest.url || "").includes("/auth/refresh_token")
      ) {
        originalRequest._retry = true;

        try {
          const { data } = await api.post("/auth/refresh_token");
          if (data?.token) {
            localStorage.setItem("token", JSON.stringify(data.token));
            api.defaults.headers.common.Authorization = `Bearer ${data.token}`;
          }
          return api(originalRequest);
        } catch (err) {
          localStorage.removeItem("token");
          delete api.defaults.headers.common.Authorization;
          // Avoid endless refresh loops: force navigation back to login.
          try {
            window.location.href = "/login";
          } catch {}
          return Promise.reject(err);
        }
      }

      return Promise.reject(error);
    }
  );
}

export default api;
