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
import { logger } from "./utils/logger";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// Needed when running behind proxies (Railway, Nginx, etc.) so secure cookies
// and other proxy-aware features behave correctly.
app.set("trust proxy", 1);

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Allow non-browser requests (no Origin) and allow-list configured origins.
      if (!origin) return cb(null, true);

      const raw = String(process.env.FRONTEND_URL || "").trim();
      if (!raw) return cb(null, true);

      const allowed = raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      if (allowed.includes(origin)) return cb(null, true);

      // If misconfigured, fail closed with a clear message.
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    }
  })
);
app.use(cookieParser());
app.use(express.json());
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
