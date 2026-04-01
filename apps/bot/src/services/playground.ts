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
import { buildForcedCatalogReply, decideAgentAction } from './agent.js';

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

export async function runPlayground(input: {
  text: string;
  state?: any;
}): Promise<{ reply: string; intent: string; sources: PlaygroundSource[]; settings: any; extracted?: any; missing_fields?: string[]; variant?: string | null; suggestedReply?: string; diagnostics?: any }> {
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

  const policy = await matchPolicy(text);
  if (policy?.body) {
    sources.push({ type: 'policy', id: policy.id, title: policy.title ?? null });
    const reply = renderTemplate(String(policy.body), { state, settings, policy, extracted });
    return { reply, intent: 'policy', sources, settings, extracted, missing_fields: [] };
  }

  const faq = await matchFaq(text);
  if (faq?.answer) {
    sources.push({ type: 'faq', id: faq.id, title: faq.title ?? null });
    const reply = renderTemplate(String(faq.answer), { state, settings, faq, extracted });
    return { reply, intent: 'faq', sources, settings, extracted, missing_fields: [] };
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

      const forced = buildForcedCatalogReply({
        userMessage: text,
        extracted: mergedExtracted,
        catalog,
        maxItems: 3
      });

      if (forced) {
        sources.push({ type: 'agent', id: 0, title: 'Forced Catalog Match', intent: 'stock_search' });
        return {
          reply: forced.suggestedReply,
          suggestedReply: forced.suggestedReply,
          intent: 'stock_search',
          sources,
          settings,
          extracted: mergedExtracted,
          missing_fields: [],
          diagnostics: {
            forcedCatalog: true,
            forcedReason: forced.reason,
            query: forced.query,
            matchCount: forced.matches.length,
            matches: forced.matches.map((item) => ({
              id: item.id,
              name: item.name,
              brand: item.brand,
              model: item.model,
              version: item.version,
              year: item.year,
              priceNumber: item.priceNumber,
              currency: item.currency,
              transmission: item.transmission,
              fuel: item.fuel,
              isNew: item.isNew,
            }))
          }
        };
      }

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
          missing_fields: decision.missingFields ?? [],
          diagnostics: {
            forcedCatalog: false,
            action: decision.action ?? null,
            urgency: decision.urgency ?? null,
            handoffRecommended: Boolean(decision.handoffRecommended),
            vehicleIds: decision.vehicleIds ?? [],
            internalReason: decision.internalReason ?? null,
          }
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
