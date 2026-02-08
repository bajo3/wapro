import { Response } from "express";

export const SendRefreshToken = (res: Response, token: string): void => {
  // In production the panel frontend and backend are usually on different domains.
  // Modern browsers block cross-site cookies unless SameSite=None + Secure.
  // Railway frequently doesn't provide BACKEND_URL/PUBLIC_URL envs by default,
  // so infer "production" more robustly.
  const prod =
    String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
    !!process.env.RAILWAY_ENVIRONMENT ||
    !!process.env.RAILWAY_PUBLIC_DOMAIN ||
    String(process.env.FRONTEND_URL || "").startsWith("https://") ||
    String(process.env.BACKEND_URL || "").startsWith("https://") ||
    String(process.env.PUBLIC_URL || "").startsWith("https://") ||
    String(process.env.API_URL || "").startsWith("https://");

  res.cookie("jrt", token, {
    httpOnly: true,
    path: "/",
    sameSite: prod ? "none" : "lax",
    secure: prod
  });
};
