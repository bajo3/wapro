import { logger } from "../../utils/logger";
import { forwardBotAdmin } from "./forwardBotAdmin";

const BOT_URL = String(process.env.BOT_URL || "").replace(/\/$/, "");
const BOT_WEBHOOK_SECRET = String(process.env.BOT_WEBHOOK_SECRET || "");
const BOT_ADMIN_TOKEN = String(process.env.BOT_ADMIN_TOKEN || "");

function isConfigured(): boolean {
  return !!BOT_URL;
}

export async function botForwardEvolutionWebhook(payload: any): Promise<void> {
  if (!isConfigured() || !BOT_WEBHOOK_SECRET) return;

  try {
    const url = `${BOT_URL}/webhooks/evolution`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": BOT_WEBHOOK_SECRET
      } as any,
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      logger.warn({ status: r.status, text }, "botForwardEvolutionWebhook failed");
    }
  } catch (err: any) {
    logger.warn({ err: String(err?.message ?? err) }, "botForwardEvolutionWebhook error");
  }
}

export interface BotModeResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Sets the conversation mode on the bot service.
 * Returns { ok, status, error } so callers can detect failure and show feedback to operators.
 * A failed call means the panel and bot are out of sync — the operator must be informed.
 */
export async function botSetConversationMode(params: {
  instance: string;
  remoteJid: string;
  botMode: "ON" | "OFF" | "HUMAN_ONLY";
  notes?: string;
}): Promise<BotModeResult> {
  if (!isConfigured() || !BOT_ADMIN_TOKEN) {
    // Bot not configured — treat as soft success (no bot to change mode on)
    return { ok: true, status: 0 };
  }

  try {
    const r = await forwardBotAdmin({
      path: "/admin/conversation-rules",
      method: "POST",
      body: {
        instance: params.instance,
        remoteJid: params.remoteJid,
        botMode: params.botMode,
        notes: params.notes
      },
      context: "botSetConversationMode"
    });

    if (!r.ok) {
      const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {});
      logger.warn({ status: r.status, text }, "botSetConversationMode failed");
      return { ok: false, status: r.status, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, status: r.status };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    logger.warn({ err: msg }, "botSetConversationMode error");
    return { ok: false, status: 0, error: msg };
  }
}

export async function botDeleteConversationRule(params: {
  instance: string;
  remoteJid: string;
}): Promise<BotModeResult> {
  if (!isConfigured() || !BOT_ADMIN_TOKEN) {
    return { ok: true, status: 0 };
  }

  try {
    const r = await forwardBotAdmin({
      path: `/admin/conversation-rules/${encodeURIComponent(params.instance)}/${encodeURIComponent(params.remoteJid)}`,
      method: "DELETE",
      context: "botDeleteConversationRule"
    });

    if (!r.ok) {
      const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {});
      logger.warn({ status: r.status, text }, "botDeleteConversationRule failed");
      return { ok: false, status: r.status, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, status: r.status };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    logger.warn({ err: msg }, "botDeleteConversationRule error");
    return { ok: false, status: 0, error: msg };
  }
}

export async function botIngestEpisode(params: {
  channel?: string;
  contact_id?: string | null;
  user_text: string;
  reply_text: string;
  meta?: any;
}): Promise<void> {
  if (!isConfigured() || !BOT_ADMIN_TOKEN) return;

  try {
    const r = await forwardBotAdmin({
      path: "/admin/intelligence/episodes/ingest",
      method: "POST",
      body: {
        channel: params.channel ?? "WHATSAPP",
        contact_id: params.contact_id ?? null,
        user_text: params.user_text,
        reply_text: params.reply_text,
        meta: params.meta ?? {}
      },
      context: "botIngestEpisode"
    });

    if (!r.ok) {
      const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {});
      logger.warn({ status: r.status, text }, "botIngestEpisode failed");
    }
  } catch (err: any) {
    logger.warn({ err: String(err?.message ?? err) }, "botIngestEpisode error");
  }
}
