/**
 * salesIntelligence.ts — Motor de inteligencia comercial avanzada v1
 *
 * Provee al agente contexto más rico para responder como vendedor automotriz real.
 * Todos los exports son deterministas, sin DB, sin GPT, sin latencia.
 *
 * Exports:
 *  1. buildLeadProfileBlock()           — perfil compacto del lead para el prompt
 *  2. buildVehicleArgumentAnnotations() — argumentos de venta por vehículo según perfil del cliente
 *  3. detectComparisonIntent()          — detecta "cuál me conviene más entre X e Y"
 *  4. getComparisonDirective()          — instrucción para comparar sin decir "ambos son buenos"
 *  5. getStageSpecificDirective()       — instrucción concreta por etapa del funnel
 *
 * PRINCIPIO: el agente no puede vender bien si no sabe QUIÉN tiene enfrente.
 * Estos bloques le dan ese contexto en cada turno, sin repetir lo que ya sabe.
 */

import type { FunnelStage } from './salesCoach.js';

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Extrae objeciones ya planteadas en la conversación.
 * Evita que el bot use el mismo script de objeción dos veces seguidas.
 */
function extractPriorObjections(
  history: Array<{ role: string; content: string }>
): string[] {
  const userMessages = history
    .filter((h) => h.role === 'user')
    .map((h) => h.content.toLowerCase());

  const signals: Array<[string, RegExp]> = [
    ['precio_alto', /\b(muy\s+car[ao]|est[aá]\s+car[ao]|ta\s+car[ao]|no\s+me\s+alcanza|se\s+me\s+va\s+del\s+presupuesto|es\s+mucho)\b/i],
    ['lo_pienso', /\b(lo\s+pienso|voy\s+a\s+pensarlo?|te\s+aviso|despu[eé]s\s+te\s+digo)\b/i],
    ['no_convence', /\b(no\s+me\s+convence|no\s+me\s+gusta|algo\s+me\s+falta|no\s+me\s+termina\s+de)\b/i],
    ['comparacion', /\b(en\s+otro\s+lado|vi\s+uno\s+m[aá]s\s+barato|estoy\s+comparando|mercado\s+libre)\b/i],
    ['necesita_tiempo', /\b(no\s+es\s+urgente|para\s+m[aá]s\s+adelante|capaz\s+para\s+el\s+a[ñn]o|no\s+tengo\s+apuro)\b/i],
    ['desconfianza', /\b(no\s+los\s+conozco|qu[eé]\s+garant[ií]a\s+tienen|no\s+s[eé]\s+si\s+es\s+confiable)\b/i],
    ['consultar_familia', /\b(lo\s+tengo\s+que\s+hablar|quiero\s+preguntarle\s+a|lo\s+comento\s+en\s+casa|lo\s+veo\s+con)\b/i],
  ];

  const raised: string[] = [];
  for (const msg of userMessages) {
    for (const [type, re] of signals) {
      if (re.test(msg) && !raised.includes(type)) raised.push(type);
    }
  }
  return raised;
}

/**
 * Extrae IDs de vehículos ya mostrados por el bot.
 * Evita que el bot repita los mismos autos cuando el cliente pide "más opciones".
 */
function extractShownVehicleIds(
  history: Array<{ role: string; content: string }>
): string[] {
  const botMessages = history
    .filter((h) => h.role === 'assistant')
    .map((h) => h.content);

  const ids = new Set<string>();
  for (const msg of botMessages) {
    const matches = [...msg.matchAll(/\[id:(\w+)\]/g)];
    for (const m of matches) ids.add(m[1]);
  }
  return Array.from(ids);
}

// ─── 1. Lead Profile Block ────────────────────────────────────────────────────

/**
 * Genera un bloque compacto "perfil del lead" para inyectar en el system prompt.
 *
 * Incluye:
 *  - todo lo que ya sabemos del cliente (para NO volver a preguntar)
 *  - objeciones ya planteadas (para NO repetir el mismo script)
 *  - vehículos ya mostrados (para mostrar opciones NUEVAS cuando pide más)
 *  - instrucción concreta de qué hacer en esta etapa
 */
