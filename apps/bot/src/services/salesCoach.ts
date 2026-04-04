/**
 * salesCoach.ts — Motor de inteligencia comercial avanzada para WaPro bot
 *
 * Contiene toda la lógica de ventas consultivas especializada en autos:
 *
 *  1. OBJECTION_PLAYBOOKS   — scripts específicos por tipo de objeción
 *  2. getNextBestQuestion() — secuencia de preguntas SPIN adaptada a autos
 *  3. scoreClosingOpportunity() — puntuación de oportunidad de cierre
 *  4. mapUseCaseToBenefits()  — beneficios del vehículo según uso del cliente
 *  5. buildUrgencySignal()    — urgencia/escasez honesta cuando aplica
 *  6. buildSalesCoachSection() — formatea todo como sección del system prompt
 *
 * PRINCIPIO: el bot debe sonar como un vendedor experimentado, no como un chatbot.
 * Cada respuesta debe avanzar la venta una posición, no quedarse en el lugar.
 *
 * @module salesCoach
 */

import type { ConvState } from './state.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ObjectionType =
  | 'precio_alto'
  | 'lo_pienso'
  | 'no_convence'
  | 'quiero_ver_mas'
  | 'sin_presupuesto'
  | 'quiero_consultarlo'
  | 'desconfianza'
  | 'comparacion_precio'
  | 'no_lo_necesito_ahora'
  | 'unknown';

export interface ObjectionMatch {
  type: ObjectionType;
  confidence: number;
  /** Script de respuesta recomendado (puede contener variantes) */
  script: string;
  /** Siguiente pregunta de apertura para mantener el diálogo */
  followUp: string;
}

export interface ClosingOpportunity {
  /** 0–100: qué tan listo está el cliente para cerrar */
  score: number;
  /** Técnica de cierre recomendada */
  technique: 'assumptive' | 'alternative' | 'summary' | 'urgency' | 'soft' | 'none';
  /** Script concreto para aplicar la técnica */
  script: string;
  /** Por qué se eligió esta técnica */
  reason: string;
}

export interface BenefitMap {
  topBenefits: string[];
  keyFeatures: string[];
  salesAngle: string;
}

export interface UrgencySignal {
  type: 'stock_scarcity' | 'demand_high' | 'price_valid' | 'season';
  message: string;
  shouldInject: boolean;
}

export type FunnelStage =
  | 'discovery'    // no sabemos nada del cliente
  | 'qualification' // tenemos algún dato, construyendo perfil
  | 'presentation' // mostramos opciones
  | 'objection'   // el cliente pone frenos
  | 'closing';    // listo para cerrar

// ─── Objection Detection ──────────────────────────────────────────────────────

