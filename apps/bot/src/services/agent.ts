/**
 * agent.ts — Motor de decisión estructurado con GPT.
 *
 * Mejoras v3:
 *  - buildAgentSystemPrompt: prompt mejorado que:
 *      · No repite preguntas de presupuesto ya respondidas
 *      · Confirma datos extraídos en la misma respuesta
 *      · Detecta señales de cierre y deriva a humano
 *      · Orienta hacia visita / financiación / seña
 *  - buildClosingSystemPrompt: variante avanzada para etapa de cierre
 *    (se activa cuando leadScore >= 60 o hay señal de compra)
 *  - selectModel: elige modelo GPT según leadScore
 *      · score < 40  → gpt-4o-mini (exploración)
 *      · score >= 40 → OPENAI_MODEL_ADVANCED o gpt-4o-mini
 *      · score >= 60 → modelo avanzado + closing prompt
 */

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
    const km = typeof it.km === 'number' && Number.isFinite(it.km)
      ? `${Math.round(it.km).toLocaleString('es-AR')} km`
      : null;
    const hasImage = it.image ? '[foto]' : null;
    return [it.id, it.name, it.year, price, km, it.transmission, it.fuel, it.color, hasImage]
      .filter(Boolean)
      .join(' | ');
  }).join('\n');
}

/**
 * buildAgentSystemPrompt — v3:
 * Prompt mejorado para exploración e intermediación.
 * No repite preguntas de campos ya captados.
 * Confirma datos al inicio de cada respuesta cuando hay contexto.
 * Detecta señales de cierre.
 */
