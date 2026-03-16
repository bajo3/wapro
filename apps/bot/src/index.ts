import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import { Server } from "socket.io";
import { setSocket } from "./services/socket.js";
import { pool } from "./services/db.js";

import { env } from "./lib/env.js";
import { migrate } from "./services/db.js";
import { webhookRouter } from "./routes/webhooks.js";
import { adminRouter } from "./routes/admin.js";
import { evolutionSendText } from "./services/evolution.js";
import { getSocket } from "./services/socket.js";
import { setState } from "./services/state.js";
import { getConversationRule } from "./services/rules.js";
import { getContactRule } from "./services/contacts.js";
import { scanRecentVehiclesForDemandMatches, runRecontactJob } from "./services/demands.js";

async function main() {
  await migrate();

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
  app.use("/webhooks", webhookRouter);
  app.use("/admin", adminRouter);

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
        // Compose follow-up message
        const query = state.last_query || 'tu consulta';
        const followupText = `Hola 👋 ¿seguís interesado/a en ${query}? ¡Me queda stock hoy!`;
        try {
          // Send follow-up
          await evolutionSendText(instance, remoteJid.split('@')[0], followupText);
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
  const DEMAND_MATCH_THRESHOLD = Number(process.env.DEMAND_MATCH_THRESHOLD ?? '0.62');

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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