const OBJECTION_PATTERNS: Array<{
  type: ObjectionType;
  patterns: RegExp[];
}> = [
  {
    // precio_alto: handles accents (está/esta), feminine (cara), colloquial (ta caro), se me fue
    type: 'precio_alto',
    patterns: [
      /\b(muy\s+car[ao]|est[aá]\s+(muy\s+)?car[ao]|ta\s+car[ao]|car[ao]\s+para\s+m[ií]|no\s+tengo\s+tanto|me\s+parece\s+mucho|es\s+mucho\s+precio|est[aá]\s+muy\s+por\s+arriba|se\s+me\s+va\s+del\s+presupuesto|se\s+me\s+fue\s+del\s+presupuesto|no\s+me\s+alcanza|no\s+me\s+llega|supera\s+(mi\s+)?presupuesto|me\s+queda\s+lejos)\b/i,
    ],
  },
  {
    // lo_pienso: handles accents (sé/se, después/despues), add more variants
    type: 'lo_pienso',
    patterns: [
      /\b(lo\s+pienso|voy\s+a\s+pensarlo?|lo\s+veo|te\s+aviso|despu[eé]s\s+te\s+digo|lo\s+consulto\s+y|me\s+lo\s+quedo\s+pensando|voy\s+a\s+meditar|no\s+me\s+decido|no\s+s[eé]|no\s+estoy\s+seguro|capaz\s+m[aá]s\s+adelante|lo\s+dejo\s+para\s+despu[eé]s|voy\s+viendo)\b/i,
    ],
  },
  {
    // no_convence: handles common informal variations
    type: 'no_convence',
    patterns: [
      /\b(no\s+me\s+convence|no\s+me\s+termina\s+de|no\s+es\s+lo\s+que\s+busco|no\s+me\s+gusta|no\s+me\s+cierra|algo\s+me\s+falta|no\s+me\s+entusiasma|no\s+me\s+llama|esperaba\s+algo|busco\s+algo\s+diferente|no\s+es\s+lo\s+que\s+ten[ií]a\s+en\s+mente|no\s+me\s+termina|no\s+me\s+convenci[oó])\b/i,
    ],
  },
  {
    // quiero_ver_mas: expanded variants
    type: 'quiero_ver_mas',
    patterns: [
      /\b(quiero\s+ver\s+otras?\s+opciones?|voy\s+a\s+seguir\s+mirando|estoy\s+comparando|quiero\s+comparar|voy\s+a\s+ver\s+en\s+otros?\s+lados?|ando\s+buscando\s+en\s+varios|tengo\s+m[aá]s\s+opciones?|quer[ií]a\s+ver\s+m[aá]s|mir[eé]\s+en\s+otros\s+lados?|tengo\s+otras?\s+ofertas?)\b/i,
    ],
  },
  {
    // sin_presupuesto: expanded variants
    type: 'sin_presupuesto',
    patterns: [
      /\b(no\s+tengo\s+el\s+presupuesto|no\s+me\s+alcanza\s+(el\s+)?presupuesto|tengo\s+menos|mi\s+presupuesto\s+es\s+menor|solo\s+tengo|apenas\s+tengo|me\s+quedo\s+corto|con\s+menos|manejo\s+menos)\b/i,
    ],
  },
  {
    // quiero_consultarlo: handles "mi señora", "mi viejo", etc.
    type: 'quiero_consultarlo',
    patterns: [
      /\b(voy\s+a\s+consultar(lo)?|lo\s+tengo\s+que\s+hablar|quiero\s+preguntarle\s+a|tengo\s+que\s+hablar\s+con|lo\s+comento\s+en\s+casa|lo\s+veo\s+con|lo\s+hablo\s+con\s+mi|lo\s+consulto\s+con|quiero\s+que\s+(lo\s+)?vea|se\s+lo\s+muestro)\b/i,
    ],
  },
  {
    // desconfianza: handles informal spelling
    type: 'desconfianza',
    patterns: [
      /\b(no\s+s[eé]\s+si\s+es\s+confiable|c[oó]mo\s+s[eé]\s+que|qu[eé]\s+garant[ií]a\s+tienen|y\s+si\s+pasa\s+algo|me\s+da\s+desconfianza|nunca\s+compr[eé]\s+as[ií]|no\s+los\s+conozco|vi\s+estafas?|c[oó]mo\s+funciona\s+la\s+transfer|y\s+los\s+papeles)\b/i,
    ],
  },
  {
    // comparacion_precio: handles MercadoLibre, OLX, and informal variants
    type: 'comparacion_precio',
    patterns: [
      /\b(en\s+otro\s+lado\s+vi|vi\s+uno\s+m[aá]s\s+barato|hay\s+uno\s+similar\s+m[aá]s|consegu[ií]\s+uno\s+a\s+menos|en\s+mercado\s+libre|en\s+ml\s+est[aá]|me\s+pasaron\s+un\s+precio\s+mejor|me\s+dijeron\s+que\s+estaba|consegu[ií]\s+m[aá]s\s+barato|en\s+olx\s+vi|comparando\s+precios?|otras?\s+agencias?)\b/i,
    ],
  },
  {
    // no_lo_necesito_ahora: handles accent on año, capaz
    type: 'no_lo_necesito_ahora',
    patterns: [
      /\b(no\s+es\s+urgente|no\s+lo\s+necesito\s+ya|estoy\s+averiguando|reci[eé]n\s+empiezo\s+a\s+mirar|es\s+para\s+m[aá]s\s+adelante|capaz\s+para\s+el\s+a[ñn]o\s+que\s+viene|no\s+tengo\s+apuro|es\s+para\s+m[aá]s\s+adelante|todav[ií]a\s+no\s+s[eé]|a[ún]n\s+no\s+lo\s+decid[ií])\b/i,
    ],
  },
];

/**
 * Detect which objection the user is raising (if any).
 * Fast, deterministic — no GPT.
 */
export function detectObjection(userMessage: string): ObjectionMatch | null {
  const text = userMessage;

  for (const { type, patterns } of OBJECTION_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      return buildObjectionMatch(type);
    }
  }
  return null;
}