function buildAgentSystemPrompt(dealershipName?: string, extractedContext?: Record<string, any>) {
  const agency = dealershipName || 'la agencia';

  // Generar resumen de lo que ya se sabe para que GPT no repregunta
  const knownFields: string[] = [];
  const ctx = extractedContext ?? {};
  if (ctx.brand) knownFields.push(`marca: ${ctx.brand}`);
  if (ctx.model) knownFields.push(`modelo: ${ctx.model}`);
  if (ctx.maxPrice ?? ctx.amount) {
    const amt = ctx.maxPrice ?? ctx.amount;
    const cur = ctx.currency ?? 'ARS';
    knownFields.push(`presupuesto: ${cur} ${Number(amt).toLocaleString('es-AR')}`);
  }
  if (ctx.transmission) knownFields.push(`caja: ${ctx.transmission}`);
  if (ctx.fuel) knownFields.push(`combustible: ${ctx.fuel}`);
  if (ctx.bodywork) knownFields.push(`tipo: ${ctx.bodywork}`);
  if (ctx.useCase) knownFields.push(`uso: ${ctx.useCase}`);
  if (ctx.minYear ?? ctx.maxYear ?? ctx.year) {
    const yr = ctx.year ? String(ctx.year) : `${ctx.minYear ?? '?'}-${ctx.maxYear ?? '?'}`;
    knownFields.push(`año: ${yr}`);
  }

  const knownSection = knownFields.length
    ? `\nDATA YA CONOCIDA (NO VOLVER A PREGUNTAR ESTOS CAMPOS):\n${knownFields.map(f => `  • ${f}`).join('\n')}`
    : '';

  return [
    `Sos un agente comercial experto en venta de autos usados y 0km para ${agency}.`,
    'Objetivo: entender al cliente, recomendar stock real disponible y mover la conversación hacia cotización, test drive, visita o derivación humana.',
    '',
    'REGLAS:',
    '1. Respondé en español argentino, tono humano y comercial. Máximo 3-4 oraciones.',
    '2. No inventes precios, stock, cuotas ni versiones. Usá SOLO el catálogo provisto.',
    '3. Si el cliente indicó presupuesto, RESPETALO. Solo sugerí algo por arriba si aclarás que supera el límite.',
    '4. Si faltan datos, hacé UNA SOLA pregunta útil: primero marca/modelo, luego presupuesto, luego transmisión/uso.',
    '5. NUNCA repreguntés un campo que ya aparece en DATA YA CONOCIDA.',
    '6. Cuando tenés marca/modelo + presupuesto detectados, CONFIRMÁ los datos antes de mostrar opciones.',
    '   Ejemplo: "Entendido, entonces buscás un Corolla hasta ARS 30 M. Mirá estas opciones:"',
    '7. Mostrá 2-3 opciones concretas, no listados largos. Si no hay match exacto, explicá por qué la alternativa sirve.',
    '8. Detectá señales de cierre: "quiero comprarlo", "reservar", "seña", "cuándo puedo ir", "me lo llevo".',
    '   Si las detectás: action=ESCALATE_HUMAN, handoffRecommended=true, indicá los datos recopilados al asesor.',
    '9. Si hay permuta/canje, marcá hasTradeIn=true y pedí/usá año+km del auto a entregar.',
    '10. suggestedReply tiene que sonar a vendedor real: concreto, cálido, orientado a avanzar.',
    '11. Devolvé SIEMPRE JSON válido. Sin markdown ni texto fuera del JSON.',
    knownSection,
    '',
    'JSON esperado:',
    JSON.stringify({
      intent: 'stock_search',
      confidence: 0.84,
      action: 'SHOW_RESULTS',
      extracted: {
        brand: null, model: null, year: null, minYear: null, maxYear: null,
        maxPrice: null, currency: null, transmission: null, fuel: null,
        bodywork: null, cuotas: null, percent: null, hasTradeIn: null
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

/**
 * buildClosingSystemPrompt — v3:
 * Prompt avanzado para etapa de cierre (leadScore >= 60).
 * Enfoca en empatía, beneficios del vehículo elegido y CTA concreto.
 */
function buildClosingSystemPrompt(dealershipName?: string, extractedContext?: Record<string, any>) {
  const agency = dealershipName || 'la agencia';
  const ctx = extractedContext ?? {};

  const summary: string[] = [];
  if (ctx.brand && ctx.model) summary.push(`${ctx.brand} ${ctx.model}`);
  else if (ctx.brand) summary.push(ctx.brand);
  if (ctx.maxPrice ?? ctx.amount) {
    summary.push(`presupuesto ${(ctx.currency ?? 'ARS')} ${Number(ctx.maxPrice ?? ctx.amount).toLocaleString('es-AR')}`);
  }
  if (ctx.transmission) summary.push(`caja ${ctx.transmission}`);
  if (ctx.tradeIn) summary.push('tiene permuta');

  return [
    `Sos un asesor senior de ventas de ${agency}. El cliente está próximo a decidir.`,
    '',
    'CONTEXTO DEL CLIENTE:',
    summary.length ? summary.map(s => `  • ${s}`).join('\n') : '  (ver catálogo y mensajes previos)',
    '',
    'TU TAREA:',
    '1. Empezá reconociendo el interés del cliente de forma natural (sin "¡Excelente elección!" robótico).',
    '2. Destacá brevemente 1-2 beneficios concretos del vehículo elegido o la mejor alternativa.',
    '3. Reafirmá el presupuesto acordado y condiciones (permuta, financiación, ciudad) si los hay.',
    '4. Cerrá con UNA llamada a la acción concreta: proponer horario de visita, iniciar reserva, o conectar con asesor.',
    '5. Si hay dudas sobre datos clave, preguntá de forma amistosa ANTES de proponer la acción.',
    '6. Tono: humano, sin tecnicismos. Como vendedor que conoce al cliente.',
    '',
    'REGLAS:',
    '- action = ESCALATE_HUMAN cuando el cliente quiere ver el auto, dar seña o finalizar compra.',
    '- handoffRecommended = true en esos casos.',
    '- No inventes precios ni stock fuera del catálogo.',
    '- JSON válido, sin texto fuera del JSON.',
    '',
    'JSON esperado:',
    JSON.stringify({
      intent: 'closing',
      confidence: 0.92,
      action: 'ESCALATE_HUMAN',
      extracted: {
        brand: null, model: null, year: null, minYear: null, maxYear: null,
        maxPrice: null, currency: null, transmission: null, fuel: null,
        bodywork: null, cuotas: null, percent: null, hasTradeIn: null
      },
      missingFields: [],
      vehicleIds: [],
      urgency: 'high',
      handoffRecommended: true,
      suggestedReply: 'string',
      internalReason: 'string breve'
    })
  ].join('\n');
}

/**
 * selectModel — elige el modelo GPT según el leadScore.
 * - score < 40: gpt-4o-mini (rápido, económico)
 * - score >= 40: OPENAI_MODEL_ADVANCED o gpt-4o-mini como fallback
 */
function selectModel(leadScore?: number): string {
  const score = Number(leadScore ?? 0);
  if (score >= 40) {
    return process.env.OPENAI_MODEL_ADVANCED ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

export async function decideAgentAction(params: Params): Promise<AgentDecision | null> {
  const isClosingStage = Number(params.leadScore ?? 0) >= 60;
  const model = selectModel(params.leadScore);

  const systemPrompt = isClosingStage
    ? buildClosingSystemPrompt(params.dealershipName, params.extracted)
    : buildAgentSystemPrompt(params.dealershipName, params.extracted);

  const context = [
    'CATALOGO DISPONIBLE:',
    compactCatalog(params.catalog),
    params.faqSummary ? `\nFAQS/REGLAS:\n${params.faqSummary}` : '',
    params.extracted ? `\nDATOS YA DETECTADOS:\n${JSON.stringify(params.extracted)}` : '',
    Number.isFinite(Number(params.leadScore)) ? `\nLEAD_SCORE_ACTUAL: ${Number(params.leadScore)}` : ''
  ].join('\n');

  const raw = await askGPTJson<any>({
    systemPrompt,
    userMessage: params.userMessage,
    history: params.history,
    context,
    model,
    maxTokens: isClosingStage ? 600 : 700,
    temperature: isClosingStage ? 0.2 : 0.25
  });

  return normalizeDecision(raw, params.extracted, params.leadScore);
}
