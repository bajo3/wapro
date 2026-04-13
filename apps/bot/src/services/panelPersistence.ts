import fetch from 'node-fetch';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { evolutionSendImage, evolutionSendText } from './evolution.js';
import { isBotReplyEnabled } from './botReplyGate.js';

// ─── BOT_ADMIN_TOKEN guard ────────────────────────────────────────────────────
// Reads directly from process.env (not env.ts) so this assertion is meaningful
// even if env.ts validation is bypassed (e.g. tests, partial boot).
// Throws loudly — no silent fallback, no default value.
function assertBotAdminToken(): string {
  const token = process.env.BOT_ADMIN_TOKEN;
  if (!token) {
    console.error(JSON.stringify({
      level: 'critical',
      message: 'BOT_ADMIN_TOKEN missing',
      service: 'bot-control',
      timestamp: new Date().toISOString(),
    }));
    throw new Error('BOT_ADMIN_TOKEN not configured');
  }
  return token;
}

/**
 * Last-resort fallback when BOT_ADMIN_TOKEN is unavailable.
 *
 * At the persistence layer we have no conversation context (instance/remoteJid)
 * so we cannot call setConversationRule() for a real handoff — that must happen
 * upstream in webhooks.ts when a missing token is detected before a send.
 *
 * What this function CAN do:
 *  - Preserve the payload in the dead-letter file for manual replay / ops audit
 *  - Emit a warning so ops monitoring sees the event
 *
 * TODO: If this function is ever called with conversation context available,
 *       import setConversationRule from rules.ts and call:
 *       await setConversationRule(instance, remoteJid, 'HUMAN_ONLY')
 */
async function safeFallbackToHuman({
  reason,
  payload,
}: {
  reason: string;
  payload?: object;
}): Promise<void> {
  try {
    if (payload) {
      // Reuse existing dead-letter mechanism — preserves record for ops replay
      await writeToDeadLetter(payload, reason);
    }
    // TODO: wire real handoff here when conversation context is available upstream
  } catch (fallbackError) {
    console.error(JSON.stringify({
      level: 'critical',
      message: 'Fallback to human failed',
      timestamp: new Date().toISOString(),
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    }));
  }
}

// ─── Retry & dead-letter config ───────────────────────────────────────────────
const PERSIST_MAX_RETRIES = 3;
const PERSIST_RETRY_BASE_MS = 1000; // 1s, 3s, 9s (exponential backoff base 3)
const DEAD_LETTER_FILE = process.env.PERSIST_DEAD_LETTER_FILE || '/tmp/wapro_failed_messages.jsonl';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashString(str: string): string {
  return createHash('sha1').update(str).digest('hex');
}

function normalizeRemoteJid(remoteJidOrNumber: string): string {
  const raw = String(remoteJidOrNumber || '').trim();
  if (!raw) return '';
  return raw.includes('@') ? raw : `${raw}@s.whatsapp.net`;
}

function extractNumber(remoteJidOrNumber: string): string {
  return normalizeRemoteJid(remoteJidOrNumber).split('@')[0] || '';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Append a failed message to the dead-letter file for later inspection or replay.
 * Best-effort: if the write fails we log but never throw.
 */
async function writeToDeadLetter(payload: object, reason: string): Promise<void> {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    reason,
    payload,
  });
  try {
    await fsp.appendFile(DEAD_LETTER_FILE, entry + '\n');
    console.error(
      `[PERSIST_FAILED] Lead message written to dead-letter queue (${DEAD_LETTER_FILE}).`,
      { reason }
    );
  } catch (writeErr) {
    // File write failed — still log so there's an observable trace
    console.error(
      '[PERSIST_FAILED] Could not write to dead-letter file. Message is lost.',
      { reason, writeErr }
    );
  }
  // Emit ops-level alert so monitoring can pick it up
  console.error('[PERSIST_FAILED] ⚠️  A bot message failed to reach the panel after all retries. ' +
    'Check panel connectivity and BOT_ADMIN_TOKEN. Details:', { reason });
}

