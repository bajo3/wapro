import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// ─── In-memory rate limiter (no external deps) ────────────────────────────────
// Tracks request counts per IP in a sliding window.
type RateBucket = { count: number; windowStart: number };
function createRateLimiter(windowMs: number, maxRequests: number, message = 'Too many requests') {
  const buckets = new Map<string, RateBucket>();
  // Prune stale entries every windowMs to prevent memory leaks
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

// Limits per route type:
const webhookLimiter = createRateLimiter(60_000, 300, 'Webhook rate limit exceeded');  // 300/min per IP
const adminLimiter   = createRateLimiter(60_000, 60,  'Admin rate limit exceeded');     // 60/min per IP
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
import { runAutoTrainerScan } from "./services/autoTrainer.js";
import { loadBotMemory } from "./services/botMemory.js";
import { computeHourlyMetrics } from "./services/metricsAggregator.js";
import { runEvalSuite } from "./services/evalRunner.js";
import { logAiRuntimeStartup, resolveAiRuntime } from "./services/aiRuntime.js";
import { runMeliSync } from "./services/meliSync.js";

async function main() {
  await migrate();
  logAiRuntimeStartup(resolveAiRuntime(), 'startup', 'startup_boot');

  // Carga la memoria conversacional del bot al arrancar (sin bloquear)
  try {
    loadBotMemory();
  } catch (e) {
    console.warn('[botMemory] Error en carga inicial — se continúa sin memoria:', e);
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("combined"));

  // ✅ IMPORTANT: create a single http server for Express + Socket.IO
  const httpServer = http.createServer(app);

  // ✅ Socket.IO mounted on the same server/port
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: true, // luego lo cerramos al dominio del Manager
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  // Store the socket instance globally so other modules can emit events
  setSocket(io);

  io.on("connection", (socket) => {
    console.log("[bot] socket connected:", socket.id);
    socket.on("disconnect", () => console.log("[bot] socket disconnected:", socket.id));
  });

  // health + routes
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/webhooks", webhookLimiter, webhookRouter);
  app.use("/admin", adminLimiter, adminRouter);

  // ❌ DO NOT use app.listen here (it bypasses Socket.IO server)
  httpServer.listen(env.port, () => {
    console.log(`[bot] listening on :${env.port}`);
  });

  // Periodic purge job for deduplication table to prevent unbounded growth.
  // Runs once every 24 hours and deletes entries older than 7 days.
  setInterval(async () => {
    try {
      await pool.query("delete from bot_messages_dedupe where received_at < now() - interval '7 days'");
    } catch (e) {
      console.error('Failed to purge bot_messages_dedupe', e);
    }
  }, 24 * 60 * 60 * 1000);

  // Periodic follow-up job. Every hour, scan conversations and send a gentle reminder if a user
  // hasn't responded within the follow-up window after receiving product results or a price.
  const FOLLOWUP_MS = Number(process.env.BOT_FOLLOWUP_MS ?? String(48 * 60 * 60 * 1000)); // default 48h
  // Maintain a simple in-memory cache for conversation and contact rules to
  // reduce database/API calls during the follow-up scan. Entries expire after
  // a short TTL to ensure changes propagate. Using Maps with a timestamp
  // avoids external dependencies. When the cache grows large it will be
  // naturally cleared over time as entries expire and are replaced.
  const convRuleCache = new Map<string, { value: string | null; ts: number }>();
  const contactRuleCache = new Map<string, { value: string | null; ts: number }>();
  const RULE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  async function getCachedConversationRuleCached(instance: string, remoteJid: string) {
    const key = `${instance}:${remoteJid}`;
    const nowTs = Date.now();
    const cached = convRuleCache.get(key);
    if (cached && nowTs - cached.ts < RULE_CACHE_TTL_MS) {
      return cached.value;
    }
    try {
      const value = await getConversationRule(instance, remoteJid);
      convRuleCache.set(key, { value, ts: nowTs });
      return value;
    } catch (err) {
      // If retrieval fails, return null and do not cache to allow future retries.
      return null;
    }
  }

  async function getCachedContactRuleCached(number: string) {
    const nowTs = Date.now();
    const cached = contactRuleCache.get(number);
    if (cached && nowTs - cached.ts < RULE_CACHE_TTL_MS) {
      return cached.value;
    }
    try {
      const value = await getContactRule(number);
      contactRuleCache.set(number, { value, ts: nowTs });
      return value;
    } catch {
      return null;
    }
  }

  // Prevent overlapping follow-up scans. If the previous scan is still running
  // when the interval fires again, skip this execution to avoid concurrent
  // modifications and excessive load. Only one scan will run at a time.
  let followUpJobRunning = false;

  setInterval(async () => {
    if (followUpJobRunning) {
      return;
    }
    followUpJobRunning = true;
    try {
      const instance = env.instanceName;
      // Fetch conversations that have not been followed up yet. We use
      // PostgreSQL's JSONB operations to filter by state.followup_sent = false
      // (or missing) to reduce the number of rows scanned in memory. The
      // COALESCE ensures that missing keys are treated as false.
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
        // Respect operator handoff / per-conversation rules.
        try {
          const convRule = await getCachedConversationRuleCached(instance, remoteJid);
          if (convRule && convRule !== 'ON') continue;
          const number = remoteJid.split('@')[0];
          const contactRule = await getCachedContactRuleCached(number);
          if (contactRule && contactRule !== 'ON') continue;
        } catch {
          // best-effort
        }
        // Skip if follow-up already sent (redundant due to SQL filter but kept for safety)
        if (state.followup_sent) continue;
        // Determine last bot reply time
        const lastReplyIso = state.last_bot_reply_at || state.lastBotAt;
        const lastReply = lastReplyIso ? Date.parse(lastReplyIso) : NaN;
        if (Number.isNaN(lastReply)) continue;
        if (now - lastReply < FOLLOWUP_MS) continue;
        // Only follow up if the last intent indicates interest
        const intent = state.last_intent || '';
        const interestedIntents = ['product_results', 'price_request', 'product_results_single', 'option_selected'];
        if (!interestedIntents.includes(intent)) continue;
        // Compose follow-up message — personalize with specific vehicle if available
        const query = state.last_query || 'tu consulta';
        const firstHit = Array.isArray(state.last_hits) && state.last_hits.length > 0 ? state.last_hits[0] : null;
        const vehicleRef = firstHit
          ? (firstHit.name || `${firstHit.brand ?? ''} ${firstHit.model ?? ''}`.trim() || query)
          : query;
        const followupText = firstHit
          ? `Hola 👋 ¿seguís interesado/a en el ${vehicleRef}? Todavía lo tenemos disponible. ¿Querés que te pase más info o coordinar una visita?`
          : `Hola 👋 ¿seguís buscando ${query}? Por cualquier consulta estamos acá.`;
        try {
          // Send follow-up
          await sendTextAndPersist(instance, remoteJid, followupText);
          // Update state
          const iso = new Date().toISOString();
          const newState = {
            ...state,
            followup_sent: true,
            followup_sent_at: iso,
            lastBotAt: iso,
            last_bot_reply_at: iso,
            last_bot_reply_hash: undefined
          } as any;
          await setState(instance, remoteJid, newState);
          // Emit socket event
          const sock = getSocket();
          if (sock) {
            sock.emit('send.message', { instance, number: remoteJid.split('@')[0], text: followupText, imageUrl: null });
          }
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

  // Vehicle demand scan: match recent stock updates against saved demands.
  // Default: every 5 minutes, scan vehicles updated in the last 10 minutes.
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

  // Recontact job: ping clients periodically while demand is open.
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

  // ─── Auto-Trainer job ─────────────────────────────────────────────────────────
  // Runs every 3h. Finds idle conversations (1–8h without activity) and:
  //  1. Extracts learning patterns deterministically (FAQ gaps, stock gaps, objections)
  //  2. Calls GPT to analyze conversation quality and auto-generate FAQ entries
  //  3. Promotes high-quality captures to bot_examples
  // Never blocks the main flow — fire-and-forget.
  const AUTOTRAINER_MS = Number(process.env.AUTOTRAINER_SCAN_MS ?? String(3 * 60 * 60 * 1000));
  let autoTrainerRunning = false;

  // Run once on startup after a short delay (don't block boot)
  setTimeout(async () => {
    try {
      console.log('[autoTrainer] initial scan on startup...');
      const r = await runAutoTrainerScan();
      const io = getSocket();
      io?.emit('autotrainer_scan', { ok: true, ...r });
    } catch (e) {
      console.error('[autoTrainer] startup scan error:', e);
    }
  }, 5 * 60 * 1000); // 5 min after boot

  setInterval(async () => {
    if (autoTrainerRunning) return;
    autoTrainerRunning = true;
    try {
      console.log('[autoTrainer] periodic scan starting...');
      const r = await runAutoTrainerScan();
      const io = getSocket();
      io?.emit('autotrainer_scan', { ok: true, ...r });
    } catch (e) {
      console.error('[autoTrainer] periodic scan error:', e);
    } finally {
      autoTrainerRunning = false;
    }
  }, Math.max(60 * 60 * 1000, AUTOTRAINER_MS)); // min 1h between runs

  // ─── Fase 5: Métricas horarias ────────────────────────────────────────────────
  // Computa métricas de la hora anterior. Se corre cada hora.
  let metricsJobRunning = false;
  setInterval(async () => {
    if (metricsJobRunning) return;
    metricsJobRunning = true;
    try {
      await computeHourlyMetrics(env.instanceName);
    } catch (e) {
      console.error('[metricsAggregator] hourly job error:', e);
    } finally {
      metricsJobRunning = false;
    }
  }, 60 * 60 * 1000); // cada hora

  // ─── Fase 5: Evaluaciones automáticas ────────────────────────────────────────
  // Corre la suite de evaluación. Startup después de 10 min, luego cada 6h.
  let evalJobRunning = false;

  setTimeout(async () => {
    try {
      console.log('[evalRunner] startup evaluation run...');
      await runEvalSuite(env.instanceName, 'startup');
    } catch (e) {
      console.error('[evalRunner] startup error:', e);
    }
  }, 10 * 60 * 1000); // 10 min after boot

  setInterval(async () => {
    if (evalJobRunning) return;
    evalJobRunning = true;
    try {
      await runEvalSuite(env.instanceName, 'scheduled');
    } catch (e) {
      console.error('[evalRunner] periodic error:', e);
    } finally {
      evalJobRunning = false;
    }
  }, 6 * 60 * 60 * 1000); // cada 6 horas

  // ─── MercadoLibre sync ────────────────────────────────────────────────────────
  // Sincroniza publicaciones activas de ML → vehicles cada 3 horas.
  // Solo corre si MELI_CLIENT_ID y MELI_CLIENT_SECRET están seteados.
  const MELI_SYNC_MS = 3 * 60 * 60 * 1000;
  let meliSyncRunning = false;

  if (process.env.MELI_CLIENT_ID && process.env.MELI_CLIENT_SECRET) {
    // Primera corrida: 1 minuto después del boot
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