function buildObjectionMatch(type: ObjectionType): ObjectionMatch {
  const playbooks: Record<ObjectionType, Omit<ObjectionMatch, 'type' | 'confidence'>> = {
    precio_alto: {
      script: `Entendido. Mirá, antes de buscar alternativas más baratas:
¿Cuánto más lejos está del presupuesto que manejás?
A veces la diferencia la cubrimos con financiación, con tu auto como parte de pago, o con una versión anterior del mismo modelo.
Si me decís el tope que tenés hoy, busco la mejor combinación sin perderte tiempo.`,
      followUp: '¿Con cuánto estás manejando hoy, contado o con algo para entregar?',
    },

    lo_pienso: {
      script: `Dale, tomá el tiempo que necesitás.
Una sola cosa antes de cerrar: ¿hay algo puntual que no te terminó de convencer?
Porque si es una duda de precio, equipamiento o documentación lo resolvemos ahora.
Si es solo cuestión de consultarlo, te armo un resumen con todo para que lo muestres.`,
      followUp: '¿Es algo de precio, del auto en sí, o estás esperando otro momento?',
    },

    no_convence: {
      script: `Perfecto, mejor que lo digas. ¿Qué es lo que no te termina de cerrar?
Puede ser el modelo, el precio, la condición, el año... Con eso claro busco algo más alineado a lo que buscás,
o te explico por qué este puede ser mejor opción de lo que parece.`,
      followUp: '¿Qué tiene que tener el auto ideal para que digas "este es"?',
    },

    quiero_ver_mas: {
      script: `Tiene sentido comparar. ¿Qué otros autos estás mirando?
Así te digo honestamente qué diferencia hay — en precio, en año, en equipamiento.
Si ya tenés referencia de precio de otra agencia, pasámela: muchas veces podemos igualar o mejorar.`,
      followUp: '¿Tenés alguna opción ya en mente para comparar?',
    },

    sin_presupuesto: {
      script: `Entendido. ¿Cuánto tenés disponible como referencia?
Con eso te armo dos opciones: una dentro de ese rango y otra con financiación que quizás te sorprende.
También podemos ver si tu auto actual entra como parte de pago para bajar el desembolso inicial.`,
      followUp: '¿Con cuánto efectivo estás manejando hoy?',
    },

    quiero_consultarlo: {
      script: `Claro, es una decisión importante. ¿Lo consultás con tu pareja / familia?
Si querés, te paso toda la info por acá para que la vean juntos: precio, fotos, financiación.
¿O preferís que coordine una visita para que lo vean en persona?`,
      followUp: '¿Cuándo creés que podría ser?',
    },

    desconfianza: {
      script: `La desconfianza es válida, hay mucho movimiento en el mercado. Te cuento:
Somos una agencia habilitada — podemos mostrarte la documentación, el historial del vehículo y hacer todo por contrato formal.
La transferencia y los papeles se hacen al día, nada bajo la mesa.
¿Qué información necesitás para sentirte seguro/a?`,
      followUp: '¿Querés que te pase algo que confirme nuestra operación?',
    },

    comparacion_precio: {
      script: `Tiene sentido comparar antes de decidir. ¿Me pasás cuál es y dónde lo viste?
Porque en MercadoLibre por ejemplo los precios suelen tener diferencia en año, km, estado o si incluye transferencia.
Si me decís el auto exacto y el precio, te digo yo si es comparable o no — sin venderte nada que no convenga.`,
      followUp: '¿Tenés el link o el modelo exacto del que viste más barato?',
    },

    no_lo_necesito_ahora: {
      script: `Perfecto, mejor salir con tiempo que apurado/a. ¿Para cuándo más o menos lo necesitarías?
Te comento porque los precios de autos están bastante movidos y el stock cambia rápido.
Si sabés qué buscás, podemos ir armando la operación cuando estés listo/a sin complicaciones.`,
      followUp: '¿Estás mirando para comprar en los próximos 3 meses?',
    },

    unknown: {
      script: `Entiendo. ¿Qué sería lo ideal para vos en este momento?`,
      followUp: '¿En qué te puedo ayudar puntualmente?',
    },
  };

  const play = playbooks[type] ?? playbooks.unknown;
  return {
    type,
    confidence: 0.80,
    script: play.script,
    followUp: play.followUp,
  };
}

// ─── SPIN Question Sequencing ─────────────────────────────────────────────────

/**
 * Determine the most valuable next question based on funnel stage and missing fields.
 *
 * SPIN framework adapted for auto sales:
 *  S (Situation)  — entender el contexto del cliente
 *  P (Problem)    — descubrir el problema con el auto actual / la situación actual
 *  I (Implication) — hacer que el cliente sienta el costo de no resolver el problema
 *  N (Need-payoff) — conectar el vehículo con la solución del problema
 */
export function getNextBestQuestion(params: {
  extracted: Record<string, any>;
  history: Array<{ role: string; content: string }>;
  state: ConvState;
  stage: FunnelStage;
}): { question: string; purpose: string; priority: number } {
  const { extracted, history, stage } = params;

  const msgCount = history.filter((h) => h.role === 'user').length;

  // Questions already asked (crude: look for question substrings in bot messages)
  const botMessages = history.filter((h) => h.role === 'assistant').map((h) => h.content.toLowerCase());
  const asked = (kw: string) => botMessages.some((m) => m.includes(kw));

  // ── Stage: Discovery (turn 1-2) ────────────────────────────────────────────
  if (stage === 'discovery' || msgCount <= 2) {
    if (!extracted?.useCase && !asked('para qué lo vas')) {
      return {
        question: '¿Para qué lo vas a usar principalmente? (ciudad, ruta, trabajo, familia...)',
        purpose: 'SPIN-S: entender el uso real del vehículo',
        priority: 10,
      };
    }
    if (!extracted?.maxPrice && !extracted?.amount && !asked('presupuesto')) {
      return {
        question: '¿Cuál es tu presupuesto aproximado? (No tiene que ser exacto, con un rango está bien)',
        purpose: 'SPIN-S: acotar el catálogo relevante',
        priority: 9,
      };
    }
  }

  // ── Stage: Qualification (turn 3-5) ───────────────────────────────────────
  if (stage === 'qualification' || (msgCount > 2 && msgCount <= 5)) {
    if (!extracted?.condition && !asked('0km\|usado\|kilómetros')) {
      return {
        question: '¿Estás buscando 0km o con kilómetros?',
        purpose: 'SPIN-S: filtrar catálogo por condición',
        priority: 8,
      };
    }
    if (!extracted?.hasTradeIn && !asked('tenés un auto')) {
      return {
        question: '¿Tenés un auto para entregar como parte de pago?',
        purpose: 'SPIN-P: entender la situación actual del cliente',
        priority: 7,
      };
    }
    if (!extracted?.transmission && !asked('automático\|caja')) {
      return {
        question: '¿Necesitás que sea automático o te da igual?',
        purpose: 'SPIN-S: filtrar por transmisión',
        priority: 6,
      };
    }
  }

  // ── Stage: Presentation (turn 5-8) ────────────────────────────────────────
  if (stage === 'presentation' || (msgCount > 5 && msgCount <= 8)) {
    if (!extracted?.wantsFinancing && !asked('financ\|cuotas')) {
      return {
        question: '¿Estás pensando en pagarlo en efectivo o te sirve financiar parte?',
        purpose: 'SPIN-N: explorar necesidad de financiación',
        priority: 6,
      };
    }
    if (!extracted?.city && !asked('dónde estás\|de qué zona')) {
      return {
        question: '¿De qué zona sos? Así coordino con el asesor más cercano.',
        purpose: 'SPIN-S: preparar visita / logística',
        priority: 5,
      };
    }
  }

  // ── Stage: Objection handling ──────────────────────────────────────────────
  if (stage === 'objection') {
    return {
      question: '¿Qué sería lo que te terminaría de convencer para avanzar?',
      purpose: 'SPIN-N: identificar el need-payoff específico',
      priority: 9,
    };
  }

  // ── Stage: Closing ─────────────────────────────────────────────────────────
  if (stage === 'closing') {
    return {
      question: '¿Arrancamos con los datos para hacer la reserva?',
      purpose: 'Cierre directo',
      priority: 10,
    };
  }

  // Default: open-ended if nothing better
  return {
    question: '¿Qué más te puedo contar del vehículo?',
    purpose: 'general',
    priority: 1,
  };
}

