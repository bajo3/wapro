/**
 * objectionWorker.ts — Detector y clasificador de objeciones.
 *
 * Analiza el mensaje y el estado para determinar si hay una objeción
 * activa y de qué tipo es. Informa al router qué skill usar.
 *
 * Tipos de objeción:
 * - PRICE_TOO_HIGH     → "es caro", "no llego", "tiene algo más barato?"
 * - NO_EXACT_MATCH     → "no tengo lo que busco", sin_match previo
 * - NEEDS_TIME         → "lo pienso", "no me urge", "ya te aviso"
 * - FINANCING_CONCERN  → "no sé si califico", "tengo deudas", "si me aprueban"
 * - BRAND_PREFERENCE   → "prefiero otra marca", "no me convence la marca"
 * - GENERAL_DOUBT      → "no sé", "no me convence", objeción vaga
 */

import type { Extracted } from '../botIntelligence.js';
import type { ConvState } from '../state.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type ObjectionType =
  | 'PRICE_TOO_HIGH'
  | 'NO_EXACT_MATCH'
  | 'NEEDS_TIME'
  | 'FINANCING_CONCERN'
  | 'BRAND_PREFERENCE'
  | 'GENERAL_DOUBT'
  | 'NONE';

export interface ObjectionResult {
  type: ObjectionType;
  detected: boolean;
  confidence: 'high' | 'medium' | 'low';
  skillHint?: string;  // Skill a aplicar
}

// ── Patrones de detección ──────────────────────────────────────────────────────

const PRICE_PATTERNS = [
  /me\s+parece?\s+caro/i,
  /no\s+llego\s+(?:al?\s+)?presupuesto/i,
  /tiene[sn]?\s+algo\s+más\s+barato/i,
  /muy\s+caro/i,
  /no\s+me\s+alcanza/i,
  /fuera\s+de\s+(?:mi\s+)?presupuesto/i,
  /está\s+(?:muy\s+)?caro/i,
];

const TIME_PATTERNS = [
  /lo\s+pienso/i,
  /ya\s+te\s+aviso/i,
  /no\s+me\s+urge/i,
  /lo\s+veo\s+después/i,
  /más\s+adelante/i,
  /todavía\s+no\s+estoy\s+(?:listo|lista|decidido)/i,
];

const FINANCING_PATTERNS = [
  /no\s+sé\s+si\s+calific[oa]/i,
  /tengo\s+(?:una?\s+)?deuda/i,
  /si\s+me\s+aprueban/i,
  /historial\s+(?:crediticio|de\s+crédito)/i,
  /banco\s+(?:me|no)\s+(?:aprueba|presta)/i,
];

const BRAND_PATTERNS = [
  /prefiero\s+(?:otra\s+)?marca/i,
  /no\s+me\s+(?:convence|gusta)\s+(?:la\s+)?(?:marca|marca del)/i,
  /tenía\s+en\s+mente\s+(?:un|una)\s+\w+/i,
];

// ── Worker principal ───────────────────────────────────────────────────────────

/**
 * Detecta si hay una objeción en el mensaje actual y la clasifica.
 * No usa GPT — es determinístico y rápido.
 */
export function detectObjection(
  message: string,
  ex: Extracted,
  state: ConvState
): ObjectionResult {
  const msg = message.toLowerCase();

  // Objeción de precio — leadMode=price_sensitive es la señal más fuerte
  if (ex.leadMode === 'price_sensitive' || PRICE_PATTERNS.some(p => p.test(msg))) {
    return {
      type: 'PRICE_TOO_HIGH',
      detected: true,
      confidence: ex.leadMode === 'price_sensitive' ? 'high' : 'medium',
      skillHint: 'price-objection',
    };
  }

  // Financing concern
  if (FINANCING_PATTERNS.some(p => p.test(msg))) {
    return {
      type: 'FINANCING_CONCERN',
      detected: true,
      confidence: 'medium',
      skillHint: 'financing',
    };
  }

  // Necesita tiempo
  if (TIME_PATTERNS.some(p => p.test(msg))) {
    return {
      type: 'NEEDS_TIME',
      detected: true,
      confidence: 'medium',
      skillHint: 'indecision',
    };
  }

  // Sin match previo (el bot respondió sin_match en el turno anterior)
  if (state.last_intent === 'sin_match' && ex.intent === 'search') {
    return {
      type: 'NO_EXACT_MATCH',
      detected: true,
      confidence: 'medium',
      skillHint: 'no-match',
    };
  }

  // Preferencia de marca
  if (BRAND_PATTERNS.some(p => p.test(msg))) {
    return {
      type: 'BRAND_PREFERENCE',
      detected: true,
      confidence: 'medium',
      skillHint: 'no-match',
    };
  }

  // Objeción genérica elevada (muchas objeciones seguidas)
  if ((state.objection_count ?? 0) >= 3) {
    return {
      type: 'GENERAL_DOUBT',
      detected: true,
      confidence: 'low',
      skillHint: 'human-handoff',
    };
  }

  return { type: 'NONE', detected: false, confidence: 'low' };
}

/**
 * Cuenta cuántas objeciones ha tenido el lead en esta conversación.
 * Se incrementa cuando detectObjection retorna detected=true.
 */
export function incrementObjectionCount(state: ConvState): number {
  return (state.objection_count ?? 0) + 1;
}
