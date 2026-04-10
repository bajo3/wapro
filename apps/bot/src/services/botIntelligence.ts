/**
 * botIntelligence.ts — Inteligencia comercial del bot automotriz.
 *
 * Arquitectura:
 *  1. extract()       → GPT extrae intención + entidades del mensaje
 *  2. decide()        → lógica de negocio decide qué hacer con eso
 *  3. respond()       → construye respuesta humana y comercial
 *
 * Reglas duras anti-invención:
 *  - Solo muestra autos que existen en el catálogo real
 *  - No inventa precio, cuotas, entrega mínima, ni disponibilidad
 *  - Si falta dato → pregunta
 *  - Si no hay match → lo dice y propone alternativa
 *  - Si la API de crédito falla → lo dice sin inventar cuotas
 */

import { getCatalog, searchCatalog, formatItemLine } from './catalog.js';
import { askGPT } from './gpt.js';
import { getCreditQuote, formatCreditPlans } from './creditService.js';
import { detectHotLead, notifyHotLead } from './hotLead.js';
import type { ConvState } from './state.js';
import type { CatalogItem } from './catalog.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface Extracted {
  intent:
    | 'search'          // busca autos
    | 'credit_quote'    // quiere cuotas / financiar
    | 'trade_in'        // tiene un usado para entregar
    | 'advisor'         // pide hablar con persona
    | 'visit'           // quiere ir a ver
    | 'specific'        // pregunta por un auto puntual (menciona ID o título exacto)
    | 'refine'          // refina búsqueda anterior
    | 'alternatives'    // pide alternativas
    | 'reset'           // cambia de idea / busca algo diferente
    | 'greeting'        // saludo inicial
    | 'farewell'        // chau / gracias
    | 'complaint'       // enojo / reclamo
    | 'unsure'          // indeciso, pide recomendación
    | 'other';
  brand?: string;
  model?: string;
  year?: number;
  maxPrice?: number;
  currency?: 'ARS' | 'USD';
  downPayment?: number;
  transmission?: 'manual' | 'automático';
  fuel?: string;
  bodywork?: string;        // suv, pickup, sedan, hatch, familiar, etc.
  useCase?: string;         // remis, familia, ciudad, ruta, trabajo, etc.
  isNew?: boolean;          // 0km vs usado
  gnc?: boolean;
  wantsVisit?: boolean;
  wantsAdvisor?: boolean;
  urgency?: 'low' | 'high';
  name?: string;            // si el cliente se presentó
}

export interface IntelligenceResult {
  reply: string;
  newState: Partial<ConvState>;
  isHot?: boolean;
}

// ── Extractor de intención (GPT) ───────────────────────────────────────────────

const EXTRACTION_PROMPT = `Sos un extractor de datos para un bot de ventas de autos.
Dado un mensaje de WhatsApp, devolvé SOLO un JSON con estos campos (omití los que no apliquen):
{
  "intent": "search|credit_quote|trade_in|advisor|visit|specific|refine|alternatives|reset|greeting|farewell|complaint|unsure|other",
  "brand": string,
  "model": string,
  "year": number,
  "maxPrice": number,
  "currency": "ARS"|"USD",
  "downPayment": number,
  "transmission": "manual"|"automático",
  "fuel": string,
  "bodywork": "suv"|"pickup"|"sedan"|"hatch"|"familiar"|"furgon"|"coupe",
  "useCase": string,
  "isNew": boolean,
  "gnc": boolean,
  "wantsVisit": boolean,
  "wantsAdvisor": boolean,
  "urgency": "low"|"high",
  "name": string
}

Reglas:
- Si el mensaje menciona "entrega" o "anticipo" seguido de un número → eso es downPayment
- Si menciona "cuotas", "financiar", "banco", "crédito" → intent = credit_quote
- Si menciona "quiero verlo", "puedo ir", "test drive" → wantsVisit = true
- Si menciona "asesor", "humano", "persona", "hablar con alguien" → wantsAdvisor = true
- Si dice "cambio", "tengo un usado", "lo entrego" → intent = trade_in
- Si cambia completamente de búsqueda → intent = reset
- Si dice "chau", "gracias", "lo pienso" → intent = farewell
- Si está enojado, reclama, insulta → intent = complaint
- Si es un saludo inicial sin dato → intent = greeting
- Si "no sé qué quiero", "qué me recomendás" → intent = unsure
- maxPrice: si dice "hasta X" o "con X" → eso es el tope
- Devolvé SOLO el JSON, sin texto extra`;