// ─── Funnel Stage Detector ────────────────────────────────────────────────────

/**
 * Determine the current funnel stage from conversation state and extracted data.
 */
export function detectFunnelStage(
  extracted: Record<string, any>,
  leadScore: number,
  userMsgCount: number,
  lastIntent?: string,
  lastUserMessage?: string
): FunnelStage {
  // Hard closing signals — override everything
  if (leadScore >= 70 || lastIntent === 'closing') return 'closing';
  // Explicit closing intent in last message
  if (lastUserMessage && /\b(cu[aá]ndo\s+puedo\s+pasar|quiero\s+reservarlo?|lo\s+sep[ao]|lo\s+aparto|me\s+lo\s+quedo|arrancamos|hago\s+la\s+reserva)\b/i.test(lastUserMessage)) {
    return 'closing';
  }

  // Objection signals
  if (
    lastIntent === 'objection' ||
    lastIntent === 'cierre_frio' ||
    lastIntent === 'indecision'
  ) {
    return 'objection';
  }
  // Detect objection from last user message if intent wasn't classified
  if (lastUserMessage) {
    const obj = detectObjection(lastUserMessage);
    if (obj && obj.type !== 'unknown') return 'objection';
  }

  // Comparison / "más opciones" = presentation sub-state
  if (
    lastIntent === 'comparacion' ||
    lastIntent === 'quiero_ver_mas' ||
    (lastUserMessage && /\b(cu[aá]l\s+(me\s+)?conviene|diferencia\s+entre|cu[aá]l\s+es\s+mejor|m[aá]s\s+opciones)\b/i.test(lastUserMessage))
  ) {
    return 'presentation';
  }

  // Presentation: we showed vehicles or have enough context to show
  const hasRichContext =
    !!(extracted?.brand || extracted?.model || extracted?.maxPrice) &&
    userMsgCount >= 3;
  if (hasRichContext && leadScore >= 35) return 'presentation';

  // Also presentation if user already asked for financing/visit details
  if (
    extracted?.wantsFinancing ||
    extracted?.hasTradeIn ||
    lastIntent === 'financiacion' ||
    lastIntent === 'visita'
  ) {
    return 'presentation';
  }

  // Qualification: we have some data
  const hasAnyData = !!(
    extracted?.brand ||
    extracted?.model ||
    extracted?.useCase ||
    extracted?.maxPrice ||
    extracted?.amount ||
    extracted?.transmission ||
    extracted?.fuel ||
    extracted?.condition ||
    extracted?.bodywork
  );
  if (hasAnyData) return 'qualification';

  return 'discovery';
}

// ─── Closing Opportunity Scoring ──────────────────────────────────────────────

/**
 * Score how close the lead is to a closing action (0–100).
 * Uses conversation signals, not just extracted fields.
 */
