import fetch from 'node-fetch';
import { createHash } from 'node:crypto';
import { evolutionSendImage, evolutionSendText } from './evolution.js';

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
}) {
  const backendUrl = String(process.env.BACKEND_URL || '').replace(/\/$/, '');
  const adminToken = String(process.env.BOT_ADMIN_TOKEN || '').trim();
  const remoteJid = normalizeRemoteJid(params.remoteJid);
  const text = String(params.text || '').trim();
  const imageUrl = typeof params.imageUrl === 'string' && params.imageUrl.trim() ? params.imageUrl.trim() : undefined;
  if (!backendUrl || !adminToken || !remoteJid || (!text && !imageUrl)) return;

  const number = extractNumber(remoteJid);
  if (!number) return;

  const syntheticId = `bot-${params.instance}-${number}-${Date.now()}-${hashString(`${text}|${imageUrl || ''}`)}`;

  try {
    const response = await fetch(`${backendUrl}/webhooks/bot/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({
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
        handoff: Boolean(params.handoff)
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('Failed to persist bot outbound message', {
        status: response.status,
        statusText: response.statusText,
        body,
        instance: params.instance,
        remoteJid
      });
    }
  } catch (err) {
    console.error('Failed to persist bot outbound message', err);
  }
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
) {
  const remoteJid = normalizeRemoteJid(remoteJidOrNumber);
  const number = extractNumber(remoteJid);
  const body = String(text || '').trim();
  if (!number || !body) return;
  await evolutionSendText(instance, number, body);
  await persistBotOutboundMessage({
    instance,
    remoteJid,
    text: body,
    mediaType: null,
    ticketStatus: options?.ticketStatus,
    botMode: options?.botMode,
    handoff: options?.handoff
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
) {
  const remoteJid = normalizeRemoteJid(remoteJidOrNumber);
  const number = extractNumber(remoteJid);
  const url = String(imageUrl || '').trim();
  const text = String(caption || '').trim();
  if (!number || !url) return;
  await evolutionSendImage(instance, number, url, text || undefined);
  await persistBotOutboundMessage({
    instance,
    remoteJid,
    text,
    imageUrl: url,
    mediaType: 'image',
    ticketStatus: options?.ticketStatus,
    botMode: options?.botMode,
    handoff: options?.handoff
  });
}