async function extractIntent(message: string, history: string[]): Promise<Extracted> {
  const historyContext = history.slice(-4).join('\n');
  const prompt = historyContext
    ? `Contexto previo:\n${historyContext}\n\nMensaje actual: "${message}"`
    : `Mensaje: "${message}"`;

  const raw = await askGPT({
    systemPrompt: EXTRACTION_PROMPT,
    userMessage: prompt,
    maxTokens: 300,
    temperature: 0,
    traceCaller: 'botIntelligence.extractIntent',
  });

  if (!raw) return { intent: 'other' };

  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return { intent: 'other' };
    return JSON.parse(json) as Extracted;
  } catch {
    return { intent: 'other' };
  }
}

// ── Filtro de catálogo ─────────────────────────────────────────────────────────

function filterCatalog(catalog: CatalogItem[], ctx: Extracted & { search_context?: ConvState['search_context'] }): CatalogItem[] {
  const sc = ctx.search_context ?? {};

  // Merge: lo explícito del mensaje tiene prioridad sobre contexto acumulado
  const brand        = ctx.brand        ?? sc.brand;
  const model        = ctx.model        ?? sc.model;
  const maxPrice     = ctx.maxPrice     ?? sc.maxPrice;
  const currency     = ctx.currency     ?? sc.currency;
  const transmission = ctx.transmission ?? sc.transmission;
  const fuel         = ctx.fuel         ?? sc.fuel;
  const bodywork     = ctx.bodywork     ?? sc.bodywork;
  const year         = ctx.year         ?? sc.year;
  const gnc          = ctx.gnc          ?? sc.gnc;

  let results = catalog.filter(item => {
    if (!item.inStock) return false;

    if (brand && item.brand) {
      if (!item.brand.toLowerCase().includes(brand.toLowerCase())) return false;
    }
    if (model && item.model) {
      if (!item.model.toLowerCase().includes(model.toLowerCase())) return false;
    }
    if (year && item.year) {
      if (Math.abs(item.year - year) > 2) return false;
    }
    if (maxPrice && item.priceNumber) {
      const itemCurrency = item.currency ?? 'ARS';
      if (itemCurrency === (currency ?? 'ARS') && item.priceNumber > maxPrice * 1.1) return false;
    }
    if (transmission && item.transmission) {
      if (!item.transmission.toLowerCase().includes(transmission.toLowerCase())) return false;
    }
    if (fuel && item.fuel) {
      if (!item.fuel.toLowerCase().includes(fuel.toLowerCase())) return false;
    }
    if (bodywork && item.bodywork) {
      if (!item.bodywork.toLowerCase().includes(bodywork.toLowerCase())) return false;
    }
    if (gnc && item.fuel) {
      if (!item.fuel.toLowerCase().includes('gnc')) return false;
    }

    return true;
  });

  // Si no hay match exacto, relajar filtros año/transmisión para dar alternativas
  if (results.length === 0 && (brand || model)) {
    results = catalog.filter(item => {
      if (!item.inStock) return false;
      if (brand && item.brand && !item.brand.toLowerCase().includes(brand.toLowerCase())) return false;
      if (model && item.model && !item.model.toLowerCase().includes(model.toLowerCase())) return false;
      return true;
    });
  }

  return results.slice(0, 4);
}

// ── Composer de respuesta ──────────────────────────────────────────────────────

const RESPONSE_SYSTEM = `Sos el asistente de ventas de una concesionaria de autos en Argentina.
Tu objetivo es ayudar al cliente a encontrar el auto que necesita y avanzar hacia la venta.

Tono: natural, directo, argentino, comercial. Ni robot ni chamuyo.
Respuestas cortas. Frases simples. Sin listas largas si no hace falta.
Cuando tenés match real → ir al punto. Cuando no → proponer salida.
Nunca inventar precio, stock, cuotas ni disponibilidad.
Nunca decir algo que no esté en el contexto de abajo.`;