export function scoreClosingOpportunity(params: {
  extracted: Record<string, any>;
  history: Array<{ role: string; content: string }>;
  leadScore: number;
  userMessage: string;
}): ClosingOpportunity {
  const { extracted, history, leadScore, userMessage } = params;
  let score = 0;
  const reasons: string[] = [];

  const txt = userMessage.toLowerCase();
  const allUser = history.filter((h) => h.role === 'user').map((h) => h.content.toLowerCase()).join(' ');

  // Hard buying signals
  if (/(cuándo\s+puedo|a\s+qué\s+hora\s+van|cómo\s+voy|cuánto\s+tiempo\s+tarda|lo\s+quiero|arrancamos|hacemos\s+algo)/i.test(userMessage)) {
    score += 40; reasons.push('hard_buying_signal');
  }
  // Asked about visit or test drive
  if (/(visita|test\s+drive|ver\s+el\s+auto|pasar\s+a\s+ver|ir\s+a\s+ver)/i.test(allUser)) {
    score += 25; reasons.push('visit_interest');
  }
  // Specific vehicle preference confirmed
  if (extracted?.model || (extracted?.brand && extracted?.maxPrice)) {
    score += 15; reasons.push('vehicle_defined');
  }
  // Financing confirmed
  if (extracted?.wantsFinancing || extracted?.cuotas) {
    score += 10; reasons.push('financing_intent');
  }
  // Trade-in confirmed
  if (extracted?.hasTradeIn) {
    score += 8; reasons.push('trade_in_confirmed');
  }
  // Many turns = invested
  const msgCount = history.filter((h) => h.role === 'user').length;
  if (msgCount >= 5) { score += 10; reasons.push('high_engagement'); }
  if (msgCount >= 8) { score += 5; reasons.push('very_high_engagement'); }

  // Lead score contribution
  score += Math.round(leadScore * 0.2);

  score = Math.min(100, score);

  // Select closing technique based on score and context
  let technique: ClosingOpportunity['technique'] = 'none';
  let script = '';
  let reason = '';

  if (score >= 80) {
    technique = 'assumptive';
    reason = reasons.join(', ');
    const vehicle = extracted?.model ? `el ${extracted.brand ?? ''} ${extracted.model}` : 'el auto';
    script = `Perfecto. Para avanzar con ${vehicle}:
¿Lo hacemos a nombre tuyo o de otra persona?
¿Pagás en efectivo, financiado o con permuta?
Te paso con el asesor ahora para coordinar los detalles.`;
  } else if (score >= 60) {
    technique = 'alternative';
    reason = reasons.join(', ');
    script = `¿Preferís pasar a verlo esta semana o te mandamos toda la info por acá primero para que lo veas con calma?`;
  } else if (score >= 40) {
    technique = 'summary';
    reason = reasons.join(', ');
    const brand = extracted?.brand ?? 'auto';
    const price = extracted?.maxPrice
      ? ` a ${extracted.currency ?? 'ARS'} ${Number(extracted.maxPrice).toLocaleString('es-AR')}`
      : '';
    script = `Entonces estás buscando un ${brand}${price}${extracted?.transmission ? `, ${extracted.transmission}` : ''}${extracted?.hasTradeIn ? ', con tu auto como parte de pago' : ''}.
¿Querés que te muestre las opciones disponibles ahora?`;
  } else if (score >= 25 && leadScore >= 30) {
    technique = 'soft';
    reason = 'low_score_soft_close';
    script = `¿Hay algo que pueda responder para que esto avance?`;
  }

  return { score, technique, script, reason };
}

// ─── Benefit Mapper ───────────────────────────────────────────────────────────

export type UseCase =
  | 'city'        // ciudad / cotidiano
  | 'highway'     // ruta / viajes largos
  | 'family'      // familia / chicos
  | 'work'        // trabajo / remis
  | 'offroad'     // campo / off-road
  | 'general';    // sin caso de uso claro

/**
 * Map customer use case to relevant vehicle benefits.
 * Used to personalize the pitch based on what the customer cares about.
 */
export function mapUseCaseToBenefits(
  useCase: UseCase,
  vehicleData?: {
    fuel?: string;
    transmission?: string;
    km?: number;
    year?: number;
    engine?: string;
    name?: string;
  }
): BenefitMap {
  const vehicle = vehicleData ?? {};

  const maps: Record<UseCase, BenefitMap> = {
    city: {
      topBenefits: [
        'Fácil de maniobrar en tráfico y estacionar',
        'Bajo consumo de combustible en ciudad',
        'Mantenimiento económico',
        vehicle.transmission === 'automático' ? 'Automático — ideal para el tráfico cotidiano' : '',
      ].filter(Boolean),
      keyFeatures: ['dimensiones compactas', 'radio de giro', 'consumo urbano'],
      salesAngle: 'perfecto para el día a día: cómodo, económico y sin dolores de cabeza',
    },

    highway: {
      topBenefits: [
        'Estabilidad y comodidad en viajes largos',
        'Buena autonomía — menos paradas en ruta',
        vehicle.fuel === 'diesel' ? 'Motor diesel — el más eficiente en ruta' : 'Motor con buena potencia para autopista',
        'Confort en viajes de horas',
      ].filter(Boolean),
      keyFeatures: ['autonomía', 'consumo en ruta', 'confort en largas distancias'],
      salesAngle: 'diseñado para cubrir kilómetros con bajo costo y mucho confort',
    },

    family: {
      topBenefits: [
        'Espacio suficiente para toda la familia',
        'Maletero amplio para salidas y vacaciones',
        'Múltiples airbags y sistemas de seguridad',
        'Confort para chicos en viajes largos',
      ],
      keyFeatures: ['espacio interior', 'seguridad', 'maletero', 'altura de entrada'],
      salesAngle: 'pensado para mover a toda la familia con seguridad y comodidad',
    },

    work: {
      topBenefits: [
        'Bajo costo de mantenimiento',
        'Consumo eficiente para muchos kilómetros diarios',
        vehicle.fuel === 'gnc' ? 'Con GNC — el costo por km más bajo del mercado' : '',
        'Confiabilidad probada para uso intensivo',
        'Valor de reventa alto',
      ].filter(Boolean),
      keyFeatures: ['consumo por km', 'confiabilidad', 'costo de servicio', 'disponibilidad de repuestos'],
      salesAngle: 'la herramienta de trabajo que se paga sola con el ahorro en combustible',
    },

    offroad: {
      topBenefits: [
        'Tracción en terrenos complicados',
        'Altura libre al suelo para pasar donde otros no pueden',
        'Suspensión preparada para campo y caminos de tierra',
        'Capacidad de carga y remolque',
      ],
      keyFeatures: ['tracción 4x4', 'altura libre', 'capacidad de remolque', 'suspensión'],
      salesAngle: 'preparado para el campo, el trabajo duro y las rutas difíciles',
    },

    general: {
      topBenefits: [
        'Buena relación precio-equipamiento',
        'Documentación al día y en regla',
        vehicle.year && vehicle.year >= 2020 ? 'Modelo reciente con tecnología actualizada' : '',
        'Respaldo de agencia con garantía',
      ].filter(Boolean),
      keyFeatures: ['precio', 'año', 'estado'],
      salesAngle: 'una opción sólida con buena relación precio-valor',
    },
  };

  return maps[useCase] ?? maps.general;
}

