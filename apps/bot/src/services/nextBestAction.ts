/**
 * nextBestAction.ts — Determina el próximo mejor paso comercial (Fase 4)
 *
 * Define qué debe hacer el bot o el vendedor humano en función del score,
 * la intención clasificada y el contexto acumulado del lead.
 *
 * REGLAS:
 * - No inventar acciones que el bot no puede ejecutar.
 * - Si requiere intervención humana, marcarlo explícito.
 * - La acción sugerida debe ser accionable de inmediato.
 */

import type { LeadScore } from './commercialScoring.js';
import type { IntentClassification } from './intentClassifier.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type NextAction =
  | 'ask_budget'
  | 'ask_trade_in_details'
  | 'offer_financing'
  | 'invite_to_visit'
  | 'send_matching_options'
  | 'clarify_or_broaden_search'
  | 'send_category_recommendations'
  | 'clarify_currency'
  | 'handoff_to_human'
  | 'follow_up_later'
  | 'request_contact_details'
  | 'confirm_visit'
  | 'send_pricing_info'
  | 'ask_urgency'
  | 'close_sale';

export interface NextBestAction {
  action: NextAction;
  reason: string;
  priority: number;         // 1-5, qué tan urgente es ejecutarla
  suggestedMessage?: string; // idea para el vendedor (no para el cliente directo)
  forHuman: boolean;
  forBot: boolean;
}

// ─── Función principal ───────────────────────────────────────────────────────

