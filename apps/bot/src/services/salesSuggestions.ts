/**
 * salesSuggestions.ts — Sugerencias concretas al vendedor humano (Fase 4)
 *
 * Genera recomendaciones accionables para el asesor de ventas
 * basadas en el score, intención y próximo paso recomendado.
 *
 * REGLAS:
 * - Las sugerencias son para el vendedor, no para el cliente.
 * - No inventar términos de financiación, precios ni disponibilidad.
 * - Tono directo, accionable, sin relleno.
 */

import type { LeadScore } from './commercialScoring.js';
import type { IntentClassification } from './intentClassifier.js';
import type { NextBestAction } from './nextBestAction.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SuggestionUrgency = 'now' | 'today' | 'this_week' | 'when_available';

export interface SalesSuggestion {
  suggestedAction: string;
  suggestedReplyStrategy: string;
  humanHandoffReason?: string;
  urgency: SuggestionUrgency;
  scriptHint?: string;
}

// ─── Función principal ───────────────────────────────────────────────────────

export function generateSalesSuggestions(
  leadScore: LeadScore,
  intent: IntentClassification,
  nextAction: NextBestAction,
  extracted: Record<string, any>
): SalesSuggestion {
  const { temperature, score } = leadScore;
  const primary = intent.primary;
  const action = nextAction.action;

  const hasBudget = Boolean(extracted?.maxPrice || extracted?.amount);
  const hasTradeIn = Boolean(extracted?.hasTradeIn);
  const wantsFinancing = Boolean(extracted?.wantsFinancing);
  const brand = extracted?.brand ? String(extracted.brand) : null;
  const model = extracted?.model ? String(extracted.model) : null;
  const vehicleRef = model ? `${brand ? brand + ' ' : ''}${model}` : brand ? brand : 'el vehículo';

  // ── Reclamo → escalada inmediata ─────────────────────────────────────────
  if (primary === 'reclamo') {
    return {
      suggestedAction: 'Tomar el reclamo de inmediato. No dejar que el bot continúe.',
      suggestedReplyStrategy: 'Empatía primero, solución después. No pedir más datos antes de reconocer el problema.',
      humanHandoffReason: 'Cliente con reclamo activo — requiere atención humana urgente',
      urgency: 'now',
      scriptHint: '"Entendo la situación. Me encargo personalmente. ¿Podemos hablar en los próximos minutos?"',
    };
  }

  // ── Compra directa o urgencia ─────────────────────────────────────────────
  if (primary === 'buy_intent' || primary === 'urgent_purchase') {
    return {
      suggestedAction: `Contactar ahora. El cliente quiere ${primary === 'urgent_purchase' ? 'el auto esta semana' : 'comprar'}.`,
      suggestedReplyStrategy: 'Confirmar disponibilidad de ' + vehicleRef + ' y proponer horario de visita o seña.',
      humanHandoffReason: 'Intención de compra confirmada — el bot ya no puede avanzar más',
      urgency: 'now',
      scriptHint: '"Te confirmo disponibilidad y te cuento cómo arrancamos. ¿Podemos hablar hoy?"',
    };
  }

  // ── Visita ────────────────────────────────────────────────────────────────
  if (primary === 'visit_intent' || action === 'confirm_visit') {
    return {
      suggestedAction: 'Coordinar visita hoy o mañana. No dejar pasar más de 2 horas.',
      suggestedReplyStrategy: 'Confirmar horario disponible de la agencia. Ofrecer 2 opciones concretas.',
      humanHandoffReason: 'El cliente quiere visitar — el bot no puede coordinar agenda',
      urgency: 'today',
      scriptHint: '"¿Te viene bien mañana a la mañana o preferís a la tarde? Reservo el auto para que lo veas."',
    };
  }

  // ── Reengagement ──────────────────────────────────────────────────────────
  if (primary === 'follow_up_reengaged') {
    return {
      suggestedAction: 'Retomar con contexto previo. No hacerlo arrancar de cero.',
      suggestedReplyStrategy: 'Mencionar el vehículo que estuvo mirando. Preguntar si sigue interesado en ese o quiere ver novedades.',
      urgency: 'today',
      scriptHint: `"Hola, te escribo porque volviste a contactarnos. ¿Seguís interesado en ${vehicleRef}? Tengo novedades."`,
    };
  }

  // ── Financiación ──────────────────────────────────────────────────────────
  if (wantsFinancing || action === 'offer_financing') {
    return {
      suggestedAction: hasBudget
        ? 'Simular cuotas con el anticipo implícito del presupuesto declarado.'
        : 'Pedir anticipo y plazo para simular cuotas concretas.',
      suggestedReplyStrategy: 'No inventar tasas ni cuotas. Pedir datos, luego calcular.',
      urgency: temperature === 'hot' ? 'today' : 'this_week',
      scriptHint: '"¿Cuánto podés poner de anticipo y en cuántos meses lo querés pagar? Con eso te paso la cuota exacta."',
    };
  }

  // ── Permuta ───────────────────────────────────────────────────────────────
  if (action === 'clarify_or_broaden_search' || action === 'send_category_recommendations') {
    return {
      suggestedAction: 'Abrir la búsqueda por categoría amplia o por uso, sin insistir con filtros que ya dieron sin stock.',
      suggestedReplyStrategy: 'Hacer una sola pregunta útil o proponer categorías como auto chico, familiar, ciudad, ruta, trabajo o primer auto.',
      urgency: 'today',
      scriptHint: '"Con esos filtros cerrados no tengo match confirmado ahora. Si querés, lo abro por categoría: auto chico, familiar, ciudad, ruta, trabajo o primer auto."',
    };
  }

  if (hasTradeIn || action === 'ask_trade_in_details') {
    return {
      suggestedAction: 'Pedir detalles del usado: año, km, estado general.',
      suggestedReplyStrategy: 'Explicar que el monto de la permuta se descuenta del precio — reduce el desembolso inicial.',
      urgency: 'this_week',
      scriptHint: '"Para cotizar tu entrega necesito: año, km y si tiene GNC o no. ¿Me pasás esos datos?"',
    };
  }

  // ── CALIENTE sin acción específica ────────────────────────────────────────
  if (temperature === 'hot') {
    return {
      suggestedAction: 'Lead caliente. Contactar antes de que pase a la competencia.',
      suggestedReplyStrategy: 'Ofrecer algo concreto: visita, seña, cotización formal.',
      humanHandoffReason: 'Score alto — requiere asesor para cerrar',
      urgency: 'today',
    };
  }

  // ── TIBIO con presupuesto ─────────────────────────────────────────────────
  if (temperature === 'warm' && hasBudget) {
    return {
      suggestedAction: `Mostrar opciones de ${vehicleRef} dentro del presupuesto declarado.`,
      suggestedReplyStrategy: 'Presentar 2-3 opciones concretas del catálogo. No preguntar más datos si ya hay suficientes.',
      urgency: 'this_week',
    };
  }

  // ── TIBIO sin presupuesto ─────────────────────────────────────────────────
  if (temperature === 'warm') {
    return {
      suggestedAction: 'Obtener presupuesto del cliente antes de mostrar opciones.',
      suggestedReplyStrategy: 'Una sola pregunta: "¿Tenés un rango de precio en mente?" — no pedir más de eso por turno.',
      urgency: 'this_week',
    };
  }

  // ── FRÍO / sin señal ──────────────────────────────────────────────────────
  return {
    suggestedAction: 'Registrar lead. Retomar si no responde en 48 horas.',
    suggestedReplyStrategy: 'Mostrar 2 opciones populares del catálogo para activar interés. No presionar.',
    urgency: 'when_available',
    scriptHint: '"Che, tenemos novedades en el catálogo que pueden interesarte. ¿Le doy un vistazo con vos?"',
  };
}