/**
 * Parse use case from extracted context.
 */
export function parseUseCase(extracted: Record<string, any>): UseCase {
  const uc = String(extracted?.useCase ?? '').toLowerCase();

  if (/ciudad|cotidiano|diario|urbano/.test(uc)) return 'city';
  if (/ruta|viaje|autopista|largo/.test(uc)) return 'highway';
  if (/familia|chicos|niño|kids|familiar/.test(uc)) return 'family';
  if (/trabajo|remis|taxi|uber|delivery|negocio|comercial/.test(uc)) return 'work';
  if (/campo|off.?road|4x4|tierra|montaña|barro/.test(uc)) return 'offroad';

  // Infer from other fields
  if (extracted?.bodywork === 'pickup' || extracted?.bodywork === 'furgon') return 'work';
  if (extracted?.bodywork === 'suv') return 'family';
  if (extracted?.fuel === 'gnc') return 'work'; // GNC usually = work/taxi
  if (extracted?.bodywork === 'hatch') return 'city';

  return 'general';
}

// ─── Urgency & Scarcity ───────────────────────────────────────────────────────

/**
 * Determine if and how to inject urgency into the conversation.
 * ONLY real urgency — never lie about stock or demand.
 *
 * Returns null if no genuine urgency signal applies.
 */
export function buildUrgencySignal(params: {
  catalogSize: number;
  matchingVehicles: number;
  leadScore: number;
  stage: FunnelStage;
  turnCount: number;
}): UrgencySignal | null {
  const { catalogSize, matchingVehicles, leadScore, stage, turnCount } = params;

  // Only inject urgency at presentation or objection stage, not too early
  if (stage === 'discovery' || turnCount < 3) return null;

  // Real scarcity: very few matching vehicles
  if (matchingVehicles === 1) {
    return {
      type: 'stock_scarcity',
      message: 'Hay una sola unidad disponible con esas características.',
      shouldInject: leadScore >= 30,
    };
  }

  if (matchingVehicles <= 3 && matchingVehicles > 0) {
    return {
      type: 'stock_scarcity',
      message: `Quedan ${matchingVehicles} unidades con esas características.`,
      shouldInject: leadScore >= 25,
    };
  }

  // High demand signal (only if lead is warm+)
  if (leadScore >= 50 && stage === 'objection') {
    return {
      type: 'demand_high',
      message: 'Este tipo de modelo tiene mucha rotación en este momento.',
      shouldInject: true,
    };
  }

  return null;
}

// ─── Negotiation Framework ────────────────────────────────────────────────────

/**
 * Generate a price negotiation response when customer pushes back on price.
 * Never invents prices or discounts — always refers to the human advisor for final numbers.
 */
export function buildNegotiationResponse(params: {
  vehicleName?: string;
  vehiclePrice?: number;
  currency?: string;
  hasTradeIn: boolean;
  wantsFinancing: boolean;
  customerBudget?: number;
}): string {
  const { vehicleName, vehiclePrice, currency, hasTradeIn, wantsFinancing, customerBudget } = params;
  const cur = currency ?? 'ARS';
  const lines: string[] = [];

  const vehicle = vehicleName ?? 'este auto';

  // Price justification
  lines.push(`El precio de ${vehicle} está armado en base al mercado actual.`);

  // If we know the gap
  if (vehiclePrice && customerBudget && vehiclePrice > customerBudget) {
    const gap = vehiclePrice - customerBudget;
    const gapFormatted = Number(gap).toLocaleString('es-AR');
    lines.push(`La diferencia son ${cur} ${gapFormatted}.`);
  }

  // Bridge options
  const bridges: string[] = [];
  if (hasTradeIn) {
    bridges.push('tu auto como parte de pago reduce bastante el desembolso');
  }
  if (wantsFinancing) {
    bridges.push('financiando una parte lo hacemos más manejable por mes');
  }
  if (!hasTradeIn && !wantsFinancing) {
    bridges.push('a veces hay algo de margen con el asesor dependiendo de la forma de pago');
    bridges.push('podés ver si tenés algo para entregar o financiar parte');
  }

  if (bridges.length > 0) {
    lines.push(`Lo que podemos explorar: ${bridges.join(' y ')}.`);
  }

  lines.push(`¿Querés que lo analicemos con el asesor para ver qué combinación te funciona mejor?`);

  return lines.join('\n');
}

