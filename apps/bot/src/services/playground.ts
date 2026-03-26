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

export async function runPlayground(input: {
  text: string;
  state?: any;
}): Promise<{ reply: string; intent: string; sources: PlaygroundSource[]; settings: any; extracted?: any; missing_fields?: string[]; variant?: string | null; suggestedReply?: string }> {
  const text = String(input.text ?? '');
  const state = input.state ?? {};
  const settings = await getIntelligenceSettings();

  const sources: PlaygroundSource[] = [];
  const extracted = extractLeadFields(text, state?.extracted ?? state?.lead ?? {});

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
