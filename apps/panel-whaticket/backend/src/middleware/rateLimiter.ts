import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";
import type { Request, Response, NextFunction } from "express";

// Redis client (opcional; si no hay REDIS_URL, se usa el store en memoria)
let redisClient: Redis | undefined;
try {
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
  }
} catch (_error) {
  console.warn("Redis not available for rate limiting, using memory store");
  redisClient = undefined;
}

const storeIfRedis = (prefix: string) =>
  redisClient
    ? new RedisStore({
        // rate-limit-redis espera un cliente compatible; ioredis funciona OK.
        client: redisClient as unknown as any,
        prefix,
      })
    : undefined;

// Rate limiter general para toda la API
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana por IP
  message: {
    error: "Demasiadas solicitudes desde esta IP, por favor intenta nuevamente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:general:") ? { store: storeIfRedis("rl:general:") } : {}),
  skip: (req: Request) => {
    const skipPaths = ["/health", "/metrics"];
    return skipPaths.includes(req.path);
  },
});

// Rate limiter estricto para login
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: {
    error: "Demasiados intentos de inicio de sesión. Por favor intenta nuevamente en 15 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:login:") ? { store: storeIfRedis("rl:login:") } : {}),
  skipSuccessfulRequests: true,
});

// Rate limiter para creación de recursos
export const createLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: {
    error: "Estás creando recursos demasiado rápido. Por favor espera un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:create:") ? { store: storeIfRedis("rl:create:") } : {}),
});

// Rate limiter para envío de mensajes
export const messageLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  message: {
    error: "Estás enviando mensajes demasiado rápido. Por favor espera un momento.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:message:") ? { store: storeIfRedis("rl:message:") } : {}),
});

// Rate limiter para webhooks entrantes
export const webhookLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60,
  message: {
    error: "Demasiados webhooks recibidos. Por favor verifica tu configuración.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:webhook:") ? { store: storeIfRedis("rl:webhook:") } : {}),
  keyGenerator: (req: Request): string => {
    // Rate limit por IP y por apiKey si existe
    const apiKey =
      (req.headers["x-api-key"] as string | undefined) ||
      (typeof req.query.apiKey === "string" ? req.query.apiKey : undefined);
    return apiKey ? `${req.ip}-${apiKey}` : req.ip;
  },
});

export type UserLimiterOptions = {
  windowMs?: number;
  max?: number;
  message?: string;
};

// Rate limiter flexible basado en usuario autenticado
export const createUserBasedLimiter = (
  options: UserLimiterOptions = {}
): RateLimitRequestHandler => {
  const { windowMs = 60 * 1000, max = 20, message = "Límite de solicitudes excedido" } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(storeIfRedis("rl:user:") ? { store: storeIfRedis("rl:user:") } : {}),
    keyGenerator: (req: Request): string => {
      const userId = (req as any).user?.id as string | number | undefined;
      return userId ? `user-${userId}` : `ip-${req.ip}`;
    },
  });
};

// Helper para verificar si una IP está en whitelist
const isWhitelisted = (ip: string): boolean => {
  const whitelist = (process.env.RATE_LIMIT_WHITELIST || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return whitelist.includes(ip);
};

// Middleware para skipear rate limiting en IPs whitelistadas
export const conditionalRateLimit = (limiter: RateLimitRequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isWhitelisted(req.ip)) return next();
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
