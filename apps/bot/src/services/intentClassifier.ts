/**
 * intentClassifier.ts — Clasificación de intención comercial real (Fase 4)
 *
 * Clasifica la intención principal y secundaria del mensaje del cliente
 * a partir de señales textuales + campos ya extraídos por extract.ts.
 *
 * REGLAS:
 * - No inventar intención sin evidencia textual o contextual mínima.
 * - El contexto acumulado (extracted) puede reforzar la clasificación.
 * - Confianza baja = señal débil, el bot debe tratarla con más cautela.
 */

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type CommercialIntent =
  | 'buy_intent'
  | 'financing_intent'
  | 'trade_in_intent'
  | 'visit_intent'
  | 'availability_check'
  | 'price_check'
  | 'compare_vehicles'
  | 'just_browsing'
  | 'follow_up_reengaged'
  | 'urgent_purchase'
  | 'objection'
  | 'reclamo';

export interface IntentClassification {
  primary: CommercialIntent;
  secondary?: CommercialIntent;
  confidence: number;     // 0-1
  evidence: string;       // texto que disparó la clasificación
  multipleIntents: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// ─── Reglas de clasificación ─────────────────────────────────────────────────

interface IntentRule {
  intent: CommercialIntent;
  pattern: RegExp;
  confidence: number;
}

const INTENT_RULES: IntentRule[] = [
  // Reclamo — prioridad máxima para no confundirlo con intención de compra
  {
    intent: 'reclamo',
    pattern: /\b(?:furioso|enojado|harto|mandaron\s+mal|reclam[ao]|quejarme|mal\s+vendido|estafado|problema\s+con\s+el\s+auto|no\s+funciona|falla|defecto|garantia\s+no\s+cumpl)\b/,
    confidence: 0.95,
  },

  // Urgencia de compra — combina urgencia temporal + intención
  {
    intent: 'urgent_purchase',
    pattern: /\b(?:esta\s+semana|para\s+ma[nñ]ana|para\s+hoy|lo\s+quiero\s+(?:hoy|ya)|lo\s+necesito\s+(?:ya|urgente|r[aá]pido)|cuanto\s+antes|cuando\s+antes|urgente\s+lo\s+necesito|necesito\s+si\s+o\s+si)\b/,
    confidence: 0.90,
  },

  // Intención de visita
  {
    intent: 'visit_intent',
    pattern: /\b(?:quiero\s+(?:ir\s+a\s+)?verlo|paso\s+a\s+verlo|puedo\s+(?:ir|pasar)|cuando\s+(?:puedo\s+)?(?:ir|pasar|verlo)|quisiera\s+ir|voy\s+a\s+verlo|quiero\s+(?:ir\s+a\s+la\s+)?agencia|quiero\s+verlos?|paso\s+hoy|test\s*drive|probar(?:lo)?|puedo\s+ir\s+hoy)\b/,
    confidence: 0.88,
  },

  // Intención directa de compra
  {
    intent: 'buy_intent',
    pattern: /\b(?:quiero\s+comprar(?:lo|la)?|c[oó]mo\s+hago\s+para\s+comprar|cuanto\s+sale\s+para\s+llevarme?lo|me\s+lo\s+llevo|lo\s+compro|reservar?(?:lo)?|sen[aá](?:r(?:lo)?)?|apartar?(?:lo)?|cerramos|hacemos\s+algo|quiero\s+(?:ese|ese\s+auto|esa\s+moto|esa\s+camioneta)|vamos\s+con|abonar|pagar|hacer\s+la\s+compra|efectivo\s+ya)\b/,
    confidence: 0.90,
  },

  // Reengagement — volvió después de contacto previo
  {
    intent: 'follow_up_reengaged',
    pattern: /\b(?:me\s+hablaste|hablamos|estuve\s+(?:mirando|viendo)|sigo\s+interesado|volv[ií]\s+a\s+escribir|te\s+escribo\s+de\s+nuevo|el\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+te\s+escrib|te\s+habia\s+consultado|te\s+habia\s+preguntado|me\s+habian\s+dicho|retomo|retomare)\b/,
    confidence: 0.85,
  },

  // Financiación
  {
    intent: 'financing_intent',
    pattern: /\b(?:financian?|financiaci[oó]n|cu[aá]ntas?\s+cuotas?|en\s+cuotas?|a\s+cuotas?|cuota\s+(?:mensual|fija)|anticipo|cu[aá]nto\s+de\s+anticipo|plan\s+de\s+pago|cr[eé]dito|banco|prestamo|se\s+puede\s+financiar|financiarlo|meses?|plazo)\b/,
    confidence: 0.85,
  },

  // Permuta / trade-in
  {
    intent: 'trade_in_intent',
    pattern: /\b(?:tomo\s+(?:mi\s+)?usado|toman?\s+(?:mi\s+)?\w+|entrego|parte\s+de\s+pago|doy\s+en\s+parte|permut[ao]|canje|cambio\s+mi\s+auto|te\s+(?:doy|traigo|llevo)\s+(?:el|la|mi)|mi\s+(?:auto|coche|carro|camioneta|moto)\s+(?:como|de|en)|lo\s+cambio|lo\s+entrego|dar\s+en\s+parte|si\s+entrego)\b/,
    confidence: 0.87,
  },

  // Comparación de vehículos
  {
    intent: 'compare_vehicles',
    pattern: /\b(?:o\s+el\s+\w+|entre\s+el|cu[aá]l\s+(?:conviene|es\s+mejor|me\s+recomend[aá]s?)|diferencia\s+entre|vs\s+|versus|comparar|qué\s+ventajas?|qué\s+desventajas?|cu[aá]l\s+compro|cu[aá]l\s+elijo|me\s+conviene\s+m[aá]s)\b/,
    confidence: 0.80,
  },

  // Consulta de precio
  {
    intent: 'price_check',
    pattern: /\b(?:cu[aá]nto\s+(?:sale|cuesta|vale|est[aá]|cob[ra]n)|precio\s+(?:de|del?)|en\s+cu[aá]nto\s+est[aá]|me\s+dec[ií]s\s+el\s+precio|qu[eé]\s+precio|a\s+cu[aá]nto|vale\s+cu[aá]nto|cuanto\s+sali[oó]|cu[aá]nto\s+me\s+pedir[ií]an?)\b/,
    confidence: 0.78,
  },

  // Disponibilidad / stock
  {
    intent: 'availability_check',
    pattern: /\b(?:tienen?|hay|tenes?|est[aá]\s+disponible|tienen?\s+en\s+stock|hay\s+stock|disponibilidad|en\s+existencia|hay\s+alguno|qu[eé]\s+tienen?|qu[eé]\s+tenes?|qu[eé]\s+hay|listame|mostrame|ver\s+opciones?|mandame)\b/,
    confidence: 0.70,
  },

  // Solo mirando
  {
    intent: 'just_browsing',
    pattern: /\b(?:solo\s+estoy\s+mirando|s[oó]lo\s+(?:miro|viendo|curiosidad|consulto)|por\s+curiosidad|viendo\s+opciones\s+nomás?|estoy\s+(?:explorando|viendo|chequeando)|nada\s+m[aá]s\s+(?:que\s+)?consultando|por\s+las\s+dudas|sin\s+apuro|no\s+tengo\s+apuro|por\s+ahora\s+nada)\b/,
    confidence: 0.75,
  },

  // Objeción de precio / resistencia
  {
    intent: 'objection',
    pattern: /\b(?:est[aá]\s+caro|me\s+parece\s+caro|es\s+mucho|no\s+llego|no\s+me\s+alcanza|super[ao]\s+mi\s+presupuesto|es\s+mucho\s+dinero|muy\s+caro|lo\s+pienso|me\s+lo\s+pienso|lo\s+voy\s+a\s+pensar|no\s+me\s+convence|no\s+s[eé]\s+si|tengo\s+dudas|no\s+estoy\s+seguro)\b/,
    confidence: 0.78,
  },
];

// ─── Señales de contexto que refuerzan sin texto explícito ───────────────────

function classifyFromContext(extracted: Record<string, any>): CommercialIntent | null {
  if (extracted?.wantsFinancing) return 'financing_intent';
  if (extracted?.hasTradeIn) return 'trade_in_intent';
  if (extracted?.closingIntent) return 'buy_intent';
  if (extracted?.wantsVisit) return 'visit_intent';
  return null;
}

// ─── Función principal ───────────────────────────────────────────────────────

export function classifyIntent(
  text: string,
  extracted: Record<string, any> = {}
): IntentClassification {
  const normalized = n(text);

  const matches: Array<{ rule: IntentRule; match: string }> = [];

  for (const rule of INTENT_RULES) {
    const m = normalized.match(rule.pattern);
    if (m) {
      matches.push({ rule, match: m[0] });
    }
  }

  // Ordenar por confianza descendente
  matches.sort((a, b) => b.rule.confidence - a.rule.confidence);

  if (matches.length === 0) {
    // Intentar desde contexto extraído
    const fromCtx = classifyFromContext(extracted);
    if (fromCtx) {
      return {
        primary: fromCtx,
        confidence: 0.55,
        evidence: 'inferred from extracted context',
        multipleIntents: false,
      };
    }

    // Sin señal suficiente → availability_check por defecto si hay pregunta
    const hasQuestion = text.includes('?') || /\bqu[eé]\b/.test(normalized);
    return {
      primary: hasQuestion ? 'availability_check' : 'just_browsing',
      confidence: 0.40,
      evidence: 'no clear signal detected',
      multipleIntents: false,
    };
  }

  const primary = matches[0];
  const secondary = matches.length > 1 && matches[1].rule.intent !== primary.rule.intent
    ? matches[1]
    : null;

  return {
    primary: primary.rule.intent,
    secondary: secondary?.rule.intent,
    confidence: primary.rule.confidence,
    evidence: primary.match,
    multipleIntents: matches.length > 1,
  };
}
