import { Router } from 'express';
import { env } from '../lib/env.js';
import { evolutionCreateInstance, evolutionConnect } from '../services/evolution.js';
import { pool } from '../services/db.js';
import { listContactRules, setContactRule, deleteContactRule } from '../services/contacts.js';
import {
  listConversationRules,
  setConversationRule,
  deleteConversationRule,
  listConversationTags,
  addConversationTag,
  removeConversationTag,
  listConversationNotes,
  addConversationNote,
  listQuickReplies,
  addQuickReply,
  deleteQuickReply
} from '../services/rules.js';
import {
  getIntelligenceSettings,
  updateIntelligenceSettings,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listFaq,
  createFaq,
  updateFaq,
  deleteFaq,
  listPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  listExamples,
  createExample,
  deleteExample,
  listDecisions,
  searchKnowledge,
  listEpisodes,
  rateEpisode,
  listAudit,
  logAudit,
  listAbVariants,
  createAbVariant,
  deleteAbVariant
} from '../services/intelligence.js';

import { runPlayground } from '../services/playground.js';
import { listTestCases, createTestCase, deleteTestCase } from '../services/intelligence.js';
import { runTestSuite } from '../services/tests.js';

export const adminRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  const token = String(req.header('x-admin-token') ?? '');
  if (!token || token !== env.adminToken) {
    return res.status(401).json({ ok: false });
  }
  return next();
}

adminRouter.use(requireAdmin);

