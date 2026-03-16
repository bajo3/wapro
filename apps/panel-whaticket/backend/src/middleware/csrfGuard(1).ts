import { Request, Response, NextFunction } from "express";

/**
 * Minimal CSRF protection for cookie-based auth flows.
 *
 * If your authentication uses cookies (credentials: true), then mutating requests
 * should only be accepted from allowed browser origins.
 *
 * This guard is intentionally simple:
 * - Only checks mutating methods.
 * - Only blocks when the request includes an Origin header (browser request).
 * - Uses FRONTEND_URL allow-list (comma-separated) like CORS.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  const method = String(req.method || "GET").toUpperCase();
  const isMutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (!isMutating) return next();

  const origin = String(req.headers.origin || "").trim();
  if (!origin) return next(); // non-browser / no-origin requests

  const raw = String(process.env.FRONTEND_URL || "").trim();
  if (!raw) return next();

  const allowed = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (allowed.includes(origin)) return next();
  return res.status(403).json({ error: "ERR_CSRF_ORIGIN_NOT_ALLOWED" });
}