// ─── Core persist function (with retry) ──────────────────────────────────────

interface PersistPayload {
  id: string;        // was syntheticId — controller reads body.id
  instance: string;
  remoteJid: string;
  text: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fromMe: boolean;
  ack: number;
  read: boolean;
  ticketStatus: string | null;
  botMode: string | null;
  handoff: boolean;
}

/**
 * Single fetch attempt. Returns `true` on HTTP 2xx, throws on network error.
 */
async function attemptPersist(backendUrl: string, adminToken: string, body: PersistPayload): Promise<boolean> {
  const response = await fetch(`${backendUrl}/webhooks/bot/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: JSON.stringify(body),
  });

  if (response.ok) return true;

  const responseBody = await response.text().catch(() => '');
  console.error('[panelPersistence] HTTP error persisting bot message', {
    status: response.status,
    statusText: response.statusText,
    body: responseBody.slice(0, 300),
    instance: body.instance,
    remoteJid: body.remoteJid,
  });
  // Treat 4xx as non-retriable (misconfiguration), 5xx as retriable
  if (response.status >= 400 && response.status < 500) {
    throw Object.assign(new Error(`HTTP ${response.status} — not retrying`), { fatal: true });
  }
  // 5xx — return false so caller retries
  return false;
}

/**
 * Persist with retry and dead-letter fallback.
 * - Up to PERSIST_MAX_RETRIES attempts with exponential backoff (1s, 3s, 9s)
 * - On final failure: write to dead-letter file and emit ops alert
 */
async function persistWithRetry(
  backendUrl: string,
  adminToken: string,
  body: PersistPayload
): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= PERSIST_MAX_RETRIES; attempt++) {
    try {
      const ok = await attemptPersist(backendUrl, adminToken, body);
      if (ok) {
        if (attempt > 1) {
          console.log(`[panelPersistence] message persisted on attempt ${attempt}`);
        }
        return;
      }
      // Non-2xx but retriable — wait then retry
      if (attempt < PERSIST_MAX_RETRIES) {
        const delayMs = PERSIST_RETRY_BASE_MS * Math.pow(3, attempt - 1);
        console.warn(`[panelPersistence] attempt ${attempt} failed (non-2xx), retrying in ${delayMs}ms…`);
        await sleep(delayMs);
      }
    } catch (err: any) {
      lastError = err;
      if (err?.fatal) {
        // 4xx fatal: no point retrying
        await writeToDeadLetter(body, String(err.message));
        return;
      }
      if (attempt < PERSIST_MAX_RETRIES) {
        const delayMs = PERSIST_RETRY_BASE_MS * Math.pow(3, attempt - 1);
        console.warn(`[panelPersistence] attempt ${attempt} network error, retrying in ${delayMs}ms…`, err);
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  await writeToDeadLetter(body, lastError ? String((lastError as any).message ?? lastError) : 'all_retries_exhausted');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function persistBotOutboundMessage(params: {
  instance: string;
  remoteJid: string;
  text?: string;
  imageUrl?: string;
  mediaType?: string | null;
  ack?: number;
  read?: boolean;
  ticketStatus?: 'pending' | 'open' | 'closed';
  botMode?: 'ON' | 'OFF' | 'HUMAN_ONLY';
  handoff?: boolean;
}): Promise<void> {
  // ── TASK 1: controlled fallback — never drop silently ─────────────────────
  let BOT_ADMIN_TOKEN: string;
  try {
    BOT_ADMIN_TOKEN = assertBotAdminToken();
  } catch (error) {
    console.error(JSON.stringify({
      level: 'critical',
      message: 'BOT_ADMIN_TOKEN failure - fallback triggered',
      service: 'bot-control',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }));
    // TASK 3: metric event — countable in Railway logs / external log tools
    console.log(JSON.stringify({
      type: 'metric',
      metric: 'bot_admin_token_failure',
      value: 1,
      timestamp: new Date().toISOString(),
    }));
    // TASK 2: preserve payload for ops replay; emit ops-visible warning
    await safeFallbackToHuman({ reason: 'bot_admin_token_missing', payload: params });
    return; // stop normal execution safely — WhatsApp msg already sent by caller
  }

  const backendUrl = String(process.env.BACKEND_URL || '').replace(/\/$/, '');
  const remoteJid = normalizeRemoteJid(params.remoteJid);
  const text = String(params.text || '').trim();
  const imageUrl = typeof params.imageUrl === 'string' && params.imageUrl.trim() ? params.imageUrl.trim() : undefined;
  if (!backendUrl || !remoteJid || (!text && !imageUrl)) return;

  const number = extractNumber(remoteJid);
  if (!number) return;

  const syntheticId = `bot-${params.instance}-${number}-${Date.now()}-${hashString(`${text}|${imageUrl || ''}`)}`;

  const body: PersistPayload = {
    id: syntheticId,
    instance: params.instance,
    remoteJid,
    text,
    mediaUrl: imageUrl || null,
    mediaType: params.mediaType ?? (imageUrl ? 'image' : null),
    fromMe: true,
    ack: Number.isFinite(Number(params.ack)) ? Number(params.ack) : 1,
    read: params.read !== false,
    ticketStatus: params.ticketStatus ?? null,
    botMode: params.botMode ?? null,
    handoff: Boolean(params.handoff),
  };

  await persistWithRetry(backendUrl, BOT_ADMIN_TOKEN, body);
}

export async function sendTextAndPersist(
  instance: string,
  remoteJidOrNumber: string,
  text: string,
  options?: {
    ticketStatus?: 'pending' | 'open' | 'closed';
    botMode?: 'ON' | 'OFF' | 'HUMAN_ONLY';
    handoff?: boolean;
  }
): Promise<void> {
  const remoteJid = normalizeRemoteJid(remoteJidOrNumber);
  const number = extractNumber(remoteJid);
  const body = String(text || '').trim();
  if (!number || !body) {
    console.warn(`[send] sendTextAndPersist skipped reason=${!number ? 'no_number' : 'empty_text'} instance=${instance} input=${remoteJidOrNumber}`);
    return;
  }

  // ── Gate central de bot replies ───────────────────────────────────────────
  if (!isBotReplyEnabled()) {
    console.log(`[bot] reply blocked: bot disabled (silent mode) → ${number}`);
    return;
  }

  await evolutionSendText(instance, number, body);
  await persistBotOutboundMessage({
    instance,
    remoteJid,
    text: body,
    mediaType: null,
    ticketStatus: options?.ticketStatus,
    botMode: options?.botMode,
    handoff: options?.handoff,
  });
}

export async function sendImageAndPersist(
  instance: string,
  remoteJidOrNumber: string,
  imageUrl: string,
  caption?: string,
  options?: {
    ticketStatus?: 'pending' | 'open' | 'closed';
    botMode?: 'ON' | 'OFF' | 'HUMAN_ONLY';
    handoff?: boolean;
  }
): Promise<void> {
  const remoteJid = normalizeRemoteJid(remoteJidOrNumber);
  const number = extractNumber(remoteJid);
  const url = String(imageUrl || '').trim();
  const text = String(caption || '').trim();
  if (!number || !url) return;

  // ── Gate central de bot replies ───────────────────────────────────────────
  if (!isBotReplyEnabled()) {
    console.log(`[bot] image blocked: bot disabled (silent mode) → ${number}`);
    return;
  }

  await evolutionSendImage(instance, number, url, text || undefined);
  await persistBotOutboundMessage({
    instance,
    remoteJid,
    text,
    imageUrl: url,
    mediaType: 'image',
    ticketStatus: options?.ticketStatus,
    botMode: options?.botMode,
    handoff: options?.handoff,
  });
}