// ─── Sales Coach Prompt Section ───────────────────────────────────────────────

export interface SalesCoachContext {
  stage: FunnelStage;
  objection: ObjectionMatch | null;
  nextQuestion: { question: string; purpose: string; priority: number };
  closingOpportunity: ClosingOpportunity;
  benefits: BenefitMap;
  urgency: UrgencySignal | null;
  useCase: UseCase;
  /** Raw user message — used to detect specific question patterns */
  userMessage: string;
}

/**
 * Build the full SalesCoachContext for a given conversation state.
 * Called once per message, before the agent prompt is built.
 */
export function buildSalesCoachContext(params: {
  userMessage: string;
  extracted: Record<string, any>;
  history: Array<{ role: string; content: string }>;
  state: ConvState;
  leadScore: number;
  catalogSize: number;
  matchingVehicles: number;
  lastVehicle?: any;
}): SalesCoachContext {
  const { userMessage, extracted, history, state, leadScore, catalogSize, matchingVehicles, lastVehicle } = params;

  const userMsgCount = history.filter((h) => h.role === 'user').length;
  const lastIntent = (state as any)?.last_intent ?? undefined;

  const stage = detectFunnelStage(extracted, leadScore, userMsgCount, lastIntent, userMessage);
  const useCase = parseUseCase(extracted);
  const objection = detectObjection(userMessage);
  const nextQuestion = getNextBestQuestion({ extracted, history, state, stage });
  const closingOpportunity = scoreClosingOpportunity({ extracted, history, leadScore, userMessage });
  const benefits = mapUseCaseToBenefits(useCase, lastVehicle);
  const urgency = buildUrgencySignal({
    catalogSize,
    matchingVehicles,
    leadScore,
    stage,
    turnCount: userMsgCount,
  });

  return { stage, objection, nextQuestion, closingOpportunity, benefits, urgency, useCase, userMessage };
}

/**
 * Detect specific high-frequency question patterns that need tailored responses.
 * Returns a coaching note if a pattern matches, or null.
 */
function detectQuestionPattern(userMessage: string): string | null {
  const msg = userMessage.toLowerCase();

  // "qué autos tenés?" / "qué tenés?" / "mostrá algo"
  if (/\b(qu[eé]\s+(autos?|cosas?|modelos?)\s+ten[eé]s?|qu[eé]\s+ten[eé]s|qu[eé]\s+hay\s+disponible|qu[eé]\s+stock|mostr[aá]\s+algo|qu[eé]\s+me\s+ofrecen)\b/i.test(userMessage)) {
    return `PATRÓN: "qué autos tenés?" sin filtros → si no hay datos del cliente, preguntá UNA cosa: "¿Para qué lo usarías más?". Si ya hay datos, mostrá directamente 2-3 opciones.`;
  }
  // "algo más barato?" / "no hay algo más económico?"
  if (/\b(algo\s+m[aá]s\s+barato|m[aá]s\s+econ[oó]mico|m[aá]s\s+accesible|algo\s+menor|m[aá]s\s+bajo|m[aá]s\s+barata|opci[oó]n\s+m[aá]s\s+barata|no\s+hay\s+(algo\s+)?m[aá]s\s+barato)\b/i.test(userMessage)) {
    return `PATRÓN: "algo más barato" → mostrar las opciones más baratas del catálogo disponible. Aclarar rango. NO preguntar qué presupuesto tiene si ya lo dijo. Si el catálogo no tiene nada más barato, decirlo honestamente y ofrecer financiación.`;
  }
  // "qué me recomendás?" / "qué me sugerís?"
  if (/\b(qu[eé]\s+me\s+(recomend[aá]s?|suger[ií]s?|aconsejar[ií]as?)|cu[aá]l\s+me\s+recomend[aá]s?|qu[eé]\s+comprar[ií]as?)\b/i.test(userMessage)) {
    return `PATRÓN: "qué me recomendás?" → NO preguntes más. Recomendá con criterio usando lo que ya sabés. Si no tenés nada, elegí el auto más versátil del catálogo y explicá POR QUÉ. Nunca respondas con otra pregunta.`;
  }
  // "puedo financiar?" / "tienen financiación?"
  if (/\b(puedo\s+financiar|tienen\s+financiaci[oó]n|financian|hay\s+cuotas?|a\s+cuotas?|se\s+puede\s+financiar|cu[aá]nto\s+ser[ií]a\s+la\s+cuota)\b/i.test(userMessage)) {
    return `PATRÓN: "financiación" → sí, financiamos hasta el 50% del valor. Pedir anticipo y plazo. action=OFFER_FINANCING. NUNCA inventar monto de cuota.`;
  }
  // "toman usado?" / "puedo entregar mi auto?"
  if (/\b(toman\s+usado|aceptan\s+usado|part[eé]\s+de\s+pago|permuta|entrego\s+mi\s+auto|reciben\s+usado|cambio\s+mi\s+auto|entregar\s+(mi\s+)?auto)\b/i.test(userMessage)) {
    return `PATRÓN: "permuta" → sí, tomamos tu usado como parte de pago. Pedir: marca, año y km del auto actual. extracted.hasTradeIn=true.`;
  }
  // "puedo pasar a verlo?" / "cuándo puedo ir?"
  if (/\b(puedo\s+pasar|cu[aá]ndo\s+puedo\s+ir|cu[aá]ndo\s+puedo\s+verlo|puede\s+ser\s+hoy|me\s+gustar[ií]a\s+pasar|quiero\s+ir|cu[aá]ndo\s+atienden)\b/i.test(userMessage)) {
    return `PATRÓN: "visita" → señal de cierre. action=ESCALATE_HUMAN, handoffRecommended=true. Proponer día/hora concreto. Confirmar qué auto quiere ver.`;
  }
  // "qué diferencia hay entre X e Y?" (but not handled by comparison directive)
  if (/\b(qu[eé]\s+diferencia\s+hay|en\s+qu[eé]\s+se\s+diferencia|en\s+qu[eé]\s+difiere)\b/i.test(userMessage)) {
    return `PATRÓN: "diferencia entre" → comparar en 2-3 dimensiones concretas. Tomar partido según el uso del cliente. No decir "ambos son buenos".`;
  }
  // "no me convence" — ensure we dig into WHY
  if (/\b(no\s+me\s+convence|no\s+me\s+termina|algo\s+me\s+falta)\b/i.test(msg)) {
    return `PATRÓN: "no me convence" → primero preguntar QUÉ específicamente no convence. Nunca asumir. Responder solo lo que aplica.`;
  }

  return null;
}