export function buildLeadProfileBlock(params: {
  extracted: Record<string, any>;
  history: Array<{ role: string; content: string }>;
  stage: FunnelStage;
  leadScore: number;
  turnCount: number;
}): string {
  const { extracted: ctx, history, stage, leadScore, turnCount } = params;

  const temp =
    leadScore >= 60 ? '🔥 CALIENTE' : leadScore >= 35 ? '🟡 TIBIO' : '❄️ FRÍO';

  const stageLabel: Record<FunnelStage, string> = {
    discovery: 'DESCUBRIMIENTO',
    qualification: 'CALIFICACIÓN',
    presentation: 'PRESENTACIÓN',
    objection: 'OBJECIÓN',
    closing: 'CIERRE',
  };

  const lines: string[] = [];
  lines.push(
    `\n── PERFIL DEL LEAD (turno ${turnCount} | ${temp} | etapa: ${stageLabel[stage] ?? stage.toUpperCase()}) ──`
  );

  // ── Lo que ya sabemos ───────────────────────────────────────────────────────
  const known: string[] = [];
  if (ctx.brand) known.push(`marca: ${ctx.brand}`);
  if (ctx.model) known.push(`modelo: ${ctx.model}`);
  const budgetAmt = ctx.maxPrice ?? ctx.amount;
  if (budgetAmt) {
    const cur = ctx.currency ?? 'ARS';
    known.push(`presupuesto: ${cur} ${Number(budgetAmt).toLocaleString('es-AR')}`);
  }
  if (ctx.useCase) known.push(`uso: ${ctx.useCase}`);
  if (ctx.transmission) known.push(`caja: ${ctx.transmission}`);
  if (ctx.fuel) known.push(`combustible: ${ctx.fuel}`);
  if (ctx.condition)
    known.push(`condición: ${ctx.condition === 'nuevo' ? '0km' : 'usado'}`);
  if (ctx.hasTradeIn) known.push('tiene auto para entregar en permuta');
  if (ctx.wantsFinancing) known.push('quiere financiación');
  if (ctx.gnc) known.push('quiere GNC');
  if (ctx.city) known.push(`ciudad: ${ctx.city}`);
  if (ctx.bodywork) known.push(`carrocería: ${ctx.bodywork}`);
  if (ctx.year ?? ctx.minYear ?? ctx.maxYear) {
    const yr = ctx.year
      ? String(ctx.year)
      : `${ctx.minYear ?? '?'}-${ctx.maxYear ?? '?'}`;
    known.push(`año: ${yr}`);
  }

  if (known.length) {
    lines.push('✅ YA SABEMOS (NO volver a preguntar):');
    known.forEach((k) => lines.push(`  • ${k}`));
  } else {
    lines.push('✅ YA SABEMOS: nada todavía — inicio de conversación');
  }

  // ── Objeciones ya planteadas ────────────────────────────────────────────────
  const priorObjections = extractPriorObjections(history);
  if (priorObjections.length) {
    lines.push(`⚠️  OBJECIONES YA PLANTEADAS: ${priorObjections.join(', ')}`);
    lines.push(
      '  → Si vuelve a plantear la misma, PROGRESÁ el script — no repetir el mismo ángulo.'
    );
    lines.push(
      '  → Ejemplo: si ya respondiste "está caro" con financiación, la próxima vez ofrecé permuta o alternativa más barata.'
    );
  }

  // ── Vehículos ya mostrados ──────────────────────────────────────────────────
  const shownIds = extractShownVehicleIds(history);
  if (shownIds.length) {
    lines.push(`🚗 VEHÍCULOS YA MOSTRADOS: ids ${shownIds.join(', ')}`);
    lines.push(
      '  → Si el cliente pide más opciones: mostrar DISTINTOS a estos. No repetir el mismo auto.'
    );
  }

  // ── Qué hacer ahora ─────────────────────────────────────────────────────────
  const stageHints: Record<FunnelStage, string> = {
    discovery:
      '→ FOCO AHORA: capturar 1 dato clave. Máximo 1 pregunta: uso o presupuesto.',
    qualification:
      '→ FOCO AHORA: mostrar 2-3 opciones relevantes + cerrar con "¿Cuál te llama la atención?"',
    presentation:
      '→ FOCO AHORA: profundizar en el auto de interés y proponer visita o financiación.',
    objection:
      '→ FOCO AHORA: resolver la objeción específica. No presionar. Preguntar qué lo terminaría de convencer.',
    closing:
      '→ FOCO AHORA: concretar próximo paso. handoffRecommended=true. Proponer día/hora de visita.',
  };
  lines.push('');
  lines.push(stageHints[stage] ?? '');

  return lines.join('\n');
}

// ─── 2. Vehicle Argument Annotations ─────────────────────────────────────────

/**
 * Para cada vehículo en el catálogo, genera un mini-argumento de venta
 * adaptado al perfil del cliente (uso, presupuesto, preferencias).
 *
 * El agente usa estos argumentos para construir el ANCLA DE VALOR:
 * primero el beneficio, luego el precio — no al revés.
 */
