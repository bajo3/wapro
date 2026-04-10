/**
 * webhooks.ts — Minimal stub post-cleanup.
 *
 * Receives Evolution API webhooks, deduplicates, logs, updates state.
 * AI intelligence layer has been removed — rebuild from scratch here.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { pool } from '../services/db.js';
import { getState, setState, seenDedupe, markDedupe } from '../services/state.js';
import { getContactRule } from '../services/contacts.js';
import { getConversationRule } from '../services/rules.js';
import { getSocket } from '../services/socket.js';

export const webhookRouter = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireWebhookAuth(req: Request, res: Response, next: any) {
  const apiKey = req.header('apikey') ?? (req.query.apikey as string);
  if (env.webhookApiKey && apiKey !== env.webhookApiKey) {
    return res.status(401).json({ ok: false });
  }
  return next();
}

webhookRouter.use(requireWebhookAuth);

// ── Main webhook handler ───────────────────────────────────────────────────────
webhookRouter.post('/:instance', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });

  const instance = req.params.instance;
  const body = req.body ?? {};
  const event = body.event as string;

  if (event !== 'messages.upsert') return;

  const data = body.data ?? {};
  const message = Array.isArray(data.messages) ? data.messages[0] : data;
  if (!message) return;

  const key = message.key ?? {};
  const remoteJid: string = key.remoteJid ?? '';
  const fromMe: boolean = key.fromMe ?? false;
  const msgId: string = key.id ?? '';

  if (!remoteJid || fromMe) return;

  // Dedup
  if (await seenDedupe(instance, msgId)) return;
  await markDedupe(instance, msgId);

  // Check rules
  const number = remoteJid.split('@')[0];
  const [convRule, contactRule] = await Promise.all([
    getConversationRule(instance, remoteJid).catch(() => null),
    getContactRule(number).catch(() => null),
  ]);
  if (convRule === 'OFF' || contactRule === 'OFF') return;

  // Extract text
  const msgContent = message.message ?? {};
  const text: string =
    msgContent.conversation ||
    msgContent.extendedTextMessage?.text ||
    msgContent.imageMessage?.caption ||
    '';

  console.log(`[webhook] ${instance} | ${remoteJid} | "${text.slice(0, 80)}"`);

  // Update state
  const state = (await getState(instance, remoteJid).catch(() => null)) ?? {};
  await setState(instance, remoteJid, {
    ...state,
    lastUserAt: new Date().toISOString(),
    lastUserMsg: text.slice(0, 500),
  }).catch(() => {});

  // Emit to panel
  const sock = getSocket();
  sock?.emit('message.received', { instance, remoteJid, text });
});