/**
 * Format the SalesCoachContext as a prompt section for injection into agent.ts.
 * This is the bridge between salesCoach.ts and the GPT system prompt.
 */
export function buildSalesCoachSection(ctx: SalesCoachContext): string {
  const lines: string[] = ['── COACH DE VENTAS (aplicar en esta respuesta) ──', ''];

  // Funnel stage
  lines.push(`ETAPA ACTUAL: ${stageName(ctx.stage)}`);
  lines.push('');

  // Question pattern detection — high priority override
  const patternNote = detectQuestionPattern(ctx.userMessage);
  if (patternNote) {
    lines.push(`📌 PATRÓN DE PREGUNTA DETECTADO:`);
    lines.push(`  ${patternNote}`);
    lines.push('');
  }

  // Objection handling
  if (ctx.objection) {
    lines.push(`⚠ OBJECIÓN DETECTADA: ${ctx.objection.type.replace(/_/g, ' ').toUpperCase()}`);
    lines.push('Script recomendado:');
    lines.push(ctx.objection.script.split('\n').map((l) => `  ${l}`).join('\n'));
    lines.push(`Pregunta de cierre después: "${ctx.objection.followUp}"`);
    lines.push('');
  }

  // Closing opportunity
  if (ctx.closingOpportunity.score >= 40 && ctx.closingOpportunity.technique !== 'none') {
    lines.push(`🎯 OPORTUNIDAD DE CIERRE: score=${ctx.closingOpportunity.score}/100 → técnica=${ctx.closingOpportunity.technique}`);
    lines.push('Script de cierre:');
    lines.push(ctx.closingOpportunity.script.split('\n').map((l) => `  ${l}`).join('\n'));
    lines.push('');
  }

  // Urgency
  if (ctx.urgency?.shouldInject) {
    lines.push(`⏱ SEÑAL DE URGENCIA (real): "${ctx.urgency.message}"`);
    lines.push('  → Mencionar naturalmente, sin presionar. Ejemplo: "Te comento que..."');
    lines.push('');
  }

  // Benefits for this use case
  if (ctx.benefits.topBenefits.length > 0 && ctx.useCase !== 'general') {
    lines.push(`💡 ÁNGULO DE VENTA para uso "${ctx.useCase}": ${ctx.benefits.salesAngle}`);
    lines.push('Beneficios clave a mencionar:');
    for (const b of ctx.benefits.topBenefits.slice(0, 3)) {
      lines.push(`  • ${b}`);
    }
    lines.push('');
  }

  // Next best question (only if NOT closing, NOT objection, and no pattern override)
  if (
    ctx.stage !== 'closing' &&
    !ctx.objection &&
    !patternNote &&
    ctx.closingOpportunity.score < 60 &&
    ctx.nextQuestion.priority >= 5
  ) {
    lines.push(`❓ PRÓXIMA PREGUNTA PRIORITARIA: "${ctx.nextQuestion.question}"`);
    lines.push(`  (propósito: ${ctx.nextQuestion.purpose})`);
    lines.push('');
  }

  lines.push('── FIN COACH DE VENTAS ──');
  return lines.join('\n');
}

function stageName(stage: FunnelStage): string {
  const names: Record<FunnelStage, string> = {
    discovery: 'DESCUBRIMIENTO — capturar intención y datos básicos',
    qualification: 'CALIFICACIÓN — construir perfil del lead',
    presentation: 'PRESENTACIÓN — mostrar opciones relevantes',
    objection: 'MANEJO DE OBJECIÓN — resolver el freno específico',
    closing: 'CIERRE — concretar el siguiente paso de compra',
  };
  return names[stage] ?? stage;
}