adminRouter.post('/bootstrap', async (req, res) => {
  if (!env.publicUrl) {
    return res.status(400).json({ ok: false, message: 'BOT_PUBLIC_URL not set' });
  }
  const instanceName = String(req.body?.instanceName ?? env.instanceName);
  try {
    const r = await evolutionCreateInstance({
      instanceName,
      withQr: true,
      webhookUrl: `${env.publicUrl}/webhooks/evolution`,
      webhookSecret: env.webhookSecret
    });
    return res.json({ ok: true, result: r });
  } catch (e: any) {
    // If instance name already exists, Evolution returns 403. We surface the error but keep guidance.
    return res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/qr', async (req, res) => {
  const instanceName = String(req.query.instanceName ?? env.instanceName);
  try {
    const r = await evolutionConnect(instanceName);
    return res.json({ ok: true, result: r });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Lightweight "training" helpers (v1): expose recent conversation state
 * so you can build a UI without touching the bot code every time.
 */
adminRouter.get('/conversations', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  try {
    const r = await pool.query(
      'select remote_jid, state, updated_at from bot_conversations where instance=$1 order by updated_at desc limit $2',
      [instance, limit]
    );
    return res.json({ ok: true, instance, conversations: r.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/conversation', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  const remoteJid = String(req.query.remoteJid ?? '');
  if (!remoteJid) return res.status(400).json({ ok: false, message: 'remoteJid required' });
  try {
    const r = await pool.query('select remote_jid, state, updated_at from bot_conversations where instance=$1 and remote_jid=$2', [instance, remoteJid]);
    if ((r.rowCount ?? 0) === 0) return res.status(404).json({ ok: false, message: 'not found' });
    return res.json({ ok: true, instance, conversation: r.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Manage per-number bot modes (ON, OFF, HUMAN_ONLY). These endpoints
 * allow an administrator to list, create/update and delete contact rules
 * via a simple REST API. The values are persisted in the
 * bot_contact_rules table.
 */

// List all contact rules
adminRouter.get('/private-numbers', async (_req, res) => {
  try {
    const rules = await listContactRules();
    return res.json({ ok: true, rules });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Create or update a contact rule. Expects a JSON body with
// { number: string, botMode: 'ON' | 'OFF' | 'HUMAN_ONLY', notes?: string }
adminRouter.post('/private-numbers', async (req, res) => {
  const number = String(req.body?.number ?? '').trim();
  const botMode = String(req.body?.botMode ?? '').trim().toUpperCase();
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : undefined;
  if (!number || !botMode) {
    return res.status(400).json({ ok: false, message: 'number and botMode required' });
  }
  if (!['ON', 'OFF', 'HUMAN_ONLY'].includes(botMode)) {
    return res.status(400).json({ ok: false, message: 'botMode must be ON, OFF or HUMAN_ONLY' });
  }
  try {
    await setContactRule(number, botMode as any, notes);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Delete a contact rule
adminRouter.delete('/private-numbers/:number', async (req, res) => {
  const number = String(req.params.number ?? '').trim();
  if (!number) {
    return res.status(400).json({ ok: false, message: 'number required' });
  }
  try {
    await deleteContactRule(number);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Conversation-level bot rules (instance + remoteJid). These endpoints allow
 * admins to control the bot mode for a specific conversation instead of a
 * global number. They mirror the private-numbers endpoints but operate on
 * the bot_conversation_rules table. When specifying instance, if omitted
 * the default env.instanceName is used.
 */

// List all conversation rules
adminRouter.get('/conversation-rules', async (req, res) => {
  try {
    const rules = await listConversationRules();
    return res.json({ ok: true, rules });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Create or update a conversation rule. Body: { instance?: string, remoteJid: string, botMode: 'ON'|'OFF'|'HUMAN_ONLY', notes?: string }
adminRouter.post('/conversation-rules', async (req, res) => {
  const instance = String(req.body?.instance ?? env.instanceName);
  const remoteJid = String(req.body?.remoteJid ?? '').trim();
  const botMode = String(req.body?.botMode ?? '').trim().toUpperCase();
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : undefined;
  if (!remoteJid || !botMode) {
    return res.status(400).json({ ok: false, message: 'remoteJid and botMode required' });
  }
  if (!['ON', 'OFF', 'HUMAN_ONLY'].includes(botMode)) {
    return res.status(400).json({ ok: false, message: 'botMode must be ON, OFF or HUMAN_ONLY' });
  }
  try {
    await setConversationRule(instance, remoteJid, botMode as any, notes);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Delete a conversation rule
adminRouter.delete('/conversation-rules/:instance/:remoteJid', async (req, res) => {
  const instance = String(req.params.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  if (!remoteJid) {
    return res.status(400).json({ ok: false, message: 'remoteJid required' });
  }
  try {
    await deleteConversationRule(instance, remoteJid);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Conversation tags and notes. These endpoints allow attaching tags and notes
 * to conversations to aid operators in triaging and categorising chats.
 */

// List tags for a conversation
adminRouter.get('/conversation/:remoteJid/tags', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  if (!remoteJid) return res.status(400).json({ ok: false, message: 'remoteJid required' });
  try {
    const tags = await listConversationTags(instance, remoteJid);
    return res.json({ ok: true, instance, remoteJid, tags });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Add a tag to a conversation. Body: { tag: string, instance?: string }
adminRouter.post('/conversation/:remoteJid/tags', async (req, res) => {
  const instance = String(req.body?.instance ?? req.query.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  const tag = String(req.body?.tag ?? '').trim();
  if (!remoteJid || !tag) {
    return res.status(400).json({ ok: false, message: 'remoteJid and tag required' });
  }
  try {
    await addConversationTag(instance, remoteJid, tag);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Remove a tag from a conversation
adminRouter.delete('/conversation/:remoteJid/tags/:tag', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  const tag = String(req.params.tag ?? '').trim();
  if (!remoteJid || !tag) {
    return res.status(400).json({ ok: false, message: 'remoteJid and tag required' });
  }
  try {
    await removeConversationTag(instance, remoteJid, tag);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// List notes for a conversation
adminRouter.get('/conversation/:remoteJid/notes', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  if (!remoteJid) return res.status(400).json({ ok: false, message: 'remoteJid required' });
  try {
    const notes = await listConversationNotes(instance, remoteJid);
    return res.json({ ok: true, instance, remoteJid, notes });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Add a note to a conversation. Body: { note: string, instance?: string }
adminRouter.post('/conversation/:remoteJid/notes', async (req, res) => {
  const instance = String(req.body?.instance ?? req.query.instance ?? env.instanceName);
  const remoteJid = String(req.params.remoteJid ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!remoteJid || !note) {
    return res.status(400).json({ ok: false, message: 'remoteJid and note required' });
  }
  try {
    await addConversationNote(instance, remoteJid, note);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Quick replies management. Allows defining canned responses that operators can reuse.
 */

// List quick replies
adminRouter.get('/quick-replies', async (_req, res) => {
  try {
    const replies = await listQuickReplies();
    return res.json({ ok: true, replies });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Add or update a quick reply. Body: { slug: string, content: string }
adminRouter.post('/quick-replies', async (req, res) => {
  const slug = String(req.body?.slug ?? '').trim();
  const content = String(req.body?.content ?? '').trim();
  if (!slug || !content) {
    return res.status(400).json({ ok: false, message: 'slug and content required' });
  }
  try {
    await addQuickReply(slug, content);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Delete a quick reply by id
adminRouter.delete('/quick-replies/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) {
    return res.status(400).json({ ok: false, message: 'valid id required' });
  }
  try {
    await deleteQuickReply(idNum);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Basic metrics endpoint. Returns simple counts to help measure usage and ROI.
 */
adminRouter.get('/metrics', async (req, res) => {
  const instance = String(req.query.instance ?? env.instanceName);
  try {
    // total conversations
    const conv = await pool.query('select count(*) from bot_conversations where instance=$1', [instance]);
    const totalConversations = Number(conv.rows[0].count ?? 0);
    // leads (defined as conversations where last_intent indicates interest)
    const leads = await pool.query(
      `select count(*) from bot_conversations
       where instance=$1
       and (state->>'last_intent') in ('product_results','price_request','option_selected')`,
      [instance]
    );
    const totalLeads = Number(leads.rows[0].count ?? 0);
    // conversations handed to human (bot_mode not ON)
    const handed = await pool.query(
      `select count(*) from bot_conversation_rules where instance=$1 and bot_mode <> 'ON'`,
      [instance]
    );
    const handedToHuman = Number(handed.rows[0].count ?? 0);
    return res.json({ ok: true, instance, metrics: { totalConversations, totalLeads, handedToHuman } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Intelligence configuration (Settings, FAQ, Playbooks, Examples, Decisions)
 */
adminRouter.get('/intelligence/settings', async (_req, res) => {
  try {
    const settings = await getIntelligenceSettings();
    return res.json({ ok: true, settings });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.put('/intelligence/settings', async (req, res) => {
  try {
    const settings = await updateIntelligenceSettings(req.body ?? {});
    return res.json({ ok: true, settings });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Policies
adminRouter.get('/intelligence/policies', async (_req, res) => {
  try {
    const policies = await listPolicies();
    return res.json({ ok: true, policies });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/intelligence/policies', async (req, res) => {
  try {
    const policy = await createPolicy({
      title: req.body?.title,
      triggers: req.body?.triggers ?? [],
      body: req.body?.body ?? '',
      enabled: req.body?.enabled,
      draft: req.body?.draft
    });
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'policy',
      entity_id: String(policy?.id ?? ''),
      diff: { title: policy?.title ?? null }
    });
    return res.json({ ok: true, policy });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.patch('/intelligence/policies/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    const policy = await updatePolicy(idNum, req.body ?? {});
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'update',
      entity: 'policy',
      entity_id: String(idNum),
      diff: req.body ?? {}
    });
    return res.json({ ok: true, policy });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/intelligence/policies/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deletePolicy(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'policy',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/intelligence/faqs', async (_req, res) => {
  try {
    const faqs = await listFaq();
    return res.json({ ok: true, faqs });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/intelligence/faqs', async (req, res) => {
  try {
    const faq = await createFaq({
      title: req.body?.title,
      triggers: req.body?.triggers ?? [],
      answer: req.body?.answer ?? '',
      enabled: req.body?.enabled,
      draft: req.body?.draft
    });
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'faq',
      entity_id: String(faq?.id ?? ''),
      diff: { title: faq?.title ?? null }
    });
    return res.json({ ok: true, faq });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.patch('/intelligence/faqs/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    const faq = await updateFaq(idNum, req.body ?? {});
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'update',
      entity: 'faq',
      entity_id: String(idNum),
      diff: req.body ?? {}
    });
    return res.json({ ok: true, faq });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/intelligence/faqs/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deleteFaq(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'faq',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.patch('/intelligence/faqs/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    const faq = await updateFaq(idNum, req.body ?? {});
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'update',
      entity: 'faq',
      entity_id: String(idNum),
      diff: req.body ?? {}
    });
    return res.json({ ok: true, faq });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/intelligence/playbooks', async (_req, res) => {
  try {
    const playbooks = await listPlaybooks();
    return res.json({ ok: true, playbooks });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/intelligence/playbooks', async (req, res) => {
  try {
    const playbook = await createPlaybook({
      intent: String(req.body?.intent ?? ''),
      triggers: req.body?.triggers ?? [],
      template: String(req.body?.template ?? ''),
      enabled: req.body?.enabled,
      draft: req.body?.draft,
      config: req.body?.config
    });
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'playbook',
      entity_id: String(playbook?.id ?? ''),
      diff: { intent: playbook?.intent ?? null }
    });
    return res.json({ ok: true, playbook });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.patch('/intelligence/playbooks/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    const playbook = await updatePlaybook(idNum, req.body ?? {});
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'update',
      entity: 'playbook',
      entity_id: String(idNum),
      diff: req.body ?? {}
    });
    return res.json({ ok: true, playbook });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/intelligence/playbooks/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deletePlaybook(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'playbook',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/intelligence/examples', async (_req, res) => {
  try {
    const examples = await listExamples();
    return res.json({ ok: true, examples });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/intelligence/examples', async (req, res) => {
  try {
    const example = await createExample({
      intent: String(req.body?.intent ?? ''),
      user_text: String(req.body?.user_text ?? ''),
      ideal_answer: String(req.body?.ideal_answer ?? ''),
      notes: req.body?.notes
    });
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'example',
      entity_id: String(example?.id ?? ''),
      diff: { intent: example?.intent ?? null }
    });
    return res.json({ ok: true, example });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/intelligence/examples/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deleteExample(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'example',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.get('/intelligence/decisions', async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  try {
    const decisions = await listDecisions(limit);
    return res.json({ ok: true, decisions });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Knowledge search ("mostrar fuentes usadas")
adminRouter.get('/intelligence/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limitRaw = Number(req.query.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 5;
  if (!q) return res.status(400).json({ ok: false, message: 'q required' });
  try {
    const hits = await searchKnowledge(q, limit);
    return res.json({ ok: true, hits });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Training Episodes: list + rate
adminRouter.get('/intelligence/episodes', async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  try {
    const episodes = await listEpisodes(limit);
    return res.json({ ok: true, episodes });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});


adminRouter.post('/intelligence/episodes/ingest', async (req, res) => {
  // Ingest a training episode from external systems (e.g. panel-human replies)
  const body = req.body || {};
  const channel = body.channel || 'WHATSAPP';
  const contact_id = body.contact_id ?? null;
  const user_text = body.user_text;
  const reply_text = body.reply_text;
  const meta = body.meta || {};

  if (!user_text || !reply_text) {
    return res.status(400).json({ error: 'user_text and reply_text are required' });
  }

  try {
    const { logEpisode } = await import('../services/intelligence');
    const id = await logEpisode({
      channel,
      contact_id,
      user_text,
      reply_text,
      meta
    });
    return res.status(201).json({ id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed to ingest episode' });
  }
});
adminRouter.post('/intelligence/episodes/:id/rate', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  const rating = req.body?.rating === null || req.body?.rating === undefined ? null : Number(req.body?.rating);
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : null;
  try {
    const ep = await rateEpisode(idNum, Number.isFinite(rating as any) ? (rating as any) : null, feedback);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'rate',
      entity: 'episode',
      entity_id: String(idNum),
      diff: { rating, feedback }
    });
    return res.json({ ok: true, episode: ep });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Audit log
adminRouter.get('/intelligence/audit', async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;
  try {
    const audit = await listAudit(limit);
    return res.json({ ok: true, audit });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// A/B variants
adminRouter.get('/intelligence/ab/variants', async (_req, res) => {
  try {
    const variants = await listAbVariants();
    return res.json({ ok: true, variants });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/intelligence/ab/variants', async (req, res) => {
  try {
    const v = await createAbVariant({
      scope: req.body?.scope,
      scope_key: String(req.body?.scope_key ?? ''),
      variant: String(req.body?.variant ?? ''),
      weight: req.body?.weight,
      template_override: req.body?.template_override,
      enabled: req.body?.enabled
    } as any);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'ab_variant',
      entity_id: String(v?.id ?? ''),
      diff: { scope: v?.scope, scope_key: v?.scope_key, variant: v?.variant, weight: v?.weight }
    });
    return res.json({ ok: true, variant: v });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/intelligence/ab/variants/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deleteAbVariant(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'ab_variant',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Playground: simulate matching without sending a message.
 * Returns reply + intent + sources used.
 */
adminRouter.post('/playground/run', async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (!text.trim()) return res.status(400).json({ ok: false, message: 'text required' });
  try {
    const result = await runPlayground({ text, state: req.body?.state });
    return res.json({ ok: true, result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Tests: CRUD cases + run suite.
 */
adminRouter.get('/tests/cases', async (_req, res) => {
  try {
    const cases = await listTestCases();
    return res.json({ ok: true, cases });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/tests/cases', async (req, res) => {
  try {
    const tc = await createTestCase({
      name: String(req.body?.name ?? ''),
      user_text: String(req.body?.user_text ?? ''),
      expected_intent: req.body?.expected_intent,
      expected_source_type: req.body?.expected_source_type,
      expected_source_id: req.body?.expected_source_id,
      expected_contains: req.body?.expected_contains ?? [],
      expected_not_contains: req.body?.expected_not_contains ?? [],
      expected_regex: req.body?.expected_regex,
      expected_must_ask_fields: req.body?.expected_must_ask_fields ?? [],
      enabled: req.body?.enabled
    });
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'create',
      entity: 'test_case',
      entity_id: String(tc?.id ?? ''),
      diff: { name: tc?.name ?? null }
    });
    return res.json({ ok: true, test_case: tc });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.delete('/tests/cases/:id', async (req, res) => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) return res.status(400).json({ ok: false, message: 'valid id required' });
  try {
    await deleteTestCase(idNum);
    await logAudit({
      actor: String(req.header('x-admin-actor') ?? '') || null,
      action: 'delete',
      entity: 'test_case',
      entity_id: String(idNum)
    });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

adminRouter.post('/tests/run', async (req, res) => {
  const limitRaw = Number(req.body?.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  try {
    const report = await runTestSuite(limit);
    return res.json({ ok: true, report });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});


