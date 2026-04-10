import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// ─── In-memory rate limiter ────────────────────────────────────────────────────
type RateBucket = { count: number; windowStart: number };
function createRateLimiter(windowMs: number, maxRequests: number, message = 'Too many requests') {
  const buckets = new Map<string, RateBucket>();
  setInterval(() => {
    const threshold = Date.now() - windowMs * 2;
    for (const [key, bucket] of buckets) {
      if (bucket.windowStart < threshold) buckets.delete(key);
    }
  }, windowMs).unref();

  return (req: any, res: any, next: any) => {
    const ip = String(req.ip ?? req.connection?.remoteAddress ?? 'unknown');
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(ip, bucket);
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      return res.status(429).json({ ok: false, error: message });
    }
    return next();
  };
}

const webhookLimiter = createRateLimiter(60_000, 300, 'Webhook rate limit exceeded');
const adminLimiter   = createRateLimiter(60_000, 60,  'Admin rate limit exceeded');

import http from "http";
import { Server } from "socket.io";
import { setSocket } from "./services/socket.js";
import { pool } from "./services/db.js";

import { env } from "./lib/env.js";
import { migrate } from "./services/db.js";
import { webhookRouter } from "./routes/webhooks.js";
import { adminRouter } from "./routes/admin.js";
import { getSocket } from "./services/socket.js";
import { setState } from "./services/state.js";
import { getConversationRule } from "./services/rules.js";
import { getContactRule } from "./services/contacts.js";
import { scanRecentVehiclesForDemandMatches, runRecontactJob } from "./services/demands.js";
import { sendTextAndPersist } from "./services/panelPersistence.js";
import { logAiRuntimeStartup, resolveAiRuntime } from "./services/aiRuntime.js";
import { runMeliSync } from "./services/meliSync.js";

