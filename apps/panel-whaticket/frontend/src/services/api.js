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

      if (
        (error?.response?.status === 401 || error?.response?.status === 403) &&
        originalRequest &&
        !originalRequest._retry &&
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
          return Promise.reject(err);
        }
      }

      return Promise.reject(error);
    }
  );
}

export default api;
