/**
 * admin.ts — Minimal admin routes.
 * Covers: Evolution bootstrap, contact rules, conversation rules,
 * vehicle demands, catalog debug, meli-sync trigger.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { evolutionCreateInstance, evolutionConnect } from '../services/evolution.js';
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
    return res.json({ ok: true, ...connectResult });
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

// ── MercadoLibre sync ──────────────────────────────────────────────────────────
adminRouter.post('/meli/sync', async (_req, res) => {
  if (!process.env.MELI_CLIENT_ID || !process.env.MELI_CLIENT_SECRET)
    return res.status(400).json({ ok: false, error: 'MELI credentials not configured' });
  runMeliSync().catch((e) => console.error('[meliSync] manual trigger error:', e));
  return res.json({ ok: true, message: 'Sync started in background' });
});