async function main() {
  await migrate();
  logAiRuntimeStartup(resolveAiRuntime(), 'startup', 'startup_boot');

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("combined"));

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: true,
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  setSocket(io);

  io.on("connection", (socket) => {
    console.log("[bot] socket connected:", socket.id);
    socket.on("disconnect", () => console.log("[bot] socket disconnected:", socket.id));
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/webhooks", webhookLimiter, webhookRouter);
  app.use("/admin", adminLimiter, adminRouter);

  httpServer.listen(env.port, () => {
    console.log(`[bot] listening on :${env.port}`);
  });

  // ── Dedupe purge — every 24h, delete entries older than 7 days ────────────────
  setInterval(async () => {
    try {
      await pool.query("delete from bot_messages_dedupe where received_at < now() - interval '7 days'");
    } catch (e) {
      console.error('Failed to purge bot_messages_dedupe', e);
    }
  }, 24 * 60 * 60 * 1000);

  // ── Follow-up job — every hour ────────────────────────────────────────────────
  const FOLLOWUP_MS = Number(process.env.BOT_FOLLOWUP_MS ?? String(48 * 60 * 60 * 1000));
  const convRuleCache = new Map<string, { value: string | null; ts: number }>();
  const contactRuleCache = new Map<string, { value: string | null; ts: number }>();
  const RULE_CACHE_TTL_MS = 5 * 60 * 1000;

  async function getCachedConversationRule(instance: string, remoteJid: string) {
    const key = `${instance}:${remoteJid}`;
    const nowTs = Date.now();
    const cached = convRuleCache.get(key);
    if (cached && nowTs - cached.ts < RULE_CACHE_TTL_MS) return cached.value;
    try {
      const value = await getConversationRule(instance, remoteJid);
      convRuleCache.set(key, { value, ts: nowTs });
      return value;
    } catch { return null; }
  }

  async function getCachedContactRule(number: string) {
    const nowTs = Date.now();
    const cached = contactRuleCache.get(number);
    if (cached && nowTs - cached.ts < RULE_CACHE_TTL_MS) return cached.value;
    try {
      const value = await getContactRule(number);
      contactRuleCache.set(number, { value, ts: nowTs });
      return value;
    } catch { return null; }
  }

  let followUpJobRunning = false;

  setInterval(async () => {
    if (followUpJobRunning) return;
    followUpJobRunning = true;
    try {
      const instance = env.instanceName;
      const res = await pool.query(
        "select remote_jid, state from bot_conversations where instance=$1 and coalesce((state->>'followup_sent')::boolean, false) = false",
        [instance]
      );
      const rows = res.rows ?? [];
      const now = Date.now();
      for (const row of rows) {
        const remoteJid = row.remote_jid as string;
        const state = row.state as any;
        if (!state) continue;
        try {
          const convRule = await getCachedConversationRule(instance, remoteJid);
          if (convRule && convRule !== 'ON') continue;
          const number = remoteJid.split('@')[0];
          const contactRule = await getCachedContactRule(number);
          if (contactRule && contactRule !== 'ON') continue;
        } catch { continue; }
        if (state.followup_sent) continue;
        const lastReplyIso = state.last_bot_reply_at || state.lastBotAt;
        const lastReply = lastReplyIso ? Date.parse(lastReplyIso) : NaN;
        if (Number.isNaN(lastReply)) continue;
        if (now - lastReply < FOLLOWUP_MS) continue;
        const intent = state.last_intent || '';
        const interestedIntents = ['product_results', 'price_request', 'product_results_single', 'option_selected'];
        if (!interestedIntents.includes(intent)) continue;
        const query = state.last_query || 'tu consulta';
        const firstHit = Array.isArray(state.last_hits) && state.last_hits.length > 0 ? state.last_hits[0] : null;
        const vehicleRef = firstHit
          ? (firstHit.name || `${firstHit.brand ?? ''} ${firstHit.model ?? ''}`.trim() || query)
          : query;
        const followupText = firstHit
          ? `Hola, ¿seguís viendo el ${vehicleRef}? Todavía lo tenemos. Si querés coordinar algo o te quedó alguna duda, avisame.`
          : `Hola, ¿seguís buscando ${query}? Por cualquier consulta estamos.`;
        try {
          await sendTextAndPersist(instance, remoteJid, followupText);
          const iso = new Date().toISOString();
          await setState(instance, remoteJid, {
            ...state,
            followup_sent: true,
            followup_sent_at: iso,
            lastBotAt: iso,
            last_bot_reply_at: iso,
          } as any);
          const sock = getSocket();
          sock?.emit('send.message', { instance, number: remoteJid.split('@')[0], text: followupText, imageUrl: null });
        } catch (err) {
          console.error('Failed to send follow-up', err);
        }
      }
    } catch (err) {
      console.error('Failed follow-up job', err);
    } finally {
      followUpJobRunning = false;
    }
  }, 60 * 60 * 1000);

  // ── Demand scan — every 5 min ─────────────────────────────────────────────────
  const DEMAND_SCAN_MS = Number(process.env.DEMAND_SCAN_MS ?? String(5 * 60 * 1000));
  const DEMAND_SCAN_LOOKBACK_MIN = Number(process.env.DEMAND_SCAN_LOOKBACK_MIN ?? '10');
  const DEMAND_MATCH_THRESHOLD = Number(process.env.DEMAND_MATCH_THRESHOLD ?? '0.45');

  setInterval(async () => {
    try {
      const since = new Date(Date.now() - Math.max(1, DEMAND_SCAN_LOOKBACK_MIN) * 60_000);
      const result = await scanRecentVehiclesForDemandMatches({ since, threshold: DEMAND_MATCH_THRESHOLD });
      const io = getSocket();
      io?.emit('vehicle_demand_scan', { ok: true, since: since.toISOString(), ...result });
    } catch (e) {
      console.error('Failed vehicle demand scan', e);
    }
  }, Math.max(60_000, DEMAND_SCAN_MS));

  // ── Recontact job — every 10 min ──────────────────────────────────────────────
  const RECONTACT_SCAN_MS = Number(process.env.RECONTACT_SCAN_MS ?? String(10 * 60 * 1000));
  setInterval(async () => {
    try {
      const r = await runRecontactJob();
      const io = getSocket();
      io?.emit('vehicle_demand_recontact', { ok: true, ...r });
    } catch (e) {
      console.error('Failed recontact job', e);
    }
  }, Math.max(60_000, RECONTACT_SCAN_MS));

  // ── MercadoLibre sync — every 3h ──────────────────────────────────────────────
  const MELI_SYNC_MS = 3 * 60 * 60 * 1000;
  let meliSyncRunning = false;

  if (process.env.MELI_CLIENT_ID && process.env.MELI_CLIENT_SECRET) {
    setTimeout(async () => {
      try {
        console.log('[meliSync] initial sync on startup...');
        await runMeliSync();
      } catch (e) {
        console.error('[meliSync] startup sync error:', e);
      }
    }, 60_000);

    setInterval(async () => {
      if (meliSyncRunning) return;
      meliSyncRunning = true;
      try {
        await runMeliSync();
      } catch (e) {
        console.error('[meliSync] periodic sync error:', e);
      } finally {
        meliSyncRunning = false;
      }
    }, MELI_SYNC_MS);
  } else {
    console.warn('[meliSync] MELI_CLIENT_ID or MELI_CLIENT_SECRET not set — sync disabled');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
