/**
 * hotLead.ts — Detección de leads calientes + notificación por WhatsApp.
 *
 * Un lead es caliente cuando el cliente ya pasó la etapa de exploración
 * y muestra intención real de avanzar (precio, entrega, visita, reserva, etc.)
 *
 * Notificación: manda resumen corto a ADVISOR_WHATSAPP_NUMBER (env var)
 * reutilizando evolutionSendText — la misma infraestructura que usa el bot.
 */

import { evolutionSendText } from './evolution.js';
import { env } from '../lib/env.js';
import type { ConvState } from './state.js';

// ── Señales de lead caliente ───────────────────────────────────────────────────

const HOT_SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\b(cuotas?|financ|crédito|credito|banco|cuánto sería|cómo financ)\b/i, weight: 3, label: 'financiación' },
  { pattern: /\b(entrega|anticipo|seña|señ|enganch|down payment)\b/i,                weight: 3, label: 'entrega' },
  { pattern: /\b(quiero verlo|ir a ver|test drive|probarlo|puedo ir)\b/i,            weight: 4, label: 'visita' },
  { pattern: /\b(reserv|apart|lo tomo|me lo llevo|lo compro|cerramos)\b/i,          weight: 5, label: 'cierre' },
  { pattern: /\b(documentac|transfiero|transferencia|forma de pago|precio final)\b/i,weight: 4, label: 'documentación' },
  { pattern: /\b(ubicac|dirección|dónde están|cuándo puedo|horario)\b/i,            weight: 2, label: 'logística' },
  { pattern: /\b(permuta|lo entrego|cambio|parte de pago|tengo un usado)\b/i,       weight: 3, label: 'permuta' },
  { pattern: /\b(hablame de ese|ese me interesa|me convence|cuánto vale ese)\b/i,   weight: 3, label: 'interés concreto' },
];

export interface HotLeadSignal {
  label: string;
  weight: number;
}

export interface HotLeadResult {
  isHot: boolean;
  score: number;
  signals: HotLeadSignal[];
}

export function detectHotLead(message: string, state: ConvState): HotLeadResult {
  const signals: HotLeadSignal[] = [];
  let score = 0;

  for (const s of HOT_SIGNALS) {
    if (s.pattern.test(message)) {
      signals.push({ label: s.label, weight: s.weight });
      score += s.weight;
    }
  }

  // Boost si ya vio autos concretos
  if (state.last_hits && state.last_hits.length > 0) score += 2;
  // Boost si ya pasó por cotización de crédito
  if (state.last_intent === 'credit_quote') score += 2;
  // Boost si hay mensaje de usuario previo (no es primer contacto)
  if ((state.user_msg_count ?? 0) >= 3) score += 1;

  return { isHot: score >= 5, score, signals };
}

// ── Dedup para no spamear ─────────────────────────────────────────────────────

const notifiedLeads = new Map<string, number>();
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos entre alertas del mismo lead

function shouldNotify(key: string): boolean {
  const last = notifiedLeads.get(key);
  if (!last) return true;
  return Date.now() - last > NOTIFY_COOLDOWN_MS;
}

// ── Notificación ──────────────────────────────────────────────────────────────

export interface HotLeadContext {
  instance: string;
  remoteJid: string;
  state: ConvState;
  lastMessage: string;
  signals: HotLeadSignal[];
}

export async function notifyHotLead(ctx: HotLeadContext): Promise<void> {
  const advisorNumber = process.env.ADVISOR_WHATSAPP_NUMBER;
  if (!advisorNumber) return;

  const key = `${ctx.instance}:${ctx.remoteJid}`;
  if (!shouldNotify(key)) return;

  notifiedLeads.set(key, Date.now());

  const number = ctx.remoteJid.replace(/[^0-9]/g, '');
  const vehiculos = (() => {
    if (ctx.state.lastPresentedVehicleTitle) return ctx.state.lastPresentedVehicleTitle;
    if (Array.isArray(ctx.state.last_hits) && ctx.state.last_hits.length > 0)
      return ctx.state.last_hits.slice(0, 3).join(', ');
    return ctx.state.last_query || '—';
  })();

  const presupuesto = ctx.state.search_context?.maxPrice
    ? `$${Math.round(ctx.state.search_context.maxPrice).toLocaleString('es-AR')}`
    : '—';

  const lines = [
    `🔥 *Lead caliente* — ${new Date().toLocaleTimeString('es-AR')}`,
    `📱 Número: +${number}`,
    `🚗 Interés: ${vehiculos}`,
    `💰 Presupuesto: ${presupuesto}`,
    `📌 Señales: ${ctx.signals.map(s => s.label).join(', ')}`,
    `💬 Último msg: "${ctx.lastMessage.slice(0, 120)}"`,
    `➡️ Sugerencia: contactar ahora para cerrar.`,
  ];

  const text = lines.join('\n');

  try {
    await evolutionSendText(env.instanceName, `${advisorNumber}@s.whatsapp.net`, text);
    console.log(`[hotLead] Notificación enviada para ${key}`);
  } catch (err: any) {
    console.error('[hotLead] Error enviando notificación:', err?.message);
  }
}
