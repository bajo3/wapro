/**
 * webhooks.ts — Recibe mensajes de Evolution, corre la inteligencia, responde.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { getState, setState, seenDedupe, markDedupe } from '../services/state.js';
import { getContactRule } from '../services/contacts.js';
import { getConversationRule } from '../services/rules.js';
import { sendTextAndPersist, sendImageAndPersist, persistInboundMessage } from '../services/panelPersistence.js';
import { getSocket } from '../services/socket.js';
import { processMessage } from '../services/botIntelligence.js';

export const webhookRouter = Router();

// ── Instance resolution ────────────────────────────────────────────────────────
// Priority: body.instance > body.instanceName > req.params (if not literal
// "evolution") > env.instanceName
function resolveInstance(params: {
  bodyInstance?: string;
  paramInstance?: string;
  envInstance: string;
}): { instance: string; resolvedFrom: string } {
  if (params.bodyInstance && params.bodyInstance.trim()) {
    return { instance: params.bodyInstance.trim(), resolvedFrom: 'body_instance' };
  }
  if (params.paramInstance && params.paramInstance !== 'evolution') {
    return { instance: params.paramInstance, resolvedFrom: 'webhook_param' };
  }
  return { instance: params.envInstance, resolvedFrom: 'env_fallback' };
}

// ── Auth ───────────────────────────────────────────────────────────────────────
function requireWebhookAuth(req: Request, res: Response, next: any) {
  const secret = req.header('x-bot-secret') ?? (req.query.secret as string);
  console.log(`[webhook] incoming path=${req.path} has_secret_header=${!!secret} secret_configured=${!!env.webhookSecret}`);
  if (env.webhookSecret && secret !== env.webhookSecret) {
    console.warn(`[webhook] auth rejected — secret mismatch. Check Evolution webhook header x-bot-secret matches BOT_WEBHOOK_SECRET`);
    return res.status(401).json({ ok: false });
  }
  return next();
}

webhookRouter.use(requireWebhookAuth);

// ── Main handler ───────────────────────────────────────────────────────────────
// Handles both /:instance (real name) and /evolution (legacy compatibility)
webhookRouter.post('/:instance', async (req: Request, res: Response) => {
  // Responder inmediatamente a Evolution
  res.status(200).json({ ok: true });

  const body = req.body ?? {};
  const event = body.event as string;

  // Resolve the real Evolution instance name before any processing
  const { instance, resolvedFrom } = resolveInstance({
    bodyInstance: body.instance ?? body.instanceName,
    paramInstance: req.params.instance,
    envInstance: env.instanceName,
  });
  console.log(`[webhook] instance resolved: ${instance} (resolved_from=${resolvedFrom})`);

  if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
    console.log(`[webhook] skipped event=${event} instance=${instance}`);
    return;
  }

  const data = body.data ?? {};
  const messages: any[] = Array.isArray(data.messages) ? data.messages : [data];
  const message = messages[0];
  if (!message) {
    console.log(`[webhook] skipped reason=no_message instance=${instance}`);
    return;
  }

  const key = message.key ?? {};
  const remoteJid: string = key.remoteJid ?? '';
  const fromMe: boolean   = key.fromMe ?? false;
  const msgId: string     = key.id ?? '';

  if (!remoteJid || fromMe) {
    console.log(`[webhook] skipped reason=${!remoteJid ? 'no_remoteJid' : 'fromMe'} instance=${instance}`);
    return;
  }
  // Ignorar grupos
  if (remoteJid.endsWith('@g.us')) {
    console.log(`[webhook] skipped reason=group jid=${remoteJid}`);
    return;
  }

  // Dedup
  if (await seenDedupe(msgId)) {
    console.log(`[webhook] skipped reason=dedupe msgId=${msgId}`);
    return;
  }
  await markDedupe(msgId, instance, remoteJid, 'inbound');

  // Reglas on/off
  const number = remoteJid.replace(/[^0-9]/g, '');
  const [convRule, contactRule] = await Promise.all([
    getConversationRule(instance, remoteJid).catch(() => null),
    getContactRule(number).catch(() => null),
  ]);
  // OFF y HUMAN_ONLY bloquean respuestas automáticas del bot
  if (convRule === 'OFF' || convRule === 'HUMAN_ONLY' || contactRule === 'OFF' || contactRule === 'HUMAN_ONLY') {
    console.log(`[webhook] skipped reason=rule_block convRule=${convRule} contactRule=${contactRule} jid=${remoteJid}`);
    return;
  }

  // Extraer texto y tipo de media
  const msgContent = message.message ?? {};
  const text: string = (
    msgContent.conversation ||
    msgContent.extendedTextMessage?.text ||
    msgContent.imageMessage?.caption ||
    msgContent.videoMessage?.caption ||
    ''
  ).trim();

  const mediaType: string | null = (
    msgContent.audioMessage   ? 'audio'    :
    msgContent.imageMessage   ? 'image'    :
    msgContent.videoMessage   ? 'video'    :
    msgContent.documentMessage ? 'document' :
    msgContent.stickerMessage ? 'sticker'  :
    null
  );

  if (!text && !mediaType) {
    console.log(`[webhook] skipped reason=no_text jid=${remoteJid} msgType=${Object.keys(msgContent).join(',')}`);
    return;
  }

  // Mensajes de media sin texto: registrar en ticket, acknowledger y salir
  if (!text && mediaType) {
    console.log(`[webhook] media_only mediaType=${mediaType} jid=${remoteJid}`);
    const jidForReply = remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`;

    // Persistir el mensaje inbound al ticket (para que aparezca en el panel)
    await persistInboundMessage({ instance, remoteJid: jidForReply, msgId, text: `[${mediaType}]`, mediaType }).catch(e =>
      console.error(`[webhook] persist_inbound failed instance=${instance} jid=${jidForReply}:`, e?.message ?? e)
    );

    const mediaAck =
      mediaType === 'audio'    ? 'Recibí tu audio. ¿En qué te puedo ayudar? Escribime acá.' :
      mediaType === 'image'    ? '¡Vi tu imagen! Si querés info sobre algún auto, escribime.' :
      mediaType === 'video'    ? 'Recibí tu video. ¿En qué te puedo ayudar?' :
      mediaType === 'sticker'  ? null :
      'Recibí tu archivo. ¿En qué te puedo ayudar?';
    if (mediaAck) {
      await sendTextAndPersist(instance, jidForReply, mediaAck).catch(e =>
        console.error(`[send] media_ack failed instance=${instance} jid=${jidForReply}:`, e?.message ?? e)
      );
    }
    return;
  }

  console.log(`[webhook] received from=${number} instance=${instance} text="${text.slice(0, 80)}"`);

  try {
    // Estado actual
    const state = await getState(instance, remoteJid).catch(() => ({}));

    // Inteligencia
    const result = await processMessage({ instance, remoteJid, message: text, state });

    console.log(`[ai] response ready length=${result.reply?.length ?? 0} isHot=${result.isHot ?? false}`);

    // Guardar nuevo estado
    await setState(instance, remoteJid, result.newState as any).catch((e) =>
      console.error('[webhook] setState error:', e)
    );

    // Normalizar jid (garantizar @s.whatsapp.net)
    const normalizedJid = remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`;

    console.log(`[send] to=${normalizedJid} instance=${instance} payload_ready=true`);

    // Enviar respuesta de texto usando la instancia ya resuelta al inicio del handler
    await sendTextAndPersist(instance, normalizedJid, result.reply).catch(e => {
      console.error(`[send] evolution instance=${instance} failed status=${e?.message ?? e}`);
      throw e;
    });

    // Enviar fotos si las hay (hasta 5, secuencial para no saturar WhatsApp)
    if (result.imagesToSend?.length) {
      for (const imageUrl of result.imagesToSend.slice(0, 5)) {
        await sendImageAndPersist(instance, normalizedJid, imageUrl).catch(e =>
          console.error(`[send] evolution instance=${instance} image failed to ${normalizedJid}:`, e?.message ?? e)
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
