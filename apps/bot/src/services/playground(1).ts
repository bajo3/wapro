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

import { buildMissingQuestions, computeMissingFields, extractLeadFields, requiredFieldsForIntent } from './extract.js';

export type PlaygroundSource = {
  type: 'policy' | 'faq' | 'playbook';
  id: number;
  title?: string | null;
  intent?: string | null;
};

export async function runPlayground(input: {
  text: string;
  state?: any;
}): Promise<{ reply: string; intent: string; sources: PlaygroundSource[]; settings: any; extracted?: any; missing_fields?: string[]; variant?: string | null }> {
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

    // Guardrails: required fields
    const req = requiredFieldsForIntent(String(pb.intent ?? 'playbook'), pb.config);
    const missing = computeMissingFields(req, extracted);
    const cfg = (pb.config && typeof pb.config === 'object') ? pb.config : {};
    const autoAsk = cfg.autoAskMissing !== undefined ? Boolean(cfg.autoAskMissing) : true;
    if (autoAsk && missing.length) {
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

  return {
    reply: 'No match (policy/faq/playbook). Tip: agregá triggers o probá con una frase más parecida a lo que escribe el cliente.',
    intent: 'none',
    sources,
    settings,
    extracted,
    missing_fields: []
  };
}
