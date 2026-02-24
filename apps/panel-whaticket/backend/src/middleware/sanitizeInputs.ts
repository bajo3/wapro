import { Request, Response, NextFunction } from "express";

// Prevent prototype-pollution vectors in JSON payloads.
function stripDangerousKeys(value: any): any {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = stripDangerousKeys(value[i]);
    return value;
  }

  // eslint-disable-next-line no-prototype-builtins
  if (value.hasOwnProperty("__proto__")) delete value.__proto__;
  // eslint-disable-next-line no-prototype-builtins
  if (value.hasOwnProperty("constructor")) delete value.constructor;
  // eslint-disable-next-line no-prototype-builtins
  if (value.hasOwnProperty("prototype")) delete value.prototype;

  for (const k of Object.keys(value)) {
    value[k] = stripDangerousKeys(value[k]);
  }
  return value;
}

export function sanitizeInputs(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = stripDangerousKeys(req.body);
  return next();
}
