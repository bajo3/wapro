import { verify, TokenExpiredError, JsonWebTokenError } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

import AppError from "../errors/AppError";
import authConfig from "../config/auth";

interface TokenPayload {
  id: string;
  username: string;
  profile: string;
  iat: number;
  exp: number;
}

const isAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError("ERR_SESSION_EXPIRED", 401);
  }

  const [, token] = authHeader.split(" ");

  try {
    const decoded = verify(token, authConfig.secret);
    const { id, profile } = decoded as TokenPayload;

    req.user = {
      id,
      profile
    };
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      // Token expirado — expected case, warn only with type (no stack trace)
      console.warn(`[auth] auth_error_type=token_expired auth_route=${req.path}`);
      throw new AppError("ERR_SESSION_EXPIRED", 401);
    }
    if (err instanceof JsonWebTokenError) {
      console.warn(`[auth] auth_error_type=invalid_token auth_route=${req.path}`);
      throw new AppError("ERR_SESSION_EXPIRED", 401);
    }
    throw new AppError("ERR_SESSION_EXPIRED", 401);
  }

  return next();
};

export default isAuth;
