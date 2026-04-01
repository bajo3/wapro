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
import { getCatalog, searchCatalog, formatItemLine } from './catalog.js';
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

function inferIntentHint(text: string, extracted: any): string {
  const t = normLight(text);
  if (/(reserv|reserva|seña|senia|me lo llevo|lo tomo|quiero avanzar|quiero reservar)/.test(t)) return 'compra_directa';
  if (/(visita|puedo ir|pasar a verlo|verlo hoy|test drive|probarlo)/.test(t)) return 'visita';
  if (/(no me convence|lo pienso|despues te aviso|después te aviso|voy a pensarlo)/.test(t)) return 'cierre_frio';
  if (/(que me recomendas|qué me recomendás|ayudame a elegir|no me decido)/.test(t)) return 'indecision';
  if (/(cual me conviene|cuál me conviene|compar|onix|cronos)/.test(t) && /( o | y )/.test(t)) return 'comparacion';
  if (/(financi|cuotas|anticipo|dni|recibo|tasa|credito|crédito)/.test(t) || extracted?.wantsFinancing) return 'financiacion';
  if (/(permuta|parte de pago|entrego|usado|mi auto|gnc)/.test(t) || extracted?.hasTradeIn) return 'usado';
  if (/(direccion|dirección|ubicacion|ubicación|donde estan|dónde están|como llego|cómo llego|mapa|tandil)/.test(t)) return 'ubicacion';
  if (/(precio|vale|valor|stock|disponible|tenes|tenés|hay|busco|modelo)/.test(t) || extracted?.brand || extracted?.model || extracted?.amount || extracted?.maxPrice) return 'stock';
  return 'fallback';
}

function naturalQuestionForField(field: string): string {
  const map: Record<string, string> = {
    tradein_model: '¿Qué auto tenés para entregar? Pasame marca y modelo.',
    tradein_year: '¿De qué año es?',
    tradein_km: '¿Cuántos kilómetros tiene?',
    down_payment: '¿Cuánto podrías poner de anticipo?',
    installments: '¿En cuántas cuotas te gustaría?',
    from_zone: '¿Desde qué zona venís?',
    vehicle_query: '¿Qué marca o modelo te interesa?',
    payment_type: '¿Vas a pagar en efectivo o querés financiar parte?',
    use_case: '¿Para qué lo vas a usar más: ciudad, ruta, familia o trabajo?',
    budget: '¿Cuál es tu presupuesto máximo?',
    priority: '¿Qué priorizás más: ciudad, ruta, espacio o presupuesto?',
    vehicle_id: '¿Cuál de las opciones te interesa ver?'
  };
  return map[field] || 'Decime un dato más y te ayudo mejor.';
}

function humanizePolicyReply(text: string, policy: any, extracted: any): string {
  const source = normLight(`${policy?.title || ''} ${(policy?.triggers || []).join(' ')} ${policy?.body || ''} ${text}`);
  if (/iva/.test(source)) {
    return 'Ese es el precio publicado. Si querés confirmar si tiene algún cargo extra o si aplica IVA de una forma particular, te lo valida el asesor.';
  }
  if (/financi|cuotas|dni|recibo|tasa|anticipo|credito/.test(source)) {
    if (/tasa/.test(normLight(text))) {
      return 'La tasa y la cuota exacta dependen del anticipo y del plazo. Si querés, decime cuánto podés poner y en cuántas cuotas lo querés hacer, y te digo por dónde conviene encararlo.';
    }
    if (/(papeles|document|recibo)/.test(normLight(text))) {
      return 'En muchos casos se puede arrancar con DNI. Para orientarte bien, decime qué auto te interesa, cuánto podrías poner de anticipo y en cuántas cuotas lo querés mirar.';
    }
    return 'Sí, se puede evaluar. Para orientarte bien decime cuánto podés poner de anticipo y en cuántas cuotas lo querés hacer, y te digo por dónde conviene encararlo.';
  }
  if (/permuta|parte de pago|usado|gnc|tasacion|tasacion/.test(source)) {
    const km = Number(extracted?.tradeInKm ?? extracted?.km ?? 0) || 0;
    if (/gnc/.test(normLight(text))) {
      return 'Sí, puede servir, pero depende del estado y la documentación. ¿Lo tenés asentado en cédula y con la oblea al día?';
    }
    if (km >= 150000) {
      return `Con ${km.toLocaleString('es-AR')} km puede ser más difícil tomarlo, pero igual lo evaluamos. ¿Me pasás modelo, año y unas fotos?`;
    }
    return 'Sí, podemos tomar tu usado como parte de pago. Pasame marca, año y kilómetros y te digo cómo encararlo.';
  }
  if (/stock|precio|disponible|catalogo|catálogo/.test(source)) {
    if (!extracted?.brand && !extracted?.model) return 'Lo miro contra el catálogo real. Decime marca o modelo y te confirmo stock y precio.';
    if (!extracted?.year) return 'Lo miro contra el catálogo real. ¿Qué año o versión tenés en mente?';
    return 'Lo chequeo contra el catálogo real y te confirmo stock y precio de esa opción.';
  }
  if (/ubicacion|ubicación|direccion|dirección|mapa|tandil/.test(source)) {
    return 'Estamos en Tandil. Si querés, te paso la ubicación y una referencia según desde qué zona venís.';
  }
  return String(policy?.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean).slice(0, 2).join(' ');
}

