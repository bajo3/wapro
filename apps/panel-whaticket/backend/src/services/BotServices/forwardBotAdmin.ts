import fetch from "node-fetch";

import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

const BOT_URL = String(process.env.BOT_URL || "").replace(/\/$/, "");
const BOT_ADMIN_TOKEN = String(process.env.BOT_ADMIN_TOKEN || "");

export interface BotForwardResult {
  ok: boolean;
  status: number;
  data: any;
}

export function ensureBotAdminConfigured(): void {
  if (!BOT_URL || !BOT_ADMIN_TOKEN) {
    throw new AppError("ERR_BOT_NOT_CONFIGURED", 503);
  }
}

function getBotTimeoutMs(): number {
  return Math.max(1000, Number(process.env.BOT_HTTP_TIMEOUT_MS ?? "15000"));
}

function getBotRetryCount(): number {
  return Math.max(0, Number(process.env.BOT_HTTP_RETRIES ?? "1"));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function parseBotResponse(r: any): Promise<any> {
  const text = await r.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function forwardBotAdmin(params: {
  path: string;
  method?: string;
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  context: string;
}): Promise<BotForwardResult> {
  ensureBotAdminConfigured();

  const method = String(params.method ?? "GET").toUpperCase();
  const timeoutMs = getBotTimeoutMs();
  const retries = getBotRetryCount();
  const url = new URL(`${BOT_URL}${params.path}`);

  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const r = await fetch(url.toString(), {
        method,
        headers: {
          "content-type": "application/json",
          "x-admin-token": BOT_ADMIN_TOKEN
        } as any,
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(params.body ?? {}),
        signal: controller.signal as any
      } as any);

      clearTimeout(timer);
      const data = await parseBotResponse(r);

      if (!r.ok) {
        logger.warn(
          {
            context: params.context,
            path: params.path,
            status: r.status,
            attempt,
            data: typeof data === "string" ? data.slice(0, 300) : data
          },
          "bot forward non-2xx"
        );
      }

      if (r.ok || !isRetriableStatus(r.status) || attempt > retries) {
        return { ok: r.ok, status: r.status, data };
      }
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      const isTimeout = String(err?.name) === "AbortError";
      logger.warn(
        {
          context: params.context,
          path: params.path,
          attempt,
          timeoutMs,
          error: String(err?.message ?? err),
          isTimeout
        },
        "bot forward error"
      );

      if (attempt > retries) {
        if (isTimeout) throw new AppError("ERR_BOT_TIMEOUT", 504);
        throw new AppError("ERR_BOT_UNAVAILABLE", 502);
      }
    }
  }

  logger.warn(
    {
      context: params.context,
      path: params.path,
      error: String((lastError as any)?.message ?? lastError ?? "unknown")
    },
    "bot forward exhausted retries"
  );
  throw new AppError("ERR_BOT_UNAVAILABLE", 502);
}
