/**
 * admin.ts — Minimal admin routes.
 * Covers: Evolution bootstrap, contact rules, conversation rules,
 * vehicle demands, catalog debug, meli-sync trigger.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { evolutionCreateInstance, evolutionConnect, maskSensitive } from '../services/evolution.js';
import { pool } from '../services/db.js';
import { listContactRules, setContactRule, deleteContactRule } from '../services/contacts.js';
import {
  listConversationRules,
  setConversationRule,
  deleteConversationRule,
} from '../services/rules.js';
import {
  createVehicleDemand,
  listVehicleDemands,
  updateVehicleDemand,
  closeVehicleDemand,
  listDemandMatches,
  listDemandRecontacts,
  scanRecentVehiclesForDemandMatches,
  runRecontactJob,
  getDemandVehicleScanDebug,
  clearVehicleSourceCache,
} from '../services/demands.js';
import { getCatalogDebug } from '../services/catalog.js';
import { runMeliSync } from '../services/meliSync.js';
import { getBotReplyMode, setBotReplyMode } from '../services/botReplyGate.js';

export const adminRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  const token = String(req.header('x-admin-token') ?? '');
  if (!token || token !== env.adminToken) return res.status(401).json({ ok: false });
  return next();
}

adminRouter.use(requireAdmin);

// ── Evolution bootstrap ────────────────────────────────────────────────────────
adminRouter.post('/bootstrap', async (req: Request, res: Response) => {
  if (!env.publicUrl) return res.status(400).json({ ok: false, message: 'BOT_PUBLIC_URL not set' });
  try {
    const instance = env.instanceName;
    const webhookUrl = `${env.publicUrl}/webhooks/${instance}`;
    await evolutionCreateInstance({
      instanceName: instance,
      webhookUrl,
      webhookSecret: env.webhookSecret,
    });
    const connectResult = await evolutionConnect(instance);
    return res.json({ ok: true, ...maskSensitive(connectResult) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message });
  }
});

// ── Health ─────────────────────────────────────────────────────────────────────
adminRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM bot_conversations');
    return res.json({ ok: true, conversations: Number(rows[0].cnt) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message });
  }
});

// ── Contact rules ──────────────────────────────────────────────────────────────
adminRouter.get('/contact-rules', async (_req, res) => { res.json(await listContactRules()); });
adminRouter.post('/contact-rules', async (req, res) => {
  await setContactRule(req.body.number, req.body.botMode);
  res.json({ ok: true });
});
adminRouter.delete('/contact-rules/:number', async (req, res) => {
  await deleteContactRule(req.params.number);
  res.json({ ok: true });
});

// ── Conversation rules ─────────────────────────────────────────────────────────
adminRouter.get('/conversation-rules', async (_req, res) => { res.json(await listConversationRules()); });
adminRouter.post('/conversation-rules', async (req, res) => {
  const { instance, remoteJid, botMode, notes } = req.body;
  await setConversationRule(instance, remoteJid, botMode, notes);
  res.json({ ok: true });
});
adminRouter.delete('/conversation-rules', async (req, res) => {
  await deleteConversationRule(req.body.instance, req.body.remoteJid);
  res.json({ ok: true });
});
// DELETE con path params — usado por el panel: DELETE /admin/conversation-rules/:instance/:remoteJid
adminRouter.delete('/conversation-rules/:instance/:remoteJid', async (req: Request, res: Response) => {
  const instance = decodeURIComponent(req.params.instance);
  const remoteJid = decodeURIComponent(req.params.remoteJid);
  await deleteConversationRule(instance, remoteJid);
  res.json({ ok: true });
});

// ── Catalog debug ──────────────────────────────────────────────────────────────
adminRouter.get('/catalog/debug', async (_req, res) => {
  try { return res.json({ ok: true, ...(await getCatalogDebug()) }); }
  catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
});

// ── Vehicle demands ────────────────────────────────────────────────────────────
adminRouter.get('/demands', async (req, res) => {
  const status = (req.query.status as any) ?? 'open';
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await listVehicleDemands({ status, limit }));
});
adminRouter.post('/demands', async (req, res) => {
  res.json({ ok: true, demand: await createVehicleDemand(req.body) });
});
adminRouter.patch('/demands/:id', async (req, res) => {
  await updateVehicleDemand(Number(req.params.id), req.body);
  res.json({ ok: true });
});
adminRouter.post('/demands/:id/close', async (req, res) => {
  await closeVehicleDemand(Number(req.params.id));
  res.json({ ok: true });
});
adminRouter.get('/demands/:id/matches', async (req, res) => {
  res.json(await listDemandMatches(Number(req.params.id)));
});
adminRouter.get('/demands/:id/recontacts', async (req, res) => {
  res.json(await listDemandRecontacts(Number(req.params.id)));
});
adminRouter.post('/demands/scan', async (req, res) => {
  const since = req.body.since ? new Date(req.body.since) : new Date(Date.now() - 10 * 60_000);
  const result = await scanRecentVehiclesForDemandMatches({ since, threshold: Number(req.body.threshold ?? 0.45) });
  res.json({ ok: true, ...result });
});
adminRouter.post('/demands/recontact', async (_req, res) => {
  res.json({ ok: true, ...(await runRecontactJob()) });
});
adminRouter.get('/demands/scan/debug', async (_req, res) => {
  res.json({ ok: true, ...(await getDemandVehicleScanDebug()) });
});
adminRouter.post('/demands/cache/clear', async (_req, res) => {
  clearVehicleSourceCache();
  res.json({ ok: true });
});

// ── Bot reply mode (switch global) ─────────────────────────────────────────────
adminRouter.get('/bot-mode', (_req, res) => {
  res.json({ ok: true, mode: getBotReplyMode() });
});

adminRouter.post('/bot-mode', (req: Request, res: Response) => {
  const { mode } = req.body;
  if (mode !== 'on' && mode !== 'silent') {
    return res.status(400).json({ ok: false, error: 'mode must be "on" or "silent"' });
  }
  setBotReplyMode(mode);
  return res.json({ ok: true, mode });
});

// ── Intelligence / Playground / Learning ──────────────────────────────────────
// These stubs prevent the panel from receiving 404s on routes it forwards to the
// bot via forwardBotAdmin(). The panel's botIntelligenceRoutes uses tryForward()
// with local compat fallback for intelligence/* and decisions, but uses forward()
// (no fallback) for playground and learning/* — those cause hard 502s without these.

adminRouter.post('/playground/run', async (req: Request, res: Response) => {
  // Minimal playground: echo back the input with a not-implemented marker.
  // Panel already handles the case where the bot doesn't have a real playground.
  const text = String((req.body as any)?.text ?? '');
  return res.json({
    ok: false,
    error: 'playground_not_available',
    message: 'El bot no tiene playground runtime activo. Configurá OPENAI_API_KEY para habilitarlo.',
    input: text
  });
});

adminRouter.get('/intelligence/settings', (_req: Request, res: Response) => {
  const mode = getBotReplyMode();
  return res.json({ settings: { botEnabled: mode === 'on' }, source: 'bot_stub' });
});

adminRouter.put('/intelligence/settings', (req: Request, res: Response) => {
  const body = req.body as any;
  const s = body?.settings ?? body ?? {};
  if (typeof s.botEnabled === 'boolean') {
    setBotReplyMode(s.botEnabled ? 'on' : 'silent');
  }
  const mode = getBotReplyMode();
  return res.json({ ok: true, settings: { botEnabled: mode === 'on' }, source: 'bot_stub' });
});

adminRouter.get('/intelligence/policies', async (_req: Request, res: Response) => {
  return res.json({ policies: [], source: 'bot_stub' });
});

adminRouter.post('/intelligence/policies', async (_req: Request, res: Response) => {
  return res.status(201).json({ policy: null, source: 'bot_stub' });
});

adminRouter.delete('/intelligence/policies/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.get('/intelligence/faqs', async (_req: Request, res: Response) => {
  return res.json({ faqs: [], source: 'bot_stub' });
});

adminRouter.post('/intelligence/faqs', async (_req: Request, res: Response) => {
  return res.status(201).json({ faq: null, source: 'bot_stub' });
});

adminRouter.delete('/intelligence/faqs/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.get('/intelligence/playbooks', async (_req: Request, res: Response) => {
  return res.json({ playbooks: [], source: 'bot_stub' });
});

adminRouter.post('/intelligence/playbooks', async (_req: Request, res: Response) => {
  return res.status(201).json({ playbook: null, source: 'bot_stub' });
});

adminRouter.delete('/intelligence/playbooks/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.get('/intelligence/examples', async (_req: Request, res: Response) => {
  return res.json({ examples: [], source: 'bot_stub' });
});

adminRouter.post('/intelligence/examples', async (_req: Request, res: Response) => {
  return res.status(201).json({ example: null, source: 'bot_stub' });
});

adminRouter.delete('/intelligence/examples/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.get('/intelligence/decisions', async (_req: Request, res: Response) => {
  return res.json({ decisions: [], source: 'bot_stub' });
});

adminRouter.post('/intelligence/episodes/ingest', async (_req: Request, res: Response) => {
  return res.status(201).json({ ok: true, ingested: 0, source: 'bot_stub' });
});

// Learning stubs — forward() (no local fallback) requires these to return 2xx
adminRouter.get('/learning/stats', async (_req: Request, res: Response) => {
  return res.json({
    stats: {
      total_captures: 0,
      approved: 0,
      pending: 0,
      has_human_feedback: 0,
      avg_auto_score: null,
      promoted: 0,
      has_outcome: 0,
      errors: 0
    },
    source: 'bot_stub'
  });
});

adminRouter.get('/learning/captures', async (_req: Request, res: Response) => {
  return res.json({ rows: [], total: 0, source: 'bot_stub' });
});

adminRouter.get('/learning/captures/:id', async (req: Request, res: Response) => {
  return res.status(404).json({ ok: false, error: 'capture_not_found', source: 'bot_stub' });
});

adminRouter.post('/learning/feedback', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.post('/learning/promote/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.post('/learning/outcome', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.post('/learning/flag/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.get('/learning/examples/preview', async (_req: Request, res: Response) => {
  return res.json({ block: '', count: 0, source: 'bot_stub' });
});

adminRouter.get('/learning/memory', async (_req: Request, res: Response) => {
  return res.json({ rows: [], total: 0, source: 'bot_stub' });
});

adminRouter.get('/learning/memory/summary', async (_req: Request, res: Response) => {
  return res.json({ summary: [], source: 'bot_stub' });
});

adminRouter.patch('/learning/memory/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.post('/learning/memory/extract', async (_req: Request, res: Response) => {
  return res.json({ ok: true, extracted: 0, source: 'bot_stub' });
});

adminRouter.post('/learning/memory', async (_req: Request, res: Response) => {
  return res.status(201).json({ ok: true, source: 'bot_stub' });
});

// Trace stubs
adminRouter.get('/trace', async (_req: Request, res: Response) => {
  return res.json({ rows: [], total: 0, source: 'bot_stub' });
});

adminRouter.get('/trace/:messageId', async (_req: Request, res: Response) => {
  return res.status(404).json({ ok: false, source: 'bot_stub' });
});

// Metrics stubs
adminRouter.get('/metrics/summary', async (_req: Request, res: Response) => {
  return res.json({ summary: null, source: 'bot_stub' });
});

adminRouter.get('/metrics/timeseries', async (_req: Request, res: Response) => {
  return res.json({ rows: [], source: 'bot_stub' });
});

adminRouter.get('/metrics/alerts', async (_req: Request, res: Response) => {
  return res.json({ alerts: [], source: 'bot_stub' });
});

adminRouter.post('/metrics/alerts/:id/resolve', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

// Eval stubs
adminRouter.get('/eval/runs', async (_req: Request, res: Response) => {
  return res.json({ runs: [], source: 'bot_stub' });
});

adminRouter.post('/eval/run', async (_req: Request, res: Response) => {
  return res.json({ ok: false, result: null, source: 'bot_stub' });
});

// Tests stubs
adminRouter.get('/tests/cases', async (_req: Request, res: Response) => {
  return res.json({ cases: [], source: 'bot_stub' });
});

adminRouter.post('/tests/cases', async (_req: Request, res: Response) => {
  return res.status(201).json({ ok: true, source: 'bot_stub' });
});

adminRouter.delete('/tests/cases/:id', async (_req: Request, res: Response) => {
  return res.json({ ok: true, source: 'bot_stub' });
});

adminRouter.post('/tests/run', async (_req: Request, res: Response) => {
  return res.json({ ok: true, results: [], source: 'bot_stub' });
});

// Health sub-route
adminRouter.get('/health/bot', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM bot_conversations');
    return res.json({ ok: true, health: { status: 'ok', conversations: Number(rows[0].cnt) } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, health: { status: 'error', error: e?.message } });
  }
});

// ── MercadoLibre sync ──────────────────────────────────────────────────────────
adminRouter.post('/meli/sync', async (_req, res) => {
  if (!process.env.MELI_CLIENT_ID || !process.env.MELI_CLIENT_SECRET)
    return res.status(400).json({ ok: false, error: 'MELI credentials not configured' });
  runMeliSync().catch((e) => console.error('[meliSync] manual trigger error:', e));
  return res.json({ ok: true, message: 'Sync started in background' });
});