export function buildVehicleArgumentAnnotations(params: {
  vehicles: Array<Record<string, any>>;
  extracted: Record<string, any>;
}): string {
  const { vehicles, extracted: ctx } = params;
  if (!vehicles.length) return '';

  const useCase = String(ctx?.useCase ?? '').toLowerCase();
  const budget = Number(ctx?.maxPrice ?? ctx?.amount ?? 0);
  const currency = String(ctx?.currency ?? 'ARS');
  const wantsGnc = !!ctx?.gnc;
  const wantsAuto = /auto/i.test(String(ctx?.transmission ?? ''));
  const wantsNew = ctx?.condition === 'nuevo';

  const getArg = (v: Record<string, any>): string | null => {
    const parts: string[] = [];
    const km = Number(v.km ?? v.mileage ?? 0);
    const price = Number(v.priceNumber ?? v.price ?? 0);
    const trans = String(v.transmission ?? '').toLowerCase();
    const fuel = String(v.fuel ?? '').toLowerCase();
    const hasGnc = !!v.gnc || fuel.includes('gnc');
    const year = Number(v.year ?? 0);
    const isNew = !!v.isNew;

    // ── Fit por caso de uso ─────────────────────────────────────────────────
    if (/ciudad|urbano|cotidiano|diario/.test(useCase)) {
      if (trans.includes('auto')) parts.push('automático — ideal para tráfico');
      else if (km < 50000 && km > 0) parts.push(`${Math.round(km / 1000)}k km — bajo para el año`);
    }
    if (/ruta|viaj|autopista|largo/.test(useCase)) {
      if (fuel.includes('diesel')) parts.push('diesel — el más eficiente en ruta');
      else parts.push('buen rendimiento en ruta');
    }
    if (/trabajo|remis|taxi|uber|delivery|comercial/.test(useCase)) {
      if (hasGnc) parts.push('GNC instalado — ahorrás fuerte');
      else if (fuel.includes('diesel')) parts.push('diesel para trabajo intensivo');
    }
    if (/famil|chico|ni[ñn]o|kids/.test(useCase)) {
      parts.push('espacio para toda la familia');
    }
    if (/campo|off.?road|4x4|tierra|monta[ñn]a/.test(useCase)) {
      if (fuel.includes('diesel')) parts.push('diesel para campo y trabajo duro');
    }

    // ── Match de preferencias ───────────────────────────────────────────────
    if (wantsGnc && hasGnc && !parts.some((p) => p.includes('GNC')))
      parts.push('✅ tiene GNC instalado');
    if (wantsAuto && trans.includes('auto') && !parts.some((p) => p.includes('aut')))
      parts.push('automático como pediste');
    if (wantsNew && isNew)
      parts.push('0km — sin kilómetros previos');

    // ── Budget fit ──────────────────────────────────────────────────────────
    if (budget && price) {
      const diffPct = ((price - budget) / budget) * 100;
      if (diffPct <= 0) parts.push('entra en tu presupuesto');
      else if (diffPct <= 10)
        parts.push(`apenas ${Math.round(diffPct)}% sobre tu tope — habría margen`);
    }

    // ── Highlights objetivos ────────────────────────────────────────────────
    if (!isNew && km > 0 && km < 30000) parts.push('km muy bajo para el año');
    if (year >= 2022 && !parts.some((p) => p.includes('reciente')))
      parts.push('modelo reciente');

    if (!parts.length) return null;
    return `[id:${v.id}] → ${parts.slice(0, 2).join(' · ')}`;
  };

  const annotated = vehicles
    .slice(0, 20)
    .map(getArg)
    .filter((x): x is string => x !== null);

  if (!annotated.length) return '';

  return [
    '\n── ARGUMENTOS POR VEHÍCULO (usá estos al mostrar opciones — ANCLA DE VALOR primero) ──',
    'Formato sugerido: "Un [nombre] — [argumento corto] — sale $[precio]"',
    ...annotated,
  ].join('\n');
}

// ─── 3. Comparison Intent Detection ──────────────────────────────────────────

/**
 * Detecta si el cliente está pidiendo comparar dos opciones.
 * Ej: "cuál me conviene más, el Cronos o el Onix?", "qué diferencia hay entre estos dos?"
 */
