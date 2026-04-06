/**
 * conversationPriority.ts — Priorización de conversaciones para el panel humano (Fase 4)
 *
 * Traduce el score y la intención a un número de prioridad 1-5
 * que el panel puede usar para ordenar la bandeja de entrada.
 *
 * REGLAS:
 * - 5 = urgente, requiere acción en minutos
 * - 1 = frío, puede esperar días
 * - shouldNotifyHuman: true activa notificación al asesor en el panel
 */

import type { LeadScore } from './commercialScoring.js';
import type { IntentClassification } from './intentClassifier.js';
import type { NextBestAction } from './nextBestAction.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PriorityLabel = 'urgent' | 'high' | 'medium' | 'low' | 'cold';
export type ValueSignal = 'high' | 'medium' | 'low' | 'unknown';

export interface ConversationPriority {
  priority: 1 | 2 | 3 | 4 | 5;
  label: PriorityLabel;
  reason: string;
  shouldNotifyHuman: boolean;
  estimatedValueSignal: ValueSignal;
}

// ─── Función principal ───────────────────────────────────────────────────────

export function calculateConversationPriority(
  leadScore: LeadScore,
  intent: IntentClassification,
  nextAction: NextBestAction,
  extracted: Record<string, any>
): ConversationPriority {
  const { score, temperature } = leadScore;
  const primary = intent.primary;

  const hasBudget = Boolean(extracted?.maxPrice || extracted?.amount);
  const wantsFinancing = Boolean(extracted?.wantsFinancing);
  const hasTradeIn = Boolean(extracted?.hasTradeIn);
  const hasUrgency = Boolean(extracted?.highUrgency) || primary === 'urgent_purchase';

  // ── PRIORIDAD 5 (urgent) ──────────────────────────────────────────────────
  // hot + visita, urgencia real, o compra directa confirmada
  if (
    (temperature === 'hot' && primary === 'visit_intent') ||
    (temperature === 'hot' && primary === 'buy_intent') ||
    hasUrgency ||
    nextAction.action === 'handoff_to_human' ||
    nextAction.action === 'confirm_visit'
  ) {
    return {
      priority: 5,
      label: 'urgent',
      reason: hasUrgency
        ? 'Urgencia temporal confirmada'
        : primary === 'buy_intent'
          ? 'Intención de compra directa detectada'
          : 'Lead caliente con intención de visita confirmada',
      shouldNotifyHuman: true,
      estimatedValueSignal: 'high',
    };
  }

  // ── PRIORIDAD 4 (high) ────────────────────────────────────────────────────
  // hot sin visita, o tibio con financiación + presupuesto
  if (
    temperature === 'hot' ||
    (temperature === 'warm' && wantsFinancing && hasBudget) ||
    primary === 'follow_up_reengaged' && score >= 50
  ) {
    return {
      priority: 4,
      label: 'high',
      reason: temperature === 'hot'
        ? 'Lead caliente con múltiples señales de compra'
        : 'Lead tibio con financiación y presupuesto declarados',
      shouldNotifyHuman: temperature === 'hot',
      estimatedValueSignal: 'high',
    };
  }

  // ── PRIORIDAD 3 (medium) ──────────────────────────────────────────────────
  // tibio, o reengagement, o permuta detectada
  if (
    temperature === 'warm' ||
    primary === 'follow_up_reengaged' ||
    primary === 'trade_in_intent' ||
    hasTradeIn
  ) {
    return {
      priority: 3,
      label: 'medium',
      reason: primary === 'follow_up_reengaged'
        ? 'Lead volvió a contactar — señal de interés persistente'
        : hasTradeIn
          ? 'Lead con permuta — señal de compromiso real'
          : 'Lead tibio con intención detectada',
      shouldNotifyHuman: false,
      estimatedValueSignal: hasBudget ? 'medium' : 'unknown',
    };
  }

  // ── PRIORIDAD 2 (low) ─────────────────────────────────────────────────────
  // frío con alguna intención detectada
  if (
    temperature === 'cold' &&
    primary !== 'just_browsing' &&
    primary !== 'reclamo'
  ) {
    return {
      priority: 2,
      label: 'low',
      reason: 'Lead frío con alguna intención detectada — requiere seguimiento',
      shouldNotifyHuman: false,
      estimatedValueSignal: 'low',
    };
  }

  // ── PRIORIDAD 1 (cold) ────────────────────────────────────────────────────
  // solo mira, sin señales, primera consulta genérica
  return {
    priority: 1,
    label: 'cold',
    reason: primary === 'just_browsing'
      ? 'Solo está mirando opciones — sin señal de compra'
      : 'Primera consulta sin señales comerciales claras',
    shouldNotifyHuman: false,
    estimatedValueSignal: 'unknown',
  };
}
