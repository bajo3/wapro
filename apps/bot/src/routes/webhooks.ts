/**
 * webhooks.ts — Recibe mensajes de Evolution, corre la inteligencia, responde.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { getState, setState, seenDedupe, markDedupe } from '../services/state.js';
import { getContactRule } from '../services/contacts.js';
import { getConversationRule } from '../services/rules.js';
import { sendTextAndPersist, sendImageAndPersist } from '../services/panelPersistence.js';
import { getSocket } from '../services/socket.js';
import { processMessage } from '../services/botIntelligence.js';

export const webhookRouter = Router();

// ── Auth ───────────────────────────────────────────────────────────────────────
function requireWebhookAuth(req: Request, res: Response, next: any) {
  const secret = req.header('x-bot-secret') ?? (req.query.secret as string);
  if (env.webhookSecret && secret !== env.webhookSecret) {
    return res.status(401).json({ ok: false });
  }
  return next();
}

webhookRouter.use(requireWebhookAuth);

// ── Main handler ───────────────────────────────────────────────────────────────
webhookRouter.post('/:instance', async (req: Request, res: Response) => {
  // Responder inmediatamente a Evolution
  res.status(200).json({ ok: true });

  const instance = req.params.instance;
  const body = req.body ?? {};
  const event = body.event as string;

  if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') return;

  const data = body.data ?? {};
  const messages: any[] = Array.isArray(data.messages) ? data.messages : [data];
  const message = messages[0];
  if (!message) return;

  const key = message.key ?? {};
  const remoteJid: string = key.remoteJid ?? '';
  const fromMe: boolean   = key.fromMe ?? false;
  const msgId: string     = key.id ?? '';

  if (!remoteJid || fromMe) return;
  // Ignorar grupos
  if (remoteJid.endsWith('@g.us')) return;

  // Dedup
  if (await seenDedupe(msgId)) return;
  await markDedupe(msgId, instance, remoteJid, 'inbound');

  // Reglas on/off
  const number = remoteJid.replace(/[^0-9]/g, '');
  const [convRule, contactRule] = await Promise.all([
    getConversationRule(instance, remoteJid).catch(() => null),
    getContactRule(number).catch(() => null),
  ]);
  // OFF y HUMAN_ONLY bloquean respuestas automáticas del bot
  if (convRule === 'OFF' || convRule === 'HUMAN_ONLY' || contactRule === 'OFF' || contactRule === 'HUMAN_ONLY') return;

  // Extraer texto
  const msgContent = message.message ?? {};
  const text: string = (
    msgContent.conversation ||
    msgContent.extendedTextMessage?.text ||
    msgContent.imageMessage?.caption ||
    msgContent.videoMessage?.caption ||
    ''
  ).trim();

  if (!text) return;

  console.log(`[webhook] ${instance} | ${number} | "${text.slice(0, 80)}"`);

  try {
    // Estado actual
    const state = await getState(instance, remoteJid).catch(() => ({}));

    // Inteligencia
    const result = await processMessage({ instance, remoteJid, message: text, state });

    // Guardar nuevo estado
    await setState(instance, remoteJid, result.newState as any).catch((e) =>
      console.error('[webhook] setState error:', e)
    );

    // Preferir el nombre de instancia del webhook incoming (req.params.instance):
    // Evolution pone en la URL exactamente el instanceName con el que está registrada,
    // así que es la fuente más confiable. Fallback a env.instanceName si el param llega vacío.
    const webhookInstance = instance; // ya es req.params.instance
    const sendInstance = webhookInstance || env.instanceName;
    const resolvedFrom = webhookInstance ? 'webhook_param' : 'env';
    console.log(`[send] evolution instance=${sendInstance} resolved_from=${resolvedFrom} to=${remoteJid}`);

    // Enviar respuesta de texto
    await sendTextAndPersist(sendInstance, remoteJid, result.reply).catch(e => {
      console.error(`[send] evolution instance=${sendInstance} failed status=${e?.message ?? e}`);
      throw e;
    });

    // Enviar fotos si las hay (hasta 5, secuencial para no saturar WhatsApp)
    if (result.imagesToSend?.length) {
      for (const imageUrl of result.imagesToSend.slice(0, 5)) {
        await sendImageAndPersist(sendInstance, remoteJid, imageUrl).catch(e =>
          console.error(`[send] evolution instance=${sendInstance} image failed to ${remoteJid}:`, e?.message ?? e)
        );
      }
    }

    // Emitir al panel
    const sock = getSocket();
    sock?.emit('bot.reply', {
      instance,
      remoteJid,
      text: result.reply,
      isHot: result.isHot ?? false,
    });

  } catch (err: any) {
    console.error(`[webhook] processing error for ${remoteJid}:`, err?.message ?? err);
  }
});
