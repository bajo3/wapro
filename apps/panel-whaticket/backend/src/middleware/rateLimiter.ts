import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";
import type { Request, Response, NextFunction } from "express";

// Redis client (opcional; si no hay REDIS_URL, se usa el store en memoria)
let redisClient: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL);
    // eslint-disable-next-line no-console
    console.log("Redis connected for rate limiting");
  } catch (_error) {
    // eslint-disable-next-line no-console
    console.warn("Redis not available for rate limiting, using memory store");
    redisClient = null;
  }
}

// Crea un store Redis compatible con rate-limit-redis (v3+)
// Nota: rate-limit-redis espera un sendCommand estilo node-redis.
// Con ioredis usamos call() y casteamos el tipo para satisfacer TS (strict).
const storeIfRedis = (prefix: string) => {
  if (!redisClient) return undefined;

  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => {
      // args[0] = comando (GET/SET/INCR/etc)
      // ioredis.call devuelve Promise<any>; casteamos para cumplir con RedisReply.
      return (redisClient as Redis).call(args[0], ...args.slice(1)) as any;
    },
  });
};

// Rate limiter general para toda la API
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Demasiadas solicitudes desde esta IP, por favor intenta nuevamente más tarde." },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:general:") ? { store: storeIfRedis("rl:general:") } : {}),
  skip: (req: Request) => ["/health", "/metrics"].includes(req.path),
});

// Rate limiter estricto para login
export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Demasiados intentos de inicio de sesión. Por favor intenta nuevamente en 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:login:") ? { store: storeIfRedis("rl:login:") } : {}),
  skipSuccessfulRequests: true,
});

// Rate limiter para creación de recursos
export const createLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Estás creando recursos demasiado rápido. Por favor espera un momento." },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:create:") ? { store: storeIfRedis("rl:create:") } : {}),
});

// Rate limiter para envío de mensajes
export const messageLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Estás enviando mensajes demasiado rápido. Por favor espera un momento." },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:message:") ? { store: storeIfRedis("rl:message:") } : {}),
});

// Rate limiter para webhooks entrantes
export const webhookLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Demasiados webhooks recibidos. Por favor verifica tu configuración." },
  standardHeaders: true,
  legacyHeaders: false,
  ...(storeIfRedis("rl:webhook:") ? { store: storeIfRedis("rl:webhook:") } : {}),
  keyGenerator: (req: Request): string => {
    const apiKey =
      (req.headers["x-api-key"] as string | undefined) ||
      (typeof req.query.apiKey === "string" ? req.query.apiKey : undefined);
    const ip = req.ip || "unknown";
    return apiKey ? `${ip}-${apiKey}` : ip;
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
      return userId ? `user-${userId}` : `ip-${req.ip || "unknown"}`;
    },
  });
};

// Helper para verificar si una IP está en whitelist
const isWhitelisted = (ip: string | undefined): boolean => {
  if (!ip) return false;
  const whitelist = (process.env.RATE_LIMIT_WHITELIST || "")
    .split(",")
    .map((s) => s.trim())
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
