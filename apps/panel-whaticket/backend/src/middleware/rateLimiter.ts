import rateLimit, {
  type RateLimitRequestHandler
} from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";
import type { Request, Response, NextFunction } from "express";

let redisClient: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL);
    console.log("Redis connected for rate limiting");
  } catch (err) {
    console.warn("Redis not available, using memory store");
  }
}

export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient
    ? {
        store: new RedisStore({
          sendCommand: (...args: string[]) =>
            redisClient!.call(args[0], ...args.slice(1))
        })
      }
    : {})
});

type UserLimiterOptions = {
  windowMs?: number;
  max?: number;
  message?: string;
};

export const createUserBasedLimiter = (
  options: UserLimiterOptions = {}
): RateLimitRequestHandler => {
  const {
    windowMs = 60_000,
    max = 20,
    message = "Too many requests"
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) =>
      req.user?.id
        ? `user-${req.user.id}`
        : `ip-${req.ip || "unknown"}`
  });
};

const isWhitelisted = (ip: string | undefined): boolean => {
  if (!ip) return false;
  return (process.env.RATE_LIMIT_WHITELIST || "")
    .split(",")
    .includes(ip);
};

export const conditionalRateLimit = (
  limiter: RateLimitRequestHandler
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isWhitelisted(req.ip)) return next();
    return limiter(req, res, next);
  };
};
