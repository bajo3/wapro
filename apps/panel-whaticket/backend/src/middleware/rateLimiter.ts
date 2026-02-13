import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";

// Configurar Redis client (opcional, si está disponible)
let redisClient;
try {
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
  }
} catch (error) {
  console.warn("Redis not available for rate limiting, using memory store");
}

// Rate limiter general para toda la API
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Límite de 100 requests por ventana por IP
  message: {
    error: "Demasiadas solicitudes desde esta IP, por favor intenta nuevamente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Usar Redis si está disponible, sino usar memoria
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: "rl:general:",
    }),
  }),
  // No aplicar rate limit a estas rutas
  skip: (req) => {
    const skipPaths = ["/health", "/metrics"];
    return skipPaths.includes(req.path);
  },
});

// Rate limiter estricto para login
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Solo 5 intentos de login
  message: {
    error: "Demasiados intentos de inicio de sesión. Por favor intenta nuevamente en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: "rl:login:",
    }),
  }),
  skipSuccessfulRequests: true, // No contar requests exitosos
});

// Rate limiter para creación de recursos
export const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // Máximo 10 creaciones por minuto
  message: {
    error: "Estás creando recursos demasiado rápido. Por favor espera un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: "rl:create:",
    }),
  }),
});

// Rate limiter para envío de mensajes
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // Máximo 30 mensajes por minuto
  message: {
    error: "Estás enviando mensajes demasiado rápido. Por favor espera un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: "rl:message:",
    }),
  }),
});

// Rate limiter para webhooks entrantes
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // Máximo 60 webhooks por minuto
  message: {
    error: "Demasiados webhooks recibidos. Por favor verifica tu configuración.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: "rl:webhook:",
    }),
  }),
  keyGenerator: (req) => {
    // Rate limit por IP y por apiKey si existe
    const apiKey = req.headers["x-api-key"] || req.query.apiKey;
    return apiKey ? `${req.ip}-${apiKey}` : req.ip;
  },
});

// Rate limiter flexible basado en usuario autenticado
export const createUserBasedLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000,
    max = 20,
    message = "Límite de solicitudes excedido",
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(redisClient && {
      store: new RedisStore({
        client: redisClient,
        prefix: "rl:user:",
      }),
    }),
    keyGenerator: (req) => {
      // Rate limit por userId si está autenticado, sino por IP
      return req.user?.id ? `user-${req.user.id}` : `ip-${req.ip}`;
    },
  });
};

// Helper para verificar si una IP está en whitelist
const isWhitelisted = (ip) => {
  const whitelist = (process.env.RATE_LIMIT_WHITELIST || "").split(",");
  return whitelist.includes(ip);
};

// Middleware para skipear rate limiting en IPs whitelistadas
export const conditionalRateLimit = (limiter) => {
  return (req, res, next) => {
    if (isWhitelisted(req.ip)) {
      return next();
    }
    return limiter(req, res, next);
  };
};

export default {
  general: generalLimiter,
  login: loginLimiter,
  create: createLimiter,
  message: messageLimiter,
  webhook: webhookLimiter,
  createUserBased: createUserBasedLimiter,
  conditional: conditionalRateLimit,
};
