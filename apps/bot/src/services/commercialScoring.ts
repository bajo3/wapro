/**
 * commercialScoring.ts — Scoring de lead basado en señales reales de conversación (Fase 4)
 *
 * Construye sobre extract.ts: usa los campos ya extraídos + texto del mensaje
 * para producir un score 0-100, temperatura y señales detectadas.
 *
 * REGLAS:
 * - Acumulativo: cada señal suma/resta.
 * - Ponderado: visita y compra pesan más.
 * - Nunca inventa datos: solo opera sobre campos concretos del extracted context.
 * - Compatible con lead.ts: no lo reemplaza, lo enriquece con señales comerciales.
 */

import type { IntentClassification } from './intentClassifier.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SignalType =
  | 'price_inquiry'
  | 'financing_inquiry'
  | 'installment_inquiry'
  | 'trade_in_intent'
  | 'visit_intent'
  | 'urgency'
  | 'budget_declared'
  | 'vehicle_comparison'
  | 'purchase_intent'
  | 'reengaged'
  | 'contact_shared'
  | 'financing_approved'
  | 'just_browsing'
  | 'price_objection';

export interface SalesSignal {
  type: SignalType;
  weight: number;
  detected: boolean;
  evidence?: string;
}

export type LeadTemperature = 'cold' | 'warm' | 'hot';

export interface LeadScore {
  score: number;              // 0-100
  temperature: LeadTemperature;
  signals: SalesSignal[];
  reason: string;
  confidence: number;         // 0-1
}

// ─── Pesos de señales ─────────────────────────────────────────────────────────

const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  purchase_intent:       25,
  visit_intent:          20,
  financing_approved:    20,
  contact_shared:        15,
  urgency:               15,
  financing_inquiry:     15,
  installment_inquiry:   12,
  trade_in_intent:       12,
  reengaged:             10,
  budget_declared:       10,
  price_inquiry:         10,
  vehicle_comparison:     8,
  just_browsing:        -20,
  price_objection:       -5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function detectSignal(
  type: SignalType,
  detected: boolean,
  evidence?: string
): SalesSignal {
  return {
    type,
    weight: SIGNAL_WEIGHTS[type],
    detected,
    evidence,
  };
}

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * computeCommercialScore — calcula el score comercial del lead.
 *
 * @param text - mensaje actual del usuario
 * @param extracted - contexto extraído acumulado (de extract.ts)
 * @param intent - clasificación de intención (de intentClassifier.ts)
 * @param prevScore - score previo (para acumulación entre turnos, opcional)
 */