function buildCatalogReply(catalog: any[], text: string, extracted: any): string | null {
  if (!Array.isArray(catalog) || !catalog.length) return null;
  const query = [extracted?.brand, extracted?.model, text].filter(Boolean).join(' ');
  const hits = searchCatalog(catalog, query, 3);
  if (!hits.length) return null;
  if (hits.length === 1) {
    return `Sí, tengo esta opción para mostrarte:\n${formatItemLine(hits[0], 1)}\n\nSi querés, te digo si te conviene o coordinamos para verla.`;
  }
  return ['Sí, mirá estas opciones del stock:', ...hits.map((item: any, idx: number) => formatItemLine(item, idx + 1)), '', 'Si querés, te digo cuál conviene más según uso o presupuesto.'].join('\n');
}

async function buildDeterministicFallback(text: string, extracted: any): Promise<{ reply: string; intent: string; missing_fields: string[] }> {
  const intent = inferIntentHint(text, extracted);
  if (intent === 'financiacion') {
    const missing: string[] = [];
    if (!extracted?.amount && !extracted?.maxPrice) missing.push('budget');
    if (extracted?.amount || extracted?.maxPrice) {
      if (!extracted?.downPayment) missing.push('down_payment');
      if (!extracted?.cuotas && !extracted?.installments) missing.push('installments');
    }
    const first = missing[0];
    const reply = first
      ? (first === 'budget' ? 'Sí, se puede evaluar. Decime qué auto te interesa o qué presupuesto manejás y lo encaramos bien.' : naturalQuestionForField(first))
      : 'Sí, se puede evaluar. Decime cuánto podés poner de anticipo y en cuántas cuotas lo querés hacer, y seguimos.';
    return { reply, intent, missing_fields: first ? [first] : [] };
  }
  if (intent === 'usado') {
    const missing: string[] = [];
    if (!extracted?.tradeInModel && !extracted?.model) missing.push('tradein_model');
    if (!extracted?.tradeInYear && !extracted?.year) missing.push('tradein_year');
    if (extracted?.tradeInKm === undefined && extracted?.km === undefined) missing.push('tradein_km');
    const first = missing[0];
    if (/gnc/.test(normLight(text))) {
      return { reply: 'Sí, puede servir, pero depende del estado y la documentación. ¿Lo tenés asentado en cédula y con la oblea al día?', intent, missing_fields: [] };
    }
    if (first) {
      return { reply: `Sí, podemos tomar tu usado como parte de pago. ${naturalQuestionForField(first)}`, intent, missing_fields: [first] };
    }
    return { reply: 'Perfecto, con esos datos ya se puede evaluar. Si querés, mandame también unas fotos y te digo cómo conviene seguir.', intent, missing_fields: [] };
  }
  if (intent === 'ubicacion') {
    if (/(mapa|direccion|dirección)/.test(normLight(text))) {
      return { reply: 'Estamos en Tandil. Si querés, te paso la ubicación y una referencia según desde qué zona venís.', intent, missing_fields: [] };
    }
    return { reply: 'Estamos en Tandil. ¿Desde qué zona venís? Así te indico mejor y vemos disponibilidad.', intent, missing_fields: ['from_zone'] };
  }
  if (intent === 'visita') {
    return { reply: 'Sí, podés venir a verlo. Estamos en Tandil, de Lun a Vie de 9 a 18 y Sáb de 9:30 a 13. ¿Cuál de las opciones te interesa así te confirmo disponibilidad?', intent, missing_fields: ['vehicle_id'] };
  }
  if (intent === 'compra_directa') {
    return { reply: 'Genial, avanzamos. ¿Vas a pagar en efectivo o querés financiar parte? Si querés, te pongo en contacto con un asesor para coordinar la seña.', intent, missing_fields: ['payment_type'] };
  }
  if (intent === 'indecision') {
    return { reply: 'Dale, te ayudo. ¿Para qué lo vas a usar más y qué presupuesto máximo tenés? Con eso te recomiendo 2 opciones concretas.', intent, missing_fields: ['use_case', 'budget'] };
  }
  if (intent === 'comparacion') {
    return { reply: 'Depende de qué priorizás. Si me decís si lo usás más en ciudad o en ruta y qué presupuesto querés mantener, te digo cuál conviene más para tu caso.', intent, missing_fields: ['priority'] };
  }
  if (intent === 'cierre_frio') {
    return { reply: 'Perfecto, no hay apuro. Si querés lo dejamos abierto, pero contame: ¿hay algo puntual que te genera duda o algo que no te termina de convencer?', intent, missing_fields: [] };
  }
  if (intent === 'stock') {
    const catalog = await getCatalog();
    const stockReply = buildCatalogReply(catalog, text, extracted);
    if (stockReply) return { reply: stockReply, intent, missing_fields: [] };
    if (!catalog.length) {
      return { reply: 'En este momento no tengo stock cargado para mostrarte. Decime qué marca o modelo buscás y te aviso apenas entre algo parecido.', intent, missing_fields: ['vehicle_query'] };
    }
    if (!extracted?.brand && !extracted?.model) {
      return { reply: 'Decime qué marca o modelo te interesa y te muestro opciones reales del stock.', intent, missing_fields: ['vehicle_query'] };
    }
    return { reply: 'No encontré una coincidencia clara en el stock ahora mismo. Si querés, decime año o presupuesto y te lo afino.', intent, missing_fields: ['budget'] };
  }
  return { reply: 'Contame qué auto tenés en mente o qué presupuesto manejás y te ayudo a encontrar una opción lógica.', intent: 'fallback', missing_fields: [] };
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

  const pb = await matchPlaybook(text);
  if (pb?.template) {
    sources.push({ type: 'playbook', id: pb.id, title: pb.intent ?? null, intent: pb.intent ?? null });

    // A/B (prefer playbook-scoped overrides; fallback to intent-scoped)
    let variant: string | null = null;
    let template = String(pb.template);
    const abRows = (await getAbVariantsFor('playbook', String(pb.id))).concat(await getAbVariantsFor('intent', String(pb.intent)));
    if (abRows.length) {
      const total = abRows.reduce((acc: number, r: any) => acc + Number(r.weight ?? 0), 0) || 1;
      let pick = Math.random() * total;
      const chosen = abRows.find((r: any) => {
        pick -= Number(r.weight ?? 0);
        return pick <= 0;
      }) ?? abRows[0];
      variant = String(chosen.variant ?? 'A');
      if (chosen.template_override) template = String(chosen.template_override);
    }

    // ── Guardrail mejorado v5: NO preguntar campos faltantes si el cliente
    //    pidió ver opciones directamente o si ya tiene datos de filtro suficientes.
    const req = requiredFieldsForIntent(String(pb.intent ?? 'playbook'), pb.config);
    const missing = computeMissingFields(req, extracted);
    const cfg = (pb.config && typeof pb.config === 'object') ? pb.config : {};
    const autoAsk = cfg.autoAskMissing !== undefined ? Boolean(cfg.autoAskMissing) : true;

    // v5: si el cliente quiere ver opciones o tiene filtros útiles, saltar el interrogatorio
    const clientWantsToSee = shouldShowResults(extracted);
    if (autoAsk && missing.length && !clientWantsToSee) {
      const ask = buildMissingQuestions(req, missing);
      return { reply: ask, intent: String(pb.intent ?? 'playbook'), sources, settings, extracted, missing_fields: missing, variant };
    }

    const reply = renderTemplate(String(template), { state, settings, playbook: pb, extracted, missing_fields: missing, variant });
    return { reply, intent: String(pb.intent ?? 'playbook'), sources, settings, extracted, missing_fields: missing, variant };
  }

  const faq = await matchFaq(text);
  if (faq?.answer) {
    sources.push({ type: 'faq', id: faq.id, title: faq.title ?? null });
    const reply = renderTemplate(String(faq.answer), { state, settings, faq, extracted });
    return { reply, intent: 'faq', sources, settings, extracted, missing_fields: [] };
  }

  const policy = await matchPolicy(text);
  if (policy?.body) {
    sources.push({ type: 'policy', id: policy.id, title: policy.title ?? null });
    const reply = humanizePolicyReply(text, policy, extracted);
    return { reply, intent: inferIntentHint(text, extracted), sources, settings, extracted, missing_fields: [] };
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

  const deterministic = await buildDeterministicFallback(text, extracted);
  return {
    reply: deterministic.reply,
    suggestedReply: deterministic.reply,
    intent: deterministic.intent,
    sources,
    settings,
    extracted,
    missing_fields: deterministic.missing_fields
  };
}
