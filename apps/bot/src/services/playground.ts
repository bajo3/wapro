import {
  getIntelligenceSettings,
  matchFaq,
  matchPlaybook,
  matchPolicy,
  renderTemplate,
  searchKnowledge,
  getAbVariantsFor
} from './intelligence.js';

import { pool } from './db.js';
import {
  buildMissingQuestions,
  computeMissingFields,
  extractLeadFields,
  requiredFieldsForIntent,
  shouldShowResults,
  detectClosure,
  detectClosingIntent
} from './extract.js';
import { getCatalog } from './catalog.js';
import { decideAgentAction } from './agent.js';

export type PlaygroundSource = {
  type: 'policy' | 'faq' | 'playbook' | 'agent';
  id: number;
  title?: string | null;
  intent?: string | null;
};

// ─── NLU ligera: intenciones conversacionales ────────────────────────────────
// Resuelve saludos y cierres ANTES de tocar FAQ/policy/playbook/RAG.
// Evita el fallback "sin respuesta" ante el mensaje más común de un lead: "hola".

function normLight(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

const GREETING_PATTERNS = [
  /^(hola|holi|ola|holas|holaa+)[\s!.?]*$/,
  /^(buen[ao]s?\s*(dias?|tardes?|noches?)?)[\s!.?]*$/,
  /^(buenas?|buen\s*dia)[\s!.?]*$/,
  /^(hey|hi|hello|heyy+)[\s!.?]*$/,
  /^(que\s*tal|como\s*(estas?|andas?|van?))[\s!.?]*$/,
];

const CLOSURE_LIGHT_PATTERNS = [
  /^(chau|chao|bye|adios|hasta\s*(luego|pronto|la\s*vista))[\s!.?]*$/,
  /^(gracias?|muchas?\s*gracias?)[\s!.?]*$/,
  /^(listo|ok|dale|perfecto|genial|de\s*acuerdo|entendido)[\s!.?]*$/,
  /^(lo\s*pienso|despues\s*te\s*aviso|voy\s*a\s*ver)[\s!.?]*$/,
];

const GREETING_REPLIES = [
  '¡Hola! Bienvenido. ¿Estás buscando un auto nuevo, o tenés algo en mente? Te ayudo a encontrar opciones.',
  '¡Buenas! ¿Buscás un 0km o un usado? ¿Tenés marca o presupuesto en mente?',
  '¡Hola! Contame, ¿qué tipo de auto estás buscando? Puedo mostrarte opciones de stock o arrancamos desde lo que tenés.',
];

const CLOSURE_LIGHT_REPLIES = [
  'Dale, cuando quieras retomamos. Si necesitás más info o querés ver opciones, acá estoy. ¡Éxitos!',
  'Perfecto, sin apuro. Cualquier consulta me avisás. ¡Hasta pronto!',
  'Cuando quieras seguimos. Si querés ver más opciones o te surge alguna duda, escribime.',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isGreeting(text: string): boolean {
  const t = normLight(text);
  return GREETING_PATTERNS.some(re => re.test(t));
}

function isCasualClosure(text: string): boolean {
  const t = normLight(text);
  return CLOSURE_LIGHT_PATTERNS.some(re => re.test(t));
}


type DirectIntentResult = {
  reply: string;
  intent: string;
  sourceType: 'policy' | 'faq' | 'playbook';
  sourceTitle: string;
  missing_fields?: string[];
};

function buildDirectResult(input: {
  reply: string;
  intent: string;
  sourceType: 'policy' | 'faq' | 'playbook';
  sourceTitle: string;
  missing_fields?: string[];
}): DirectIntentResult {
  return {
    reply: input.reply,
    intent: input.intent,
    sourceType: input.sourceType,
    sourceTitle: input.sourceTitle,
    missing_fields: input.missing_fields ?? []
  };
}

function normIntentText(text: string): string {
  return normLight(text)
    .replace(/[¿?¡!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasOwnVehicleContext(text: string, extracted: any): boolean {
  const t = normIntentText(text);
  return Boolean(
    extracted?.hasTradeIn ||
    extracted?.tradeIn ||
    extracted?.tradeInModel ||
    extracted?.tradeInYear ||
    extracted?.tradeInKm !== undefined ||
    /\b(mi auto|mi usado|parte de pago|para entregar|entrego|permuta|tasaci[oó]n|cu[aá]nto me das por mi usado|tengo un [a-z0-9]+)/.test(t)
  );
}

function hasFinancingContext(text: string, extracted: any): boolean {
  const t = normIntentText(text);
  return Boolean(
    extracted?.wantsFinancing ||
    extracted?.cuotas ||
    extracted?.percent ||
    /\b(financi|cuotas?|anticipo|dni|recibo|papeles|documentos|cr[eé]dito|tasa|por ciento|40%)\b/.test(t)
  );
}

function buildPlaybookReply(intent: string, pb: any, extracted: any, state: any, settings: any, sources: PlaygroundSource[]) {
  if (!pb?.template) return null;
  sources.push({ type: 'playbook', id: pb.id, title: pb.intent ?? null, intent: pb.intent ?? null });

  const req = requiredFieldsForIntent(String(pb.intent ?? intent), pb.config);
  const missing = computeMissingFields(req, extracted);
  const cfg = (pb.config && typeof pb.config === 'object') ? pb.config : {};
  const autoAsk = cfg.autoAskMissing !== undefined ? Boolean(cfg.autoAskMissing) : true;
  const clientWantsToSee = shouldShowResults(extracted);

  if (autoAsk && missing.length && !clientWantsToSee) {
    return {
      reply: buildMissingQuestions(req, missing),
      intent: String(pb.intent ?? intent),
      missing_fields: missing,
      suggestedReply: buildMissingQuestions(req, missing)
    };
  }

  const reply = renderTemplate(String(pb.template), { state, settings, playbook: pb, extracted, missing_fields: missing, variant: null });
  return {
    reply,
    intent: String(pb.intent ?? intent),
    missing_fields: missing,
    suggestedReply: reply
  };
}

function resolveDeterministicRoute(text: string, extracted: any): DirectIntentResult | null {
  const t = normIntentText(text);
  const ownVehicle = hasOwnVehicleContext(text, extracted);

  // Compra directa / reserva
  if (/\b(como hago para reservar|como reservo|reservarlo|reservarlo|reservarlo|reservar|apartar|señ[ao]|dejar seña)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Sí, se puede reservar con una seña. El monto lo coordina el asesor según el caso. ¿Querés que te ponga en contacto con alguien para arreglarlo hoy?',
      intent: 'compra_directa',
      sourceType: 'faq',
      sourceTitle: 'Reserva - cómo apartar un auto'
    });
  }
  if (/\b(lo tomo|me lo llevo|lo compro|quiero comprar|quiero ese|hacemos algo|dale me lo llevo)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Genial, avancemos. Para cerrar necesito confirmarte unos datos rápido:\n- ¿Es el auto que venimos viendo?\n- ¿Vas a pagar en efectivo o querés financiar parte?\n- ¿Tenés un usado para entregar?\n\nCon eso te pongo en contacto con el asesor para coordinar la seña y el trámite. ¿Dale?',
      intent: 'compra_directa',
      sourceType: 'playbook',
      sourceTitle: 'compra_directa',
      missing_fields: ['payment_type']
    });
  }

  // Cierre frío / objeciones
  if (/\b(lo pienso|despues te aviso|después te aviso|voy a pensarlo|no me (?:termina de )?convencer|no estoy seguro|tengo que pensarlo)\b/.test(t)) {
    const reply = /\bno me (?:termina de )?convencer\b/.test(t)
      ? 'Entiendo. Si querés, lo vemos sin apuro. Decime qué es lo que no te convence o qué te frena, y te digo si hay una alternativa que te cierre mejor.'
      : 'Perfecto, no hay apuro. Si querés que te lo aparte mientras lo pensás, avisame. Este tipo de unidad suele rotar rápido y no siempre hay stock. ¿Hay alguna duda o algo que te frene?';
    return buildDirectResult({
      reply,
      intent: 'cierre_frio',
      sourceType: 'playbook',
      sourceTitle: 'cierre_frio'
    });
  }

  // Indecisión / comparación
  if (/\b(no se que elegir|no sé qué elegir|ayudame a elegir|me ayudas a elegir|no me decido|sed[aá]n y suv)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Dale, te ayudo. Para recomendarte bien necesito saber:\n1) ¿Para qué lo vas a usar más (ciudad, ruta, familia o trabajo)?\n2) ¿Cuál es tu presupuesto máximo?\n3) ¿Necesitás que sea automático o te da igual?\nCon eso te paso 2 opciones concretas que se ajusten a tu caso.',
      intent: 'indecision',
      sourceType: 'playbook',
      sourceTitle: 'indecision',
      missing_fields: ['use_case', 'budget']
    });
  }
  if (/\b(cual me conviene mas|cu[aá]l me conviene m[aá]s|cual es mejor|cu[aá]l es mejor|diferencia entre|entre .* y .*|comparo)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Buena pregunta. Depende de qué priorizás:\n- Si buscás comodidad y equipamiento, hay una opción que suele rendir mejor en ciudad.\n- Si priorizás ruta y espacio, puede convenirte la otra.\n¿Lo usarías más en ciudad o ruta? ¿Y qué presupuesto querés respetar? Con eso te recomiendo uno de verdad.',
      intent: 'comparacion',
      sourceType: 'playbook',
      sourceTitle: 'comparacion',
      missing_fields: ['priority']
    });
  }

  // Ubicación / visita / test drive
  if (/\b(test drive|probarlo|probar el auto|prueba de manejo|lo puedo probar)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Sí, hacemos test drive. Lo coordinamos con una visita y podés probarlo antes de decidir. ¿Qué auto te interesa y qué día podrías venir? Así te confirmo disponibilidad.',
      intent: 'faq',
      sourceType: 'faq',
      sourceTitle: 'Test drive'
    });
  }
  if (/\b(tenes mapa|tenés mapa|mapa)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Estamos en Tandil. Si querés, decime desde qué zona venís y te paso la mejor referencia para llegar sin vueltas.',
      intent: 'ubicacion',
      sourceType: 'faq',
      sourceTitle: 'Ubicación'
    });
  }
  if (/\b(donde queda|d[oó]nde queda|direccion|dirección|como llego|c[oó]mo llego|en que parte de tandil|en qué parte de tandil|donde estan|d[oó]nde est[aá]n)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Estamos en Tandil. Decime desde qué zona venís y te paso la ubicación exacta con la referencia que más te convenga.',
      intent: 'ubicacion',
      sourceType: 'playbook',
      sourceTitle: 'ubicacion',
      missing_fields: ['from_zone']
    });
  }
  if (/\b(cu[aá]ndo puedo pasar a verlos|cuando puedo pasar a verlos|quiero pasar a verlos)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Podés pasar a vernos cuando quieras. Estamos en Tandil, Lun a Vie de 9 a 18 hs y los Sáb de 9:30 a 13 hs. ¿Qué día te queda mejor? Te aviso disponibilidad.',
      intent: 'visita',
      sourceType: 'faq',
      sourceTitle: 'Visita - cómo ir a ver el auto'
    });
  }
  if (/\b(puedo ir a ver el auto hoy|puedo ir hoy|quiero ir a verlo|puedo ir a ver)\b/.test(t)) {
    return buildDirectResult({
      reply: '¡Dale! Podés venir a verlo. Estamos en Tandil, Lun a Vie de 9 a 18 hs y Sáb de 9:30 a 13 hs. ¿Qué auto te interesa ver? Así te confirmo que esté disponible para hoy.',
      intent: 'visita',
      sourceType: 'playbook',
      sourceTitle: 'visita',
      missing_fields: ['vehicle_id']
    });
  }
  if (/\b(que horario manejan|qué horario manejan|cuando abren|cu[aá]ndo abren|horarios?)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Atendemos: Lun a Vie de 9 a 18 hs y los Sáb de 9:30 a 13 hs. ¿Qué día te queda mejor para pasar?',
      intent: 'faq',
      sourceType: 'faq',
      sourceTitle: 'Horarios'
    });
  }

  // FAQs generales
  if (/\b(iva|precio final|incluye iva|con iva|sin iva)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Ese es el precio publicado al público. Si querés confirmar si tiene algún cargo extra según tu caso, te lo confirma el asesor. Nunca te voy a inventar un precio final sin verificar.',
      intent: 'policy',
      sourceType: 'policy',
      sourceTitle: 'Precios con/sin IVA'
    });
  }
  if (!ownVehicle && /\b(busco .*gnc|quiero con gnc|auto con gnc|con gnc)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Algunos de nuestros usados ya vienen con GNC instalado. Decime qué modelo buscás o cuál es tu presupuesto y te filtro los que tienen GNC disponible.',
      intent: 'faq',
      sourceType: 'faq',
      sourceTitle: 'GNC - vehículos con gas'
    });
  }
  if (/\b(garantia|garantía|tiene garantia|tiene garantía|que garantia|qué garantía)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Depende del auto y si es 0km o usado. Los 0km tienen la garantía del fabricante. Los usados se analizan caso a caso. ¿Cuál te interesa? Te confirmo las condiciones específicas.',
      intent: 'faq',
      sourceType: 'faq',
      sourceTitle: 'Garantía del vehículo'
    });
  }

  // Permuta / usado
  if (ownVehicle) {
    if (/\b(cu[aá]nto me das|tasaci[oó]n|cuanto me das)\b/.test(t)) {
      return buildDirectResult({
        reply: 'Para tasar tu usado necesito modelo, año, kilómetros y fotos. Con eso lo revisamos y te derivamos con un asesor para una valoración seria.',
        intent: 'usado',
        sourceType: 'policy',
        sourceTitle: 'Toma de usados'
      });
    }
    if ((typeof extracted?.tradeInKm === 'number' && extracted.tradeInKm >= 150000) || /\b160\s*mil|190\s*mil|180\s*mil|170\s*mil\b/.test(t)) {
      const km = extracted?.tradeInKm ?? extracted?.km;
      return buildDirectResult({
        reply: `Gracias. ${km ? `Por el kilometraje (${Number(km).toLocaleString('es-AR')} km) ` : ''}suele ser difícil tomarlo en parte de pago. Igual lo podemos evaluar: pasame fotos, estado general y si tiene GNC confirmame si está asentado y con oblea al día. También decime modelo y año si no lo pasaste.`,
        intent: 'usado',
        sourceType: 'policy',
        sourceTitle: 'Toma de usados (reglas)',
        missing_fields: ['tradein_model', 'tradein_year']
      });
    }
    if (/\bmi auto tiene gnc|tiene gnc, sirve|gnc\b/.test(t) && !/\bbusco|quiero con\b/.test(t)) {
      return buildDirectResult({
        reply: 'Sí, se puede evaluar, pero si tiene GNC necesito saber si está asentado en cédula, si la oblea está al día y el estado general del equipo. Además pasame modelo, año y kilómetros.',
        intent: 'usado',
        sourceType: 'policy',
        sourceTitle: 'Toma de usados (reglas)',
        missing_fields: ['tradein_model', 'tradein_year', 'tradein_km']
      });
    }
    if (/\b(permuta|parte de pago|para entregar|entrego|tengo un auto para entregar|tom[aá]s mi usado)\b/.test(t) || extracted?.hasTradeIn) {
      return buildDirectResult({
        reply: 'Sí, tomamos usados en parte de pago. Para evaluarlo necesito modelo, año, kilómetros y si tiene GNC. Con esos datos te digo cómo seguimos.',
        intent: 'usado',
        sourceType: 'playbook',
        sourceTitle: 'usado',
        missing_fields: ['tradein_model', 'tradein_year', 'tradein_km']
      });
    }
  }

  // Financiación
  if (hasFinancingContext(text, extracted)) {
    if (/\b(recibo|papeles|documentos|requisitos)\b/.test(t)) {
      return buildDirectResult({
        reply: 'Para arrancar con financiación podemos ver una pre-evaluación con DNI. Para orientarte mejor decime qué auto te interesa, cuánto podrías poner de anticipo y en cuántas cuotas lo querés.',
        intent: 'financiacion',
        sourceType: 'faq',
        sourceTitle: 'Requisitos financiación'
      });
    }
    if (/\b(tasa|40%|40 por ciento|cuarenta por ciento|dni)\b/.test(t) && !/\banticipo|cuotas?\b/.test(t)) {
      return buildDirectResult({
        reply: 'Se puede financiar hasta alrededor del 40% con DNI, según el caso. La aprobación y las condiciones dependen de la evaluación. Si querés, te oriento mejor con el anticipo y la cantidad de cuotas que buscás.',
        intent: 'financiacion',
        sourceType: 'policy',
        sourceTitle: 'Financiación (reglas)'
      });
    }
    return buildDirectResult({
      reply: 'Dale. Para armarte una propuesta rápida decime qué auto te interesa, cuánto podés poner de anticipo y en cuántas cuotas lo querés. Con eso te paso una estimación y lo vemos con un asesor.',
      intent: 'financiacion',
      sourceType: 'playbook',
      sourceTitle: 'financiacion',
      missing_fields: ['down_payment', 'installments']
    });
  }

  // Stock
  if (/\b(cu[aá]nto vale|cu[aá]nto sale|precio|stock hoy|hay stock|disponible hoy)\b/.test(t)) {
    return buildDirectResult({
      reply: 'No te voy a inventar un precio ni disponibilidad. Si me decís marca, modelo, año o versión, te confirmo lo que haya en catálogo y, si hace falta, lo revisa un asesor.',
      intent: 'stock',
      sourceType: 'policy',
      sourceTitle: 'No inventar precios ni stock'
    });
  }
  if (/\b(que autos tenes|qué autos tenés|que tenes|qué tenés|busco|tengo presupuesto|hasta \d|fiat cronos|onix|manual)\b/.test(t)) {
    return buildDirectResult({
      reply: 'Bien. Para encontrarte opciones necesito al menos una referencia: marca/modelo o presupuesto. Si querés, pasame ambos y te filtro 2 o 3 alternativas concretas.',
      intent: 'stock',
      sourceType: 'playbook',
      sourceTitle: 'stock',
      missing_fields: ['vehicle_query']
    });
  }

  return null;
}