async function composeResponse(action: string, data: Record<string, any>, history: string[]): Promise<string> {
  const historyCtx = history.slice(-6).join('\n');
  const userMessage = `Acción: ${action}\nDatos:\n${JSON.stringify(data, null, 2)}\n${historyCtx ? `\nHistorial reciente:\n${historyCtx}` : ''}`;

  const reply = await askGPT({
    systemPrompt: RESPONSE_SYSTEM,
    userMessage,
    maxTokens: 350,
    temperature: 0.6,
    traceCaller: 'botIntelligence.composeResponse',
  });

  return reply ?? 'Perdón, hubo un problema técnico. Probá de vuelta en un momento.';
}

// ── Engine principal ───────────────────────────────────────────────────────────

export async function processMessage(params: {
  instance: string;
  remoteJid: string;
  message: string;
  state: ConvState;
}): Promise<IntelligenceResult> {
  const { instance, remoteJid, message, state } = params;
  const history = buildHistory(state);

  // 1. Extraer intención
  const extracted = await extractIntent(message, history);

  // 2. Detectar lead caliente (antes de decidir, para no perder contexto)
  const hotResult = detectHotLead(message, state);
  if (hotResult.isHot) {
    notifyHotLead({ instance, remoteJid, state, lastMessage: message, signals: hotResult.signals })
      .catch(() => {});
  }

  // 3. Decidir y responder
  const result = await decide(extracted, state, message, history);

  // 4. Actualizar estado
  const newState: Partial<ConvState> = {
    ...state,
    last_intent: extracted.intent,
    last_user_at: new Date().toISOString(),
    user_msg_count: (state.user_msg_count ?? 0) + 1,
    leadScore: Math.min(100, (state.leadScore ?? 0) + hotResult.score),
  };

  // Acumular contexto de búsqueda (resetear si el cliente cambia de idea)
  if (extracted.intent === 'reset') {
    newState.search_context = {};
    newState.last_hits = [];
    newState.last_query = message;
  } else if (['search', 'refine', 'unsure'].includes(extracted.intent)) {
    newState.search_context = mergeSearchContext(state.search_context, extracted);
    newState.last_query = message;
  }

  if (result.hitIds?.length) {
    newState.last_hits = result.hitIds;
    newState.last_hits_at = new Date().toISOString();
  }

  if (result.presentedVehicle) {
    newState.lastPresentedVehicleId    = result.presentedVehicle.id;
    newState.lastPresentedVehicleTitle = result.presentedVehicle.name;
    newState.lastPresentedVehiclePriceArs = result.presentedVehicle.priceNumber;
    newState.lastPresentedVehicleBrand = result.presentedVehicle.brand;
    newState.lastPresentedVehicleModel = result.presentedVehicle.model;
    newState.lastPresentedAt = new Date().toISOString();
  }

  newState.last_bot_reply_at = new Date().toISOString();
  newState.lastBotAt = newState.last_bot_reply_at;

  return {
    reply: result.reply,
    newState: newState as ConvState,
    isHot: hotResult.isHot,
  };
}

// ── Decision engine ────────────────────────────────────────────────────────────

interface DecideResult {
  reply: string;
  hitIds?: string[];
  presentedVehicle?: CatalogItem;
}