export function computeCommercialScore(
  text: string,
  extracted: Record<string, any>,
  intent?: IntentClassification,
  prevScore?: number
): LeadScore {
  const t = n(text);
  const signals: SalesSignal[] = [];

  // ── Señal: intención de compra directa ──────────────────────────────────────
  const hasPurchaseIntent =
    intent?.primary === 'buy_intent' ||
    Boolean(extracted?.closingIntent) ||
    /\b(?:me\s+lo\s+llevo|lo\s+compro|reservar?(?:lo)?|sen[aá](?:r(?:lo)?)?|apartar?(?:lo)?|cerramos|hacemos\s+algo|quiero\s+(?:ese|esa)|vamos\s+con|abonar|pagar)\b/.test(t);
  signals.push(detectSignal('purchase_intent', hasPurchaseIntent, hasPurchaseIntent ? 'intención de compra detectada' : undefined));

  // ── Señal: visita ───────────────────────────────────────────────────────────
  const hasVisitIntent =
    intent?.primary === 'visit_intent' ||
    intent?.secondary === 'visit_intent' ||
    Boolean(extracted?.wantsVisit) ||
    /\b(?:quiero\s+(?:ir|verlo|pasar)|paso\s+a\s+verlo|puedo\s+(?:ir|pasar)|test\s*drive|probar(?:lo)?|cuando\s+(?:puedo\s+)?(?:ir|pasar|verlo))\b/.test(t);
  signals.push(detectSignal('visit_intent', hasVisitIntent, hasVisitIntent ? 'interés en visita' : undefined));

  // ── Señal: urgencia temporal ────────────────────────────────────────────────
  const hasUrgency =
    intent?.primary === 'urgent_purchase' ||
    Boolean(extracted?.highUrgency) ||
    /\b(?:esta\s+semana|para\s+ma[nñ]ana|para\s+hoy|lo\s+quiero\s+(?:hoy|ya)|cuanto\s+antes|urgente\s+lo\s+necesito)\b/.test(t);
  signals.push(detectSignal('urgency', hasUrgency, hasUrgency ? 'urgencia temporal' : undefined));

  // ── Señal: financiación ─────────────────────────────────────────────────────
  const hasFinancingInquiry =
    intent?.primary === 'financing_intent' ||
    Boolean(extracted?.wantsFinancing) ||
    /\b(?:financian?|financiaci[oó]n|cr[eé]dito|banco|prestamo|plan\s+de\s+pago|se\s+puede\s+financiar)\b/.test(t);
  signals.push(detectSignal('financing_inquiry', hasFinancingInquiry, hasFinancingInquiry ? 'consulta de financiación' : undefined));

  // ── Señal: cuotas / anticipo ────────────────────────────────────────────────
  const hasInstallmentInquiry =
    Boolean(extracted?.cuotas) ||
    Boolean(extracted?.percent) ||
    /\b(?:cu[aá]ntas?\s+cuotas?|en\s+cuotas?|anticipo|cuota\s+(?:mensual|fija)|meses?\s+(?:de\s+)?plazo)\b/.test(t);
  signals.push(detectSignal('installment_inquiry', hasInstallmentInquiry, hasInstallmentInquiry ? 'consulta de cuotas/anticipo' : undefined));

  // ── Señal: permuta ──────────────────────────────────────────────────────────
  const hasTradeIn =
    intent?.primary === 'trade_in_intent' ||
    intent?.secondary === 'trade_in_intent' ||
    Boolean(extracted?.hasTradeIn);
  signals.push(detectSignal('trade_in_intent', hasTradeIn, hasTradeIn ? 'intención de permuta' : undefined));

  // ── Señal: presupuesto declarado ────────────────────────────────────────────
  const hasBudget =
    Boolean(extracted?.maxPrice) ||
    Boolean(extracted?.amount);
  signals.push(detectSignal('budget_declared', hasBudget, hasBudget ? `presupuesto declarado: ${extracted?.currency ?? 'ARS'} ${extracted?.maxPrice ?? extracted?.amount}` : undefined));

  // ── Señal: consulta de precio ───────────────────────────────────────────────
  const hasPriceInquiry =
    intent?.primary === 'price_check' ||
    /\b(?:cu[aá]nto\s+(?:sale|cuesta|vale|est[aá])|precio\s+de|en\s+cu[aá]nto\s+est[aá]|qu[eé]\s+precio)\b/.test(t);
  signals.push(detectSignal('price_inquiry', hasPriceInquiry, hasPriceInquiry ? 'consulta de precio' : undefined));

  // ── Señal: comparación ──────────────────────────────────────────────────────
  const hasComparison =
    intent?.primary === 'compare_vehicles' ||
    /\b(?:o\s+el\s+\w+|entre\s+el|cu[aá]l\s+conviene|diferencia\s+entre|vs\s+|versus)\b/.test(t);
  signals.push(detectSignal('vehicle_comparison', hasComparison, hasComparison ? 'comparación de vehículos' : undefined));

  // ── Señal: reengagement ─────────────────────────────────────────────────────
  const hasReengaged =
    intent?.primary === 'follow_up_reengaged' ||
    /\b(?:me\s+hablaste|hablamos\s+(?:antes|ayer)|sigo\s+interesado|volv[ií]\s+a\s+escribir|retomo)\b/.test(t);
  signals.push(detectSignal('reengaged', hasReengaged, hasReengaged ? 'lead volvió a contactar' : undefined));

  // ── Señal: datos de contacto compartidos ────────────────────────────────────
  const hasContact =
    Boolean(extracted?.name) ||
    /\b(?:mi\s+(?:nombre\s+es|numero\s+es|tel[eé]fono\s+es)|soy\s+[a-z]+|me\s+llamo|te\s+dejo\s+mi\s+(?:numero|contacto|whatsapp))\b/.test(t);
  signals.push(detectSignal('contact_shared', hasContact, hasContact ? 'compartió datos personales' : undefined));

  // ── Señal negativa: solo mirando ────────────────────────────────────────────
  const isJustBrowsing =
    intent?.primary === 'just_browsing' ||
    /\b(?:solo\s+estoy\s+mirando|s[oó]lo\s+(?:miro|curiosidad)|por\s+curiosidad|sin\s+apuro|no\s+tengo\s+apuro|por\s+ahora\s+nada)\b/.test(t);
  signals.push(detectSignal('just_browsing', isJustBrowsing, isJustBrowsing ? 'indica que solo está mirando' : undefined));

  // ── Señal negativa: objeción de precio ──────────────────────────────────────
  const hasPriceObjection =
    intent?.primary === 'objection' ||
    /\b(?:est[aá]\s+caro|me\s+parece\s+caro|es\s+mucho|no\s+llego|no\s+me\s+alcanza|supera\s+mi\s+presupuesto|muy\s+caro)\b/.test(t);
  signals.push(detectSignal('price_objection', hasPriceObjection, hasPriceObjection ? 'objeción de precio' : undefined));

  // ── Calcular score ────────────────────────────────────────────────────────
  let rawScore = signals
    .filter((s) => s.detected)
    .reduce((sum, s) => sum + s.weight, 0);

  // Incorporar score previo con peso menor (continuidad entre turnos)
  if (typeof prevScore === 'number' && prevScore > 0) {
    rawScore = Math.round(rawScore * 0.7 + prevScore * 0.3);
  }

  const score = Math.max(0, Math.min(100, rawScore));

  // ── Temperatura ───────────────────────────────────────────────────────────
  const temperature: LeadTemperature =
    score >= 70 ? 'hot' :
    score >= 30 ? 'warm' :
    'cold';

  // ── Confianza (basada en cantidad de señales positivas detectadas) ────────
  const detectedPositive = signals.filter((s) => s.detected && s.weight > 0).length;
  const confidence = Math.min(1, detectedPositive * 0.18 + 0.25);

  // ── Razón legible ─────────────────────────────────────────────────────────
  const detectedSignals = signals.filter((s) => s.detected);
  const reason = detectedSignals.length > 0
    ? `Señales detectadas: ${detectedSignals.map((s) => s.type).join(', ')}`
    : 'Sin señales comerciales claras detectadas';

  return { score, temperature, signals, reason, confidence };
}
