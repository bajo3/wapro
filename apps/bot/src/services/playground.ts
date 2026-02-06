import { getIntelligenceSettings, matchFaq, matchPlaybook, matchPolicy, renderTemplate } from './intelligence.js';

export type PlaygroundSource = {
  type: 'policy' | 'faq' | 'playbook';
  id: number;
  title?: string | null;
  intent?: string | null;
};

export async function runPlayground(input: {
  text: string;
  state?: any;
}): Promise<{ reply: string; intent: string; sources: PlaygroundSource[]; settings: any }> {
  const text = String(input.text ?? '');
  const state = input.state ?? {};
  const settings = await getIntelligenceSettings();

  const sources: PlaygroundSource[] = [];

  const policy = await matchPolicy(text);
  if (policy?.body) {
    sources.push({ type: 'policy', id: policy.id, title: policy.title ?? null });
    const reply = renderTemplate(String(policy.body), { state, settings, policy });
    return { reply, intent: 'policy', sources, settings };
  }

  const faq = await matchFaq(text);
  if (faq?.answer) {
    sources.push({ type: 'faq', id: faq.id, title: faq.title ?? null });
    const reply = renderTemplate(String(faq.answer), { state, settings, faq });
    return { reply, intent: 'faq', sources, settings };
  }

  const pb = await matchPlaybook(text);
  if (pb?.template) {
    sources.push({ type: 'playbook', id: pb.id, title: pb.intent ?? null, intent: pb.intent ?? null });
    const reply = renderTemplate(String(pb.template), { state, settings, playbook: pb });
    return { reply, intent: String(pb.intent ?? 'playbook'), sources, settings };
  }

  return {
    reply: 'No match (policy/faq/playbook). Tip: agregá triggers o probá con una frase más parecida a lo que escribe el cliente.',
    intent: 'none',
    sources,
    settings
  };
}
