import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import AppError from "./errors/AppError";
import routes from "./routes";
import { generalLimiter } from "./middleware/rateLimiter";
import { securityHeaders } from "./middleware/securityHeaders";
import { sanitizeInputs } from "./middleware/sanitizeInputs";
import { csrfGuard } from "./middleware/csrfGuard";
import { logger } from "./utils/logger";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// Reduce fingerprinting.
app.disable("x-powered-by");

// Needed when running behind proxies (Railway, Nginx, etc.) so secure cookies
// and other proxy-aware features behave correctly.
app.set("trust proxy", 1);

// --- CORS -------------------------------------------------------------
// Railway/Vercel frontends often differ only by subdomain. We support:
// - exact origins: https://panel-front-end-production.up.railway.app
// - comma-separated list in FRONTEND_URL
// - simple wildcard patterns like: https://*.up.railway.app
const normalizeOrigin = (o: string) => o.replace(/\/$/, "");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternToRegExp = (pattern: string) => {
  // Convert '*' to '.*' while escaping other regex chars.
  const escaped = pattern
    .split("*")
    .map(part => escapeRegExp(part))
    .join(".*");
  return new RegExp(`^${escaped}$`);
};

const rawFrontend = String(process.env.FRONTEND_URL || "").trim();
const allowList = rawFrontend
  ? rawFrontend
      .split(",")
      .map(s => normalizeOrigin(s.trim()))
      .filter(Boolean)
  : [];

const allowMatchers = allowList.map(p => {
  if (p.includes("*")) {
    return (origin: string) => patternToRegExp(p).test(origin);
  }
  return (origin: string) => origin === p;
});

const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, cb) => {
    // Non-browser requests (curl, server-to-server) won't have Origin.
    if (!origin) return cb(null, true);

    const o = normalizeOrigin(origin);

    // If FRONTEND_URL not set, default to permissive (avoids hard lockouts).
    if (allowMatchers.length === 0) return cb(null, true);

    const allowed = allowMatchers.some(match => match(o));
    if (allowed) return cb(null, true);

    return cb(new Error(`Not allowed by CORS: ${o}`));
  }
};

// Ensure preflight (OPTIONS) always gets CORS headers before csrf/auth/ratelimit.
app.options("*", cors(corsOptions));

app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeInputs);
app.use(csrfGuard);
app.use(generalLimiter);
app.use(Sentry.Handlers.requestHandler());
app.use("/public", express.static(uploadConfig.directory));
app.use(routes);

app.use(Sentry.Handlers.errorHandler());

app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn({ err }, "Handled AppError");
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