export async function runPlayground(input: {
  text: string;
  state?: any;
}): Promise<{ reply: string; intent: string; sources: PlaygroundSource[]; settings: any; extracted?: any; missing_fields?: string[]; variant?: string | null; suggestedReply?: string }> {
  const text = String(input.text ?? '');
  const state = input.state ?? {};
  const settings = await getIntelligenceSettings();

  const sources: PlaygroundSource[] = [];
  const extracted = extractLeadFields(text, state?.extracted ?? state?.lead ?? {});

  // ── Intenciones conversacionales: responder antes de buscar en knowledge base ──
  if (isGreeting(text)) {
    return { reply: pickRandom(GREETING_REPLIES), intent: 'greeting', sources, settings, extracted, missing_fields: [] };
  }
  if (isCasualClosure(text)) {
    return { reply: pickRandom(CLOSURE_LIGHT_REPLIES), intent: 'closure', sources, settings, extracted, missing_fields: [] };
  }

  const directRoute = resolveDeterministicRoute(text, extracted);
  if (directRoute) {
    sources.push({ type: directRoute.sourceType, id: 0, title: directRoute.sourceTitle, intent: directRoute.intent });
    return {
      reply: directRoute.reply,
      suggestedReply: directRoute.reply,
      intent: directRoute.intent,
      sources,
      settings,
      extracted,
      missing_fields: directRoute.missing_fields ?? []
    };
  }

  // Prioridad de la base de conocimiento:
  // 1) playbooks (flujos concretos)
  // 2) FAQs (respuesta directa)
  // 3) policies (guardrails / reglas duras)
  const pb = await matchPlaybook(text);
  if (pb?.template) {
    const result = buildPlaybookReply(String(pb.intent ?? 'playbook'), pb, extracted, state, settings, sources);
    if (result) {
      return { ...result, sources, settings, extracted };
    }
  }

  const faq = await matchFaq(text);
  if (faq?.answer) {
    sources.push({ type: 'faq', id: faq.id, title: faq.title ?? null });
    const reply = renderTemplate(String(faq.answer), { state, settings, faq, extracted });
    return { reply, suggestedReply: reply, intent: String(faq.intent ?? 'faq'), sources, settings, extracted, missing_fields: [] };
  }

  const policy = await matchPolicy(text);
  if (policy?.body) {
    sources.push({ type: 'policy', id: policy.id, title: policy.title ?? null });
    const reply = renderTemplate(String(policy.body), { state, settings, policy, extracted });
    return { reply, suggestedReply: reply, intent: String(policy.intent ?? 'policy'), sources, settings, extracted, missing_fields: [] };
  }

  // Fallback: RAG-lite search over policies/faqs by full-text
  const hits = await searchKnowledge(text, 3);
  const top = hits[0];
  if (top && top.rank >= 0.12) {
    if (top.type === 'policy') {
      sources.push({ type: 'policy', id: top.id, title: top.title ?? null });
      const r = await pool.query('select body, title from bot_policies where id=$1', [top.id]);
      const body = r.rows?.[0]?.body;
      const reply = body ? renderTemplate(String(body), { state, settings, extracted }) : String(top.snippet);
      return { reply, intent: 'policy', sources, settings, extracted, missing_fields: [] };
    }
    sources.push({ type: 'faq', id: top.id, title: top.title ?? null });
    const r = await pool.query('select answer from bot_faq where id=$1', [top.id]);
    const ans = r.rows?.[0]?.answer;
    const reply = ans ? renderTemplate(String(ans), { state, settings, extracted }) : String(top.snippet);
    return { reply, intent: 'faq', sources, settings, extracted, missing_fields: [] };
  }

  // ─── Fallback al agente GPT si OPENAI_API_KEY está configurada ───────────────
  if (process.env.OPENAI_API_KEY) {
    try {
      const catalog = await getCatalog();
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(state?.history)
        ? state.history.slice(-6)
        : [];

      // Merge: campos extraídos del mensaje actual toman prioridad sobre el estado previo.
      // Esto garantiza que el agente siempre vea el cuadro más completo del lead.
      const mergedExtracted = { ...(state?.extracted ?? {}), ...extracted };

      // ── loopData v5: detectar campos pedidos repetidamente sin respuesta ─────
      const previousMissing: string[] = Array.isArray(state?.missing_fields) ? state.missing_fields : [];
      const currentMissing: string[] = [];
      // Si los mismos campos seguían faltando en el turno anterior y siguen faltando ahora,
      // los marcamos como "repeated" para que el agente no los vuelva a pedir.
      for (const field of previousMissing) {
        if (!mergedExtracted[field]) currentMissing.push(field);
      }

      const turnCount = typeof state?.turnCount === 'number' ? state.turnCount + 1 : 1;

      const loopData = {
        repeatedMissingFields: currentMissing,
        turnCount
      };

      // ── Flags especiales para el agente ─────────────────────────────────────
      // Propagar intenciones detectadas en extract al mergedExtracted
      if (detectClosure(text)) mergedExtracted.isClosure = true;
      if (detectClosingIntent(text)) mergedExtracted.closingIntent = true;

      const decision = await decideAgentAction({
        dealershipName: process.env.DEALERSHIP_NAME ?? settings?.dealership_name ?? undefined,
        userMessage: text,
        history,
        catalog,
        extracted: mergedExtracted,
        leadScore: state?.leadScore ?? 0,
        loopData
      });

      if (decision?.suggestedReply) {
        sources.push({ type: 'agent', id: 0, title: 'GPT Agent', intent: decision.intent });
        const reply = decision.suggestedReply;
        return {
          reply,
          suggestedReply: reply,
          intent: decision.intent ?? 'agent',
          sources,
          settings,
          extracted: { ...mergedExtracted, ...decision.extracted },
          missing_fields: decision.missingFields ?? []
        };
      }
    } catch (e) {
      // Log para diagnóstico; no re-throw para no romper el flujo.
      console.error('[playground] decideAgentAction failed:', e);
    }
  }

  return {
    reply: 'Sin respuesta del agente. Verificá que OPENAI_API_KEY esté configurada en el bot, o agregá políticas/FAQs/playbooks.',
    intent: 'none',
    sources,
    settings,
    extracted,
    missing_fields: []
  };
}
