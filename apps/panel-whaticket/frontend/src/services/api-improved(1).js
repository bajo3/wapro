import axios from "axios";
import { getBackendUrl } from "../config";

const api = axios.create({
  baseURL: getBackendUrl(),
  withCredentials: true,
  timeout: 30000, // 30 segundos timeout
});

// Contador de reintentos
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 segundo

// Helper para esperar
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper para determinar si un error es retryable
const isRetryableError = (error) => {
  if (!error.response) {
    // Error de red (sin respuesta del servidor)
    return true;
  }
  
  const status = error.response.status;
  // Retry en errores 5xx y 429 (too many requests)
  return status >= 500 || status === 429;
};

// --- Global auth interceptors (avoid race conditions) ---
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

      // Agregar retry counter a la config
      if (!config.retryCount) {
        config.retryCount = 0;
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

      // Handle 401/403 with refresh token
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
          localStorage.removeItem("userId");
          delete api.defaults.headers.common.Authorization;
          
          // Force navigation to login
          try {
            window.location.href = "/login";
          } catch {}
          return Promise.reject(err);
        }
      }

      // Retry logic para errores retryables
      if (
        isRetryableError(error) &&
        originalRequest &&
        originalRequest.retryCount < MAX_RETRIES &&
        !originalRequest._retry // No hacer retry si ya estamos en refresh token
      ) {
        originalRequest.retryCount += 1;
        
        // Esperar antes de reintentar (exponential backoff)
        const retryDelay = RETRY_DELAY * Math.pow(2, originalRequest.retryCount - 1);
        await delay(retryDelay);
        
        console.log(
          `Retrying request to ${originalRequest.url} (attempt ${originalRequest.retryCount}/${MAX_RETRIES})`
        );
        
        return api(originalRequest);
      }

      // Si llegamos aquí, no pudimos recuperarnos del error
      return Promise.reject(error);
    }
  );
}

// Agregar método helper para requests con loading state
api.withLoading = async (request, setLoading) => {
  try {
    if (setLoading) setLoading(true);
    const response = await request();
    return response;
  } catch (error) {
    throw error;
  } finally {
    if (setLoading) setLoading(false);
  }
};

export default api;