export function determineNextBestAction(
  leadScore: LeadScore,
  intent: IntentClassification,
  extracted: Record<string, any>
): NextBestAction {
  const { score, temperature } = leadScore;
  const primary = intent.primary;
  const secondary = intent.secondary;

  const hasBudget = Boolean(extracted?.maxPrice || extracted?.amount);
  const hasTradeIn = Boolean(extracted?.hasTradeIn);
  const hasTradeInDetails = Boolean(extracted?.tradeInYear && extracted?.tradeInKm);
  const wantsFinancing = Boolean(extracted?.wantsFinancing || primary === 'financing_intent' || secondary === 'financing_intent');
  const ambiguousCurrency = Boolean(extracted?.ambiguousCurrency);
  const hasName = Boolean(extracted?.name);
  const zeroExactMatches = extracted?.zeroExactMatches === true || Number(extracted?.vehiclesAfter ?? NaN) === 0;
  const lowConfidence = Number(intent.confidence ?? 0) < 0.65 || Boolean(extracted?.lowConfidenceIntent);
  const hasBroadContext = Boolean(
    hasBudget ||
    extracted?.year ||
    extracted?.minYear ||
    extracted?.maxYear ||
    extracted?.bodywork ||
    extracted?.useCase
  );

  // ── Moneda ambigua: siempre aclarar antes de cualquier otra acción ────────
  if (ambiguousCurrency) {
    return {
      action: 'clarify_currency',
      reason: 'El cliente mencionó un monto sin especificar si son pesos o dólares',
      priority: 5,
      suggestedMessage: 'Preguntarle si el monto mencionado es en pesos o dólares antes de mostrar opciones',
      forHuman: false,
      forBot: true,
    };
  }

  if (zeroExactMatches && lowConfidence) {
    return {
      action: hasBroadContext ? 'send_category_recommendations' : 'clarify_or_broaden_search',
      reason: 'La búsqueda cerrada quedó sin matches confirmados y la intención sigue siendo ambigua',
      priority: 4,
      suggestedMessage: hasBroadContext
        ? 'Abrir la búsqueda por categoría o uso real en vez de insistir con filtros sin stock.'
        : 'Hacer una sola pregunta útil para abrir la búsqueda y evitar seguir mostrando cero resultados.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── CALIENTE con compra directa o urgencia → handoff inmediato ────────────
  if (temperature === 'hot' && (primary === 'buy_intent' || primary === 'urgent_purchase')) {
    return {
      action: 'handoff_to_human',
      reason: 'Lead caliente con intención de compra o urgencia confirmada — requiere asesor humano ahora',
      priority: 5,
      suggestedMessage: 'Contactar de inmediato. El lead quiere comprar o tiene urgencia real.',
      forHuman: true,
      forBot: false,
    };
  }

  // ── CALIENTE con intención de visita → confirmar visita ──────────────────
  if (temperature === 'hot' && (primary === 'visit_intent' || extracted?.wantsVisit)) {
    return {
      action: 'confirm_visit',
      reason: 'Lead caliente con intención de visita confirmada',
      priority: 5,
      suggestedMessage: 'Coordinar horario de visita hoy o mañana. No dejar enfriar.',
      forHuman: true,
      forBot: false,
    };
  }

  // ── CALIENTE sin visita pero con presupuesto y financiación ──────────────
  if (temperature === 'hot' && wantsFinancing && hasBudget) {
    return {
      action: 'offer_financing',
      reason: 'Lead caliente con financiación y presupuesto declarados',
      priority: 4,
      suggestedMessage: 'Ofrecer simulación de cuotas concreta. Pedir anticipo y plazo si no están.',
      forHuman: true,
      forBot: true,
    };
  }

  // ── Urgencia (cualquier temperatura) ─────────────────────────────────────
  if (primary === 'urgent_purchase') {
    return {
      action: 'handoff_to_human',
      reason: 'Urgencia temporal confirmada — necesita respuesta inmediata de un asesor',
      priority: 5,
      suggestedMessage: 'Responder en los próximos 10 minutos. El cliente necesita el auto esta semana.',
      forHuman: true,
      forBot: false,
    };
  }

  // ── Reengagement → confirmar visita o mostrar opciones ───────────────────
  if (primary === 'follow_up_reengaged') {
    return {
      action: hasBudget ? 'confirm_visit' : 'send_matching_options',
      reason: 'Lead volvió a contactar — señal de interés persistente',
      priority: 4,
      suggestedMessage: hasBudget
        ? 'Retomar conversación con contexto. Proponer visita o avance concreto.'
        : 'Mostrar opciones relevantes según lo que buscaba antes.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Permuta sin detalles ──────────────────────────────────────────────────
  if ((primary === 'trade_in_intent' || hasTradeIn) && !hasTradeInDetails) {
    return {
      action: 'ask_trade_in_details',
      reason: 'El cliente mencionó permuta pero no compartió año ni km del usado',
      priority: 3,
      suggestedMessage: 'Pedir: año del auto a entregar + km actuales. Son necesarios para cotizar la parte de pago.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Financiación sin anticipo/cuotas ─────────────────────────────────────
  if (primary === 'financing_intent' || (wantsFinancing && !extracted?.cuotas && !extracted?.percent)) {
    return {
      action: 'offer_financing',
      reason: 'El cliente quiere financiación — pedir anticipo y plazo para simular',
      priority: 3,
      suggestedMessage: 'Preguntar: ¿cuánto ponés de anticipo y en cuántos meses querés pagarlo?',
      forHuman: false,
      forBot: true,
    };
  }

  // ── TIBIO sin presupuesto → preguntar presupuesto ────────────────────────
  if (temperature === 'warm' && !hasBudget) {
    return {
      action: 'ask_budget',
      reason: 'Lead tibio sin presupuesto declarado — un dato que destraba las opciones',
      priority: 3,
      suggestedMessage: 'Preguntar por rango de precio de forma natural: "¿Tenés un techo de presupuesto en mente?"',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Comparación de vehículos → mostrar opciones ──────────────────────────
  if (primary === 'compare_vehicles') {
    return {
      action: 'send_matching_options',
      reason: 'El cliente está comparando — necesita opciones concretas para decidir',
      priority: 3,
      suggestedMessage: 'Mostrar 2-3 opciones con diferencias clave. Tomar posición según uso declarado.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Check de precio o disponibilidad → enviar opciones ───────────────────
  if (primary === 'price_check' || primary === 'availability_check') {
    return {
      action: 'send_matching_options',
      reason: 'El cliente consulta precio o stock — responder con catálogo real',
      priority: 2,
      suggestedMessage: 'Mostrar opciones del catálogo que coincidan con el perfil del lead.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── FRÍO solo mirando → mostrar opciones (sin datos → warm-up) ───────────
  if (temperature === 'cold' && primary === 'just_browsing') {
    return {
      action: 'send_matching_options',
      reason: 'Lead frío explorando — mostrar opciones activa el interés',
      priority: 1,
      suggestedMessage: 'Compartir 2-3 opciones populares. No presionar. Dejar que reaccione.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Sin contacto todavía → pedir datos si el lead es tibio+ ─────────────
  if (!hasName && score >= 40) {
    return {
      action: 'request_contact_details',
      reason: 'Lead con intención pero sin datos de contacto — capturar antes de que se vaya',
      priority: 2,
      suggestedMessage: 'Pedir nombre y si es posible teléfono, de forma natural al cerrar la respuesta.',
      forHuman: false,
      forBot: true,
    };
  }

  // ── Default: seguimiento futuro ───────────────────────────────────────────
  return {
    action: 'follow_up_later',
    reason: 'No hay señal suficiente para acción inmediata — registrar para seguimiento',
    priority: 1,
    suggestedMessage: 'Dejar conversación abierta. Si no responde en 48h, retomar con novedad del catálogo.',
    forHuman: false,
    forBot: false,
  };
}