export function detectComparisonIntent(userMessage: string): boolean {
  return /\b(cu[aá]l\s+(me\s+)?conviene|cu[aá]l\s+es\s+mejor|diferencia\s+entre|cu[aá]l\s+(te\s+)?parece\s+mejor|qu[eé]\s+diferencia\s+hay|cu[aá]l\s+elegiría[sn]?|cu[aá]l\s+comprar[ií]as?|me\s+conviene\s+m[aá]s|qu[eé]\s+tiene\s+de\s+mejor|en\s+qu[eé]\s+se\s+diferencia)\b/i.test(
    userMessage
  );
}

// ─── 4. Comparison Directive ──────────────────────────────────────────────────

/**
 * Genera instrucción específica cuando el cliente compara dos autos.
 *
 * OBJETIVO: que el bot TOME PARTIDO según el perfil del cliente,
 * no que diga "ambos son buenas opciones" (que es la respuesta inútil por defecto).
 */
export function getComparisonDirective(params: {
  userMessage: string;
  extracted: Record<string, any>;
}): string {
  const { extracted: ctx } = params;
  const useCase = ctx?.useCase ? `(uso del cliente: ${ctx.useCase})` : '';
  const budget = (ctx?.maxPrice ?? ctx?.amount)
    ? `(presupuesto: ${ctx?.currency ?? 'ARS'} ${Number(ctx?.maxPrice ?? ctx?.amount).toLocaleString('es-AR')})`
    : '';

  return [
    `\n── DIRECTIVA: COMPARACIÓN ENTRE OPCIONES ──`,
    `El cliente está comparando. INSTRUCCIONES OBLIGATORIAS:`,
    `1. TOMÁ PARTIDO — nunca digas "ambos son buenas opciones" o "depende de cada uno". Eso no ayuda.`,
    `2. Usá el perfil ${useCase} ${budget} para decidir cuál conviene más.`,
    `3. Si no hay suficiente contexto: preguntá UNA sola cosa ("¿Para qué lo usarías más?") antes de opinar.`,
    `4. Compará en máximo 2-3 dimensiones concretas: precio / km / caja / uso / consumo / año.`,
    `5. Terminá con posición clara: "Para lo que mencionás, te va mejor el [auto X] porque [razón concreta]."`,
    `6. CTA: "¿Querés que te mande los detalles del [ganador]?"`,
    ``,
    `EJEMPLO CORRECTO:`,
    `  "Para ciudad con tráfico, el Onix automático te conviene más — es más liviano, más fácil de estacionar`,
    `   y consume menos. La Hilux tiene mucho más auto del que necesitás para ese uso y sale más cara de mantener.`,
    `   ¿Te paso las fichas del Onix que tenemos en stock?"`,
    ``,
    `EJEMPLO INCORRECTO (nunca decir):`,
    `  "Ambos son excelentes opciones, depende de tus preferencias y necesidades personales..."`,
  ].join('\n');
}

// ─── 5. Stage-Specific Directive ─────────────────────────────────────────────

/**
 * Genera instrucción concreta según la etapa del funnel.
 *
 * Esto es más específico que el "REGLA PRINCIPAL" del prompt base —
 * le dice al agente exactamente qué hacer en ESTA respuesta puntual.
 */
