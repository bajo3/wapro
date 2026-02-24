import { Request, Response, NextFunction } from "express";

/**
 * Lightweight security headers without extra dependencies.
 *
 * We intentionally keep this compatible with the current stack (Express + MUI v4 app)
 * and avoid introducing new packages that would require lockfile churn.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // Intentionally not setting CSP here because the front-end bundle and inline styles
  // vary by deployment. If you want CSP, add it at the reverse-proxy (Nginx) layer.
  return next();
}
