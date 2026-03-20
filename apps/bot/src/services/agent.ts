import { askGPTJson } from './gpt.js';
import type { CatalogItem } from './catalog.js';

export type AgentAction =
  | 'ASK_CLARIFY'
  | 'SHOW_RESULTS'
  | 'SHOW_ONE'
  | 'OFFER_FINANCING'
  | 'OFFER_TRADEIN'
  | 'CREATE_DEMAND'
  | 'ESCALATE_HUMAN'
  | 'FOLLOWUP'
  | 'FAQ'
  | 'SMALLTALK';

export type AgentDecision = {
  intent: string;
  confidence: number;
  action: AgentAction;
  extracted: {
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    minYear?: number | null;
    maxYear?: number | null;
    maxPrice?: number | null;
    currency?: 'ARS' | 'USD' | string | null;
    transmission?: string | null;
    fuel?: string | null;
    bodywork?: string | null;
    cuotas?: number | null;
    percent?: number | null;
    hasTradeIn?: boolean | null;
  };
  missingFields: string[];
  vehicleIds: string[];
  leadScore?: number;
  urgency: 'low' | 'medium' | 'high';
  handoffRecommended: boolean;
  suggestedReply: string;
  internalReason?: string;
};

type Params = {
  dealershipName?: string;
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  catalog: CatalogItem[];
  faqSummary?: string;
  extracted?: Record<string, any>;
  leadScore?: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeDecision(input: any, extracted: Record<string, any> = {}, leadScore?: number): AgentDecision | null {
  if (!input || typeof input !== 'object') return null;

  const action = String(input.action || 'ASK_CLARIFY').toUpperCase() as AgentAction;
  const ex = { ...(input.extracted || {}) };

  const out: AgentDecision = {
    intent: String(input.intent || 'unknown').trim() || 'unknown',
    confidence: clamp01(Number(input.confidence ?? 0.55)),
    action,
    extracted: {
      brand: ex.brand ?? extracted.brand ?? null,
      model: ex.model ?? extracted.model ?? null,
      year: toNumOrNull(ex.year ?? extracted.year),
      minYear: toNumOrNull(ex.minYear ?? extracted.minYear),
      maxYear: toNumOrNull(ex.maxYear ?? extracted.maxYear),
      maxPrice: toNumOrNull(ex.maxPrice ?? ex.amount ?? extracted.maxPrice ?? extracted.amount),
      currency: ex.currency ?? extracted.currency ?? null,
      transmission: ex.transmission ?? extracted.transmission ?? null,
      fuel: ex.fuel ?? extracted.fuel ?? null,
      bodywork: ex.bodywork ?? extracted.bodywork ?? null,
      cuotas: toNumOrNull(ex.cuotas ?? extracted.cuotas),
      percent: toNumOrNull(ex.percent ?? extracted.percent),
      hasTradeIn: typeof ex.hasTradeIn === 'boolean' ? ex.hasTradeIn : (typeof extracted.hasTradeIn === 'boolean' ? extracted.hasTradeIn : null)
    },
    missingFields: Array.isArray(input.missingFields) ? input.missingFields.map(String).filter(Boolean).slice(0, 8) : [],
    vehicleIds: Array.isArray(input.vehicleIds) ? input.vehicleIds.map(String).filter(Boolean).slice(0, 6) : [],
    leadScore: Number.isFinite(Number(input.leadScore)) ? Number(input.leadScore) : leadScore,
    urgency: ['low', 'medium', 'high'].includes(String(input.urgency)) ? String(input.urgency) as any : 'medium',
    handoffRecommended: Boolean(input.handoffRecommended),
    suggestedReply: String(input.suggestedReply || '').trim(),
    internalReason: String(input.internalReason || '').trim() || undefined
  };

  if (!out.suggestedReply) return null;
  return out;
}

function toNumOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compactCatalog(catalog: CatalogItem[]): string {
  return catalog.slice(0, 25).map((it) => {
    const price = Number.isFinite(Number(it.priceNumber))
      ? `${it.currency || 'ARS'} ${Number(it.priceNumber).toLocaleString('es-AR')}`
      : '';
    return [it.id, it.brand, it.model, it.year, it.name, price, it.transmission, it.fuel]
      .filter(Boolean)
      .join(' | ');
  }).join('\n');
}

function buildAgentSystemPrompt(dealershipName?: string) {
  const agency = dealershipName || 'la agencia';
  return [
    `Sos un agente comercial experto en venta de autos usados y 0km para ${agency}.`,
    'Objetivo: detectar intención comercial real, recopilar datos útiles, recomendar stock real disponible y mover la conversación hacia cotización, test drive, visita o derivación humana.',
    'Reglas:',
    '1. Respondé en español argentino.',
    '2. Soná humano, vendedor, claro y breve. Evitá frases robóticas como "decime qué necesitás" o "te paso opciones" si podés ser más concreto.',
    '3. No inventes precios, stock, cuotas, marcas, modelos ni versiones.',
    '4. Si el cliente marca presupuesto, priorizá estrictamente lo que entra en ese rango. Solo sugerí algo por arriba si aclarás que está apenas por encima.',
    '5. Si faltan datos, hacé una sola pregunta útil por vez.',
    '6. Si ves intención fuerte de compra, reserva, seña, visita, permuta o cierre, derivá a humano.',
    '7. Si el cliente menciona un usado para entregar, marcá trade-in y pedí o reutilizá año/km/estado.',
    '8. Devolvé SIEMPRE JSON válido.',
    '9. No incluyas markdown, explicación ni texto fuera del JSON.',
    'JSON esperado:',
    JSON.stringify({
      intent: 'stock_search',
      confidence: 0.84,
      action: 'SHOW_RESULTS',
      extracted: {
        brand: null,
        model: null,
        year: null,
        minYear: null,
        maxYear: null,
        maxPrice: null,
        currency: null,
        transmission: null,
        fuel: null,
        bodywork: null,
        cuotas: null,
        percent: null,
        hasTradeIn: null
      },
      missingFields: [],
      vehicleIds: [],
      urgency: 'medium',
      handoffRecommended: false,
      suggestedReply: 'string',
      internalReason: 'string breve'
    })
  ].join('\n');
}

export async function decideAgentAction(params: Params): Promise<AgentDecision | null> {
  const context = [
    'CATALOGO DISPONIBLE:',
    compactCatalog(params.catalog),
    params.faqSummary ? `\nFAQS/REGLAS:\n${params.faqSummary}` : '',
    params.extracted ? `\nDATOS YA DETECTADOS:\n${JSON.stringify(params.extracted)}` : '',
    Number.isFinite(Number(params.leadScore)) ? `\nLEAD_SCORE_ACTUAL: ${Number(params.leadScore)}` : ''
  ].join('\n');

  const raw = await askGPTJson<any>({
    systemPrompt: buildAgentSystemPrompt(params.dealershipName),
    userMessage: params.userMessage,
    history: params.history,
    context,
    maxTokens: 700,
    temperature: 0.25
  });

  return normalizeDecision(raw, params.extracted, params.leadScore);
}