async function decide(
  ex: Extracted,
  state: ConvState,
  rawMessage: string,
  history: string[]
): Promise<DecideResult> {

  // Derivar a humano inmediatamente
  if (ex.intent === 'advisor' || ex.wantsAdvisor) {
    const reply = await composeResponse('derivar_humano', { mensaje: rawMessage }, history);
    return { reply };
  }

  // Reclamo → empatía + derivación, sin intentar resolver
  if (ex.intent === 'complaint') {
    const reply = await composeResponse('reclamo', { mensaje: rawMessage }, history);
    return { reply };
  }

  // Despedida
  if (ex.intent === 'farewell') {
    const reply = await composeResponse('despedida', { mensaje: rawMessage }, history);
    return { reply };
  }

  // Saludo inicial
  if (ex.intent === 'greeting' && !state.last_intent) {
    const reply = await composeResponse('saludo_inicial', {}, history);
    return { reply };
  }

  // Permuta
  if (ex.intent === 'trade_in') {
    const reply = await composeResponse('permuta', {
      mensaje: rawMessage,
      nota: 'Pedir modelo, año y km del usado. No dar valuación. Ofrecer que lo evalúa un asesor.'
    }, history);
    return { reply };
  }

  // Visita
  if (ex.intent === 'visit' || ex.wantsVisit) {
    const auto = state.lastPresentedVehicleTitle ?? state.last_query ?? 'el auto';
    const reply = await composeResponse('coordinar_visita', {
      auto,
      nota: 'Confirmar el auto y coordinar con asesor. No dar horarios específicos si no los tenés.'
    }, history);
    return { reply };
  }

  // Crédito / cuotas
  if (ex.intent === 'credit_quote' || ex.downPayment) {
    return await handleCredit(ex, state, rawMessage, history);
  }

  // Indeciso / pide recomendación
  if (ex.intent === 'unsure') {
    // Si ya hay contexto de búsqueda, mostrar opciones
    const sc = state.search_context;
    if (sc && (sc.brand || sc.maxPrice || sc.bodywork || sc.useCase)) {
      return await handleSearch(ex, state, history);
    }
    // Si no hay contexto, hacer UNA pregunta concreta
    const reply = await composeResponse('indeciso_sin_contexto', {
      nota: 'Hacer UNA sola pregunta: uso + presupuesto. Conciso.'
    }, history);
    return { reply };
  }

  // Búsqueda / refinamiento / reset
  if (['search', 'refine', 'reset', 'specific', 'alternatives'].includes(ex.intent)) {
    return await handleSearch(ex, state, history);
  }

  // Fallback: dejar que GPT maneje con contexto completo
  const catalog = await getCatalog();
  const topItems = filterCatalog(catalog, { ...ex, search_context: state.search_context });
  const catalogCtx = topItems.length
    ? topItems.map((v, i) => formatItemLine(v, i)).join('\n')
    : 'Sin vehículos disponibles para ese criterio.';

  const reply = await composeResponse('consulta_general', {
    mensaje: rawMessage,
    catalogo: catalogCtx,
    estado: summarizeState(state),
  }, history);
  return { reply };
}

// ── Handler: búsqueda ──────────────────────────────────────────────────────────

async function handleSearch(ex: Extracted, state: ConvState, history: string[]): Promise<DecideResult> {
  const catalog = await getCatalog();
  const hits = filterCatalog(catalog, { ...ex, search_context: state.search_context });

  if (hits.length === 0) {
    // Sin match — buscar alternativas más amplias
    const alternatives = catalog.filter(i => i.inStock).slice(0, 3);
    const altLines = alternatives.map((v, i) => formatItemLine(v, i)).join('\n');
    const reply = await composeResponse('sin_match', {
      busqueda: ex,
      alternativas: altLines || 'No hay stock disponible en este momento.',
      nota: 'Decir que no hay match exacto. Ofrecer alternativas sin mentir sobre disponibilidad.',
    }, history);
    return { reply };
  }

  const hitLines = hits.map((v, i) => formatItemLine(v, i)).join('\n');
  const reply = await composeResponse('mostrar_resultados', {
    resultados: hitLines,
    cantidad: hits.length,
    nota: hits.length === 1
      ? 'Hay un solo match. Presentarlo bien. Cerrar preguntando si quiere cuotas o verlo.'
      : 'Mostrar opciones concretas. Cerrar preguntando cuál le interesa más.',
  }, history);

  return {
    reply,
    hitIds: hits.map(h => h.id),
    presentedVehicle: hits[0],
  };
}

// ── Handler: crédito ───────────────────────────────────────────────────────────

