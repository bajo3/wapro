import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
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

// --- CORS ---
// FRONTEND_URL can be a comma-separated allowlist of origins.
// Examples:
//   FRONTEND_URL="https://panel-front-end-production.up.railway.app,http://localhost:3000"
// Supports simple wildcard entries like:
//   FRONTEND_URL="https://*.up.railway.app"
const normalizeOrigin = (v: string) => v.trim().replace(/\/+$/, "");

const corsOptions: CorsOptions = {
  credentials: true,
  origin: (origin, cb) => {
    // Allow non-browser requests (no Origin).
    if (!origin) return cb(null, true);

    const raw = String(process.env.FRONTEND_URL || "").trim();
    if (!raw) return cb(null, true);

    const reqOrigin = normalizeOrigin(origin);

    const allowed = raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(normalizeOrigin);

    const isAllowed = allowed.some(entry => {
      if (entry.includes("*")) {
        // Convert "https://*.up.railway.app" -> /^https:\/\/.*\.up\.railway\.app$/i
        const esc = entry
          .replace(/[.+?^${}()|[\]\]/g, "\$&")
          .replace(/\\*/g, ".*");
        const re = new RegExp(`^${esc}$`, "i");
        return re.test(reqOrigin);
      }
      return entry === reqOrigin;
    });

    return cb(null, isAllowed);
  }
};

// Ensure preflight always returns the proper CORS headers.
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