export function getStageSpecificDirective(
  stage: FunnelStage,
  extracted: Record<string, any>,
  leadScore: number,
  hasStock: boolean
): string {
  const brand = extracted?.brand ?? '';
  const model = extracted?.model ?? '';
  const vehicleRef = [brand, model].filter(Boolean).join(' ') || 'el auto';

  const directives: Record<FunnelStage, string[]> = {
    discovery: [
      `MODO DESCUBRIMIENTO — el cliente recién llega, no sabemos nada o casi nada.`,
      `• Una sola pregunta. La más valiosa: uso o presupuesto.`,
      `• Si dice "qué tenés?" o "mostrá algo" sin filtros → preguntá primero "¿Para qué lo usarías más?"`,
      `• NO muestres el catálogo todavía — sin al menos 1 filtro las opciones no sirven.`,
      `• Tono: curioso y amigable. "¿Para qué lo vas a usar principalmente?"`,
      `• NO pidas nombre ni teléfono todavía.`,
    ],

    qualification: [
      `MODO CALIFICACIÓN — tenemos datos básicos. Hora de mostrar opciones.`,
      `• Mostrá 2-3 autos concretos. No hagas más preguntas antes de mostrar.`,
      `• Usá los ARGUMENTOS POR VEHÍCULO de arriba — primero el beneficio, luego el precio.`,
      `• Formato WhatsApp: 🚗 *Marca Modelo Año* · 💰 Precio · 📍 Km | Caja | Combustible`,
      `• Terminá con: "¿Cuál te llama la atención?"`,
      hasStock
        ? `• HAY STOCK DISPONIBLE — mostralo directamente.`
        : `• SIN STOCK EXACTO — ofrecé lo más cercano + "¿Querés que te avise cuando entre?"`,
    ],

    presentation: [
      `MODO PRESENTACIÓN — el cliente ya vio opciones. Se está decidiendo.`,
      `• Profundizá en el auto que más le llamó. Resolvé dudas técnicas con datos reales.`,
      `• Nunca inventes especificaciones — usá solo lo del catálogo.`,
      `• CTA fuerte: "¿Te animás a pasarte a verlo esta semana?" o "¿Calculamos la financiación?"`,
      `• No muestres opciones nuevas a menos que el cliente las pida explícitamente.`,
      leadScore >= 50
        ? `• Lead TIBIO/CALIENTE — empujá hacia visita o financiación. Urgencia suave si hay pocas unidades.`
        : '',
    ].filter(Boolean),

    objection: [
      `MODO OBJECIÓN — el cliente puso un freno. Manejalo con cuidado.`,
      `• Primero validá: "Entiendo." / "Tiene sentido." — nunca atacues la objeción directamente.`,
      `• Preguntá la objeción específica si no está clara: "¿Qué es lo que no te termina de convencer?"`,
      `• Nunca bajes el precio directamente — ese es trabajo del asesor humano.`,
      `• Puentes disponibles: financiación, permuta, versión anterior más barata, alternativa similar.`,
      `• Terminá con: "¿Qué le faltaría para que sea el correcto?"`,
      `• Si ya usaste financiación como puente antes → ofrecé permuta o alternativa de precio.`,
    ],

    closing: [
      `MODO CIERRE — el cliente está listo. No generes más fricción.`,
      `• handoffRecommended=true. SIEMPRE en esta etapa.`,
      `• No hagas más preguntas de calificación. Ya tenés lo que necesitás.`,
      `• Proponé día y hora concretos: "¿Te viene bien esta semana, martes o jueves?"`,
      `• Confirmá los datos clave: ${vehicleRef} + forma de pago + permuta si aplica.`,
      `• CTA asuntivo: "¿Lo hacemos a nombre tuyo?" o "¿Arrancamos con los datos para la reserva?"`,
    ],
  };

  const lines = directives[stage] ?? directives.qualification;
  return [
    `\n── DIRECTIVA DE ETAPA (${stage.toUpperCase()}) ──`,
    ...lines.filter(Boolean),
  ].join('\n');
}

// ─── 6. Response Quality Check (lightweight, fast) ───────────────────────────

/**
 * Evalúa si una respuesta del agente suena como vendedor real o como bot.
 * Retorna lista de advertencias para loggear — no bloquea.
 */
export function auditBotResponse(reply: string): string[] {
  const warnings: string[] = [];
  const r = reply.toLowerCase();

  // Frases genéricas inaceptables
  if (/ambos son (muy )?buena[s]? opcion/i.test(reply))
    warnings.push('GENÉRICO: "ambos son buenas opciones" — tomar partido');
  if (/tenemos mucha variedad/i.test(reply))
    warnings.push('GENÉRICO: "tenemos mucha variedad" — mostrar autos concretos');
  if (/depende de tus preferencias personales/i.test(reply))
    warnings.push('GENÉRICO: "depende de preferencias" — dar opinión concreta');
  if (/estamos a tu disposición/i.test(reply))
    warnings.push('CORPORATIVO: "estamos a tu disposición" — suena a FAQ');
  if (/no dudes en consultarnos/i.test(reply))
    warnings.push('CORPORATIVO: "no dudes en consultarnos" — suena a FAQ');

  // Más de una pregunta por respuesta
  const questionMarks = (reply.match(/\?/g) ?? []).length;
  if (questionMarks > 2)
    warnings.push(`FRICCIÓN: ${questionMarks} preguntas en una respuesta — máximo 1`);

  // Respuesta muy larga sin acción
  const wordCount = reply.split(/\s+/).length;
  if (wordCount > 120 && !/(visita|reserva|asesor|coordin|arrancamos|paso con)/i.test(r))
    warnings.push('LARGO SIN CTA: respuesta de más de 120 palabras sin llamado a la acción');

  // Precio sin nombre del auto (violación de ANCLA DE VALOR)
  if (/^\s*💰|\bsale\s+\$[0-9]|\bcuesta\s+\$[0-9]/i.test(reply) && !/🚗|🔗|\*[A-Z]/i.test(reply))
    warnings.push('ANCLA: precio mencionado sin nombre del auto (ANCLA DE VALOR invertida)');

  return warnings;
}