async function handleCredit(ex: Extracted, state: ConvState, rawMessage: string, history: string[]): Promise<DecideResult> {
  const vehicle = state.lastPresentedVehicleTitle
    ? { title: state.lastPresentedVehicleTitle, price: state.lastPresentedVehiclePriceArs, year: Number(state.lastPresentedAt?.slice(0,4)) || new Date().getFullYear() }
    : null;

  // Si no tenemos auto ni precio → preguntar
  if (!vehicle?.price && !ex.maxPrice) {
    const reply = await composeResponse('credit_sin_auto', {
      nota: 'Preguntar sobre qué auto están calculando las cuotas, o pedir precio del auto.',
    }, history);
    return { reply };
  }

  const vehiclePrice = vehicle?.price ?? ex.maxPrice!;
  const downPayment = ex.downPayment ?? state.finance?.downPayment;

  // Si no tenemos entrega → preguntar
  if (!downPayment) {
    const reply = await composeResponse('credit_sin_entrega', {
      auto: vehicle?.title ?? 'el auto seleccionado',
      precio: `$${Math.round(vehiclePrice).toLocaleString('es-AR')}`,
      nota: 'Preguntar cuánto puede poner de entrega. Solo eso.',
    }, history);
    return { reply };
  }

  // Intentamos cotizar
  const vehicleYear = vehicle?.year
    ? (typeof vehicle.year === 'number' ? vehicle.year : new Date().getFullYear())
    : new Date().getFullYear();

  const creditResult = await getCreditQuote({ vehiclePrice, downPayment, vehicleYear });

  if (!creditResult.ok) {
    if (creditResult.reason === 'exceeds_50pct') {
      const reply = await composeResponse('credit_supera_tope', {
        nota: creditResult.detail,
        sugerencias: 'Mayor entrega, otro vehículo, o hablar con asesor.',
        auto: vehicle?.title ?? rawMessage,
      }, history);
      return { reply };
    }
    if (creditResult.reason === 'invalid_input') {
      const reply = await composeResponse('credit_dato_invalido', { detalle: creditResult.detail }, history);
      return { reply };
    }
    // api_error
    const reply = await composeResponse('credit_api_error', {
      nota: 'No se pudo consultar la API de crédito. Sugerir hablar con asesor para cotización real.',
    }, history);
    return { reply };
  }

  const cuotasTexto = formatCreditPlans(creditResult.plans, creditResult.montoFinanciado);
  const reply = await composeResponse('mostrar_cuotas', {
    cuotas: cuotasTexto,
    auto: vehicle?.title ?? 'el vehículo',
    entrega: `$${Math.round(downPayment).toLocaleString('es-AR')}`,
    nota: 'Mostrar cuotas reales. Aclarar que son estimadas y que el asesor confirma. Preguntar si quiere avanzar.',
  }, history);
  return { reply };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildHistory(state: ConvState): string[] {
  const lines: string[] = [];
  if (state.last_query)   lines.push(`Cliente buscó: ${state.last_query}`);
  if (state.last_intent)  lines.push(`Última intención: ${state.last_intent}`);
  if (state.lastPresentedVehicleTitle)
    lines.push(`Último auto mostrado: ${state.lastPresentedVehicleTitle}`);
  return lines;
}

function summarizeState(state: ConvState): string {
  const parts: string[] = [];
  if (state.last_query) parts.push(`búsqueda: ${state.last_query}`);
  if (state.lastPresentedVehicleTitle) parts.push(`auto visto: ${state.lastPresentedVehicleTitle}`);
  if (state.leadScore) parts.push(`score: ${state.leadScore}`);
  return parts.join(' | ') || 'sin contexto previo';
}

function mergeSearchContext(
  existing: ConvState['search_context'],
  ex: Extracted
): ConvState['search_context'] {
  return {
    ...existing,
    ...(ex.brand        ? { brand: ex.brand }               : {}),
    ...(ex.model        ? { model: ex.model }               : {}),
    ...(ex.year         ? { year: ex.year }                 : {}),
    ...(ex.maxPrice     ? { maxPrice: ex.maxPrice }         : {}),
    ...(ex.currency     ? { currency: ex.currency }         : {}),
    ...(ex.transmission ? { transmission: ex.transmission } : {}),
    ...(ex.fuel         ? { fuel: ex.fuel }                 : {}),
    ...(ex.bodywork     ? { bodywork: ex.bodywork }         : {}),
    ...(ex.gnc !== undefined ? { gnc: ex.gnc }              : {}),
    ...(ex.useCase      ? { useCase: ex.useCase }           : {}),
    ...(ex.name         ? { name: ex.name }                 : {}),
  };
}
