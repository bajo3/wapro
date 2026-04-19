/**
 * botIntelligence.ts — Inteligencia comercial del bot automotriz.
 *
 * Arquitectura:
 *  1. extractIntent() → GPT extrae intención + entidades del mensaje (con contexto de autos mostrados)
 *  2. decide()        → lógica de negocio decide qué hacer
 *  3. composeResponse() → GPT escribe una respuesta humana y comercial
 *
 * Reglas duras anti-invención:
 *  - Solo muestra autos que existen en el catálogo real
 *  - No inventa precio, cuotas, entrega mínima, ni disponibilidad
 *  - Si falta dato → pregunta
 *  - Si no hay match → lo dice y propone alternativa
 *  - Si la API de crédito falla → lo dice sin inventar cuotas
 *  - No manda links de MercadoLibre como respuesta principal
 */

import { getCatalog, formatItemLine, priceToArs } from './catalog.js';
import { getUsdToArs } from './exchangeRate.js';
import { askGPT } from './gpt.js';
import { getCreditQuote, formatCreditPlans } from './creditService.js';
import { detectHotLead, notifyHotLead, notifyAdvisorHandoff } from './hotLead.js';
import type { ConvState } from './state.js';
import type { CatalogItem } from './catalog.js';
import { routeDecision } from './runtimeRouter.js';
import { logPipelineEvent } from './pipelineLogger.js';
import { selectExamples } from './exampleSelector.js';
import { runTruthGuardWorker } from './workers/truthGuardWorker.js';
import { detectObjection, incrementObjectionCount } from './workers/objectionWorker.js';
import { getSkillHint } from './skills/index.js';
import type { RouterAction } from './runtimeRouter.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface Extracted {
  intent:
    | 'search'          // busca autos con filtros específicos
    | 'catalog'         // quiere ver el catálogo completo / todas las opciones
    | 'credit_quote'    // quiere cuotas / financiar
    | 'trade_in'        // tiene un usado para entregar
    | 'advisor'         // pide hablar con persona
    | 'visit'           // quiere ir a ver
    | 'specific'        // pregunta por un auto puntual (menciona nombre, índice o referencia)
    | 'refine'          // refina búsqueda anterior
    | 'alternatives'    // pide alternativas
    | 'reset'           // cambia de idea / busca algo diferente
    | 'greeting'        // saludo
    | 'farewell'        // chau / gracias
    | 'complaint'       // enojo / reclamo
    | 'unsure'          // indeciso, pide recomendación
    | 'other';
  brand?: string;
  model?: string;
  year?: number;
  /** Año mínimo cuando el cliente pide un rango: "del 2014 al 2018" → yearMin=2014 */
  yearMin?: number;
  /** Año máximo cuando el cliente pide un rango: "del 2014 al 2018" → yearMax=2018 */
  yearMax?: number;
  maxPrice?: number;
  currency?: 'ARS' | 'USD';
  downPayment?: number;
  transmission?: 'manual' | 'automático';
  fuel?: string;
  bodywork?: string;        // suv, pickup, sedan, hatch, familiar, furgon, coupe
  useCase?: string;         // remis, familia, ciudad, ruta, trabajo, etc.
  isNew?: boolean;          // 0km vs usado
  gnc?: boolean;
  /** true cuando el cliente prioriza economía de combustible: "gaste poco", "ahorrador", "económico" */
  fuelEconomyPriority?: boolean;
  wantsVisit?: boolean;
  wantsAdvisor?: boolean;
  urgency?: 'low' | 'high';
  name?: string;            // si el cliente se presentó
  /**
   * ID del auto seleccionado cuando el cliente hace referencia a uno de los
   * mostrados en el turno anterior (ej: "el 207", "el primero", "esa blanca").
   * GPT lo resuelve usando el contexto de opciones_mostradas en el historial.
   */
  selectedVehicleId?: string;

  /**
   * Modo del lead en este turno — ayuda a decidir la acción correcta.
   * decided      → ya sabe qué quiere, filtros suficientes para buscar
   * exploratory  → anda viendo, sin filtros claros, no hay que presionar
   * hot          → urgencia alta, señales de cierre o visita inminente
   * price_sensitive → el precio es la objeción principal
   * lost         → contexto muy vago, respuesta confusa, necesita reorientación
   */
  leadMode?: 'decided' | 'exploratory' | 'hot' | 'price_sensitive' | 'lost';

  /**
   * true si el mensaje es ambiguo y el bot necesita pedir UN dato más antes de mostrar opciones.
   * El bot nunca debe pedir más de 1 campo por turno cuando esto es true.
   */
  needsClarification?: boolean;

  /**
   * Confianza del extractor en la intención detectada.
   * high   → mensaje claro, intención inequívoca
   * medium → hay señales pero algún campo clave falta
   * low    → mensaje vago, múltiple interpretación posible
   */
  confidence?: 'high' | 'medium' | 'low';
}

export interface IntelligenceResult {
  reply: string;
  newState: Partial<ConvState>;
  isHot?: boolean;
  /** URLs de fotos a enviar después del mensaje de texto (máx 5) */
  imagesToSend?: string[];
}

// ── Extractor de intención (GPT) ───────────────────────────────────────────────

const EXTRACTION_PROMPT = `Extractor para un bot de ventas de autos en Argentina. Devolvé SOLO JSON (omití campos que no apliquen).

Schema:
{ "intent":"search|catalog|credit_quote|trade_in|advisor|visit|specific|refine|alternatives|reset|greeting|farewell|complaint|unsure|other",
  "brand","model","year","yearMin","yearMax","maxPrice","currency":"ARS|USD","downPayment",
  "transmission":"manual|automático","fuel","bodywork":"suv|pickup|sedan|hatch|familiar|furgon|coupe|monovolumen",
  "useCase","isNew","gnc","fuelEconomyPriority","wantsVisit","wantsAdvisor","urgency":"low|high","name",
  "selectedVehicleId",
  "leadMode":"decided|exploratory|hot|price_sensitive|lost",
  "needsClarification","confidence":"high|medium|low" }

INTENT (elegí UNO, prioridad de arriba hacia abajo):
- greeting: hola/buenas/qué tal (siempre, aunque haya historial)
- farewell: chau/gracias/lo pienso
- complaint: reclamo/enojo/insulto
- advisor (+wantsAdvisor=true): "asesor","humano","persona","hablar con alguien"
- visit (+wantsVisit=true): "quiero verlo","puedo ir","test drive"
- trade_in: "cambio","tengo un usado","parte de pago","lo entrego"
- credit_quote: "cuotas","financiar","banco","crédito","anticipo","con cuánto entro","cuánto de entrega","entrega?","y cuotas?","sin entrada". "mínimo"/"lo más chico"/"la menor" SI el contexto previo muestra conversación de financiación o auto activo.
- catalog: pide ver catálogo/todas las opciones/qué tienen (SIN filtro específico)
- reset: cambia totalmente de búsqueda
- specific: cliente referencia un auto del listado previo (opciones_mostradas) por número/ordinal/color/modelo → resolvé selectedVehicleId
- refine: refina la búsqueda anterior
- alternatives: pide alternativas
- search: hay filtros nuevos (marca/modelo/bodywork/presupuesto)
- unsure: "no sé","qué me recomendás","qué me conviene"
- other: nada de lo anterior

CAMPOS:
- maxPrice: "hasta X"/"con X"/"por X" → tope. Millones sin moneda explícita = ARS.
- downPayment: número tras "entrega"/"anticipo".
- year vs rango: "del 2014 al 2018" → yearMin=2014 yearMax=2018 (NO year). "desde 2016" → yearMin. "hasta 2020" → yearMax. Año suelto → year.
- bodywork aliases:
  camioneta/pick up/doble cabina → pickup
  furgón/utilitario/cargo → furgon
  auto chico/compacto/pequeño/para ciudad/fácil de estacionar → hatch + fuelEconomyPriority=true
  crossover/4x4/todoterreno → suv
  familiar → familiar; minivan/van → monovolumen
- fuelEconomyPriority=true: "gaste poco","bajo consumo","ahorrador","económico","poco consumo"

leadMode:
- decided: marca/modelo/presupuesto claros
- exploratory: "ando viendo","algo para familia","no sé bien todavía"
- hot: urgencia/cierre ("lo quiero esta semana","tengo el dinero","ya hablé con el banco")
- price_sensitive: "caro","no llego","más barato","poco presupuesto"
- lost: incomprensible

needsClarification=true si no hay ningún filtro usable (marca/modelo/presupuesto/tipo/uso) y no hay contexto previo accionable. Cuando es true el bot hace UNA sola pregunta.
confidence: high=claro, medium=falta un campo clave, low=vago/múltiple interpretación.

CONTEXTO ACTIVO (vehículo o listado previo) + mensaje corto/vago ("mínimo","y cuotas?","entrega?","ese","el mismo") → NO uses catalog/reset/search. Mantené credit_quote o specific según corresponda. Nunca reinicies contexto por ambigüedad.

POST NO-MATCH: si el turno previo fue sin-match y el cliente pivota con presupuesto nuevo o "algo parecido/más barato/accesible"/"uno hasta X" → intent=search, NO heredes brand/model previos, usá maxPrice como filtro principal.

Devolvé SOLO el JSON.`;

export async function extractIntent(message: string, historyLines: string[]): Promise<Extracted> {
  const historyContext = historyLines.slice(-6).join('\n');
  const prompt = historyContext
    ? `Contexto previo:\n${historyContext}\n\nMensaje actual: "${message}"`
    : `Mensaje: "${message}"`;

  const raw = await askGPT({
    systemPrompt: EXTRACTION_PROMPT,
    userMessage: prompt,
    maxTokens: 260,
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

// ── Inferencia rápida de carrocería (sin DB) ─────────────────────────────────
// Complementa inferBodyworkFromRow() de catalog.ts para ítems que no tuvieron
// bodywork inferido en carga (ej: "Toyota Corolla" sin keyword "sedan" en el nombre).
// Solo se usa en filterCatalog() para no rechazar ítems válidos por bodywork=undefined.

const _PICKUP_TOKENS = ['ranger', 'hilux', 'amarok', 'l200', 'frontier', 's10', 'strada', 'oroch', 'toro', 'poler', 'navara', 'triton', 'alaskan', 'd-max'];
const _SUV_TOKENS    = ['rav4', 'rav-4', 'tiguan', 'cr-v', 'hrv', 'hr-v', 'tucson', 'sportage', 'ecosport', 'duster', 'kicks', 'compass', 'renegade', 'captur', 'stepway', '3008', '5008', 'cx-5', 'cx5', 'cx-30', 'cx30', 'qashqai', 'x-trail', 'trailblazer', 'land cruiser'];
const _LARGE_TOKENS  = ['motorhome', 'motor home', 'camper', 'minibus', 'microbus', 'sprinter', 'ducato', 'iveco daily'];
// Carrocerías "grandes/pesadas" excluidas por fuelEconomyPriority
const _LARGE_BODY_TYPES = new Set(['pickup', 'furgon', 'monovolumen', 'motorhome', 'camion']);
// Para estas carrocerías un ítem SIN bodywork inferido se descarta (no puede ser pickup sin indicio)
const _STRICT_BODY_TYPES = new Set(['pickup', 'furgon', 'suv', 'motorhome']);

function quickInferBodywork(item: CatalogItem): string | undefined {
  if (item.bodywork) return item.bodywork.toLowerCase();
  const txt = `${item.name} ${item.brand ?? ''} ${item.model ?? ''} ${item.version ?? ''}`
    .toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (_PICKUP_TOKENS.some(t => txt.includes(t))) return 'pickup';
  if (/\b(pick\s*up|doble\s*cabina|camioneta)\b/.test(txt)) return 'pickup';
  if (_SUV_TOKENS.some(t => txt.includes(t))) return 'suv';
  if (/\b(suv|crossover|4x4|todoterreno)\b/.test(txt)) return 'suv';
  if (_LARGE_TOKENS.some(t => txt.includes(t))) return 'motorhome';
  if (/\b(furgon|utilitario|cargo)\b/.test(txt)) return 'furgon';
  if (/\b(monovolumen|minivan|mpv)\b/.test(txt)) return 'monovolumen';
  if (/\b(sedan|4\s*puertas?)\b/.test(txt)) return 'sedan';
  if (/\b(hatch|hatchback|3\s*puertas?)\b/.test(txt)) return 'hatch';
  if (/\b(familiar|estate|sw|kombi)\b/.test(txt)) return 'familiar';
  return undefined;
}

// ── Filtro de catálogo ─────────────────────────────────────────────────────────

export function filterCatalog(
  catalog: CatalogItem[],
  ctx: Extracted & { search_context?: ConvState['search_context'] }
): CatalogItem[] {
  const sc = ctx.search_context ?? {};

  const brand        = ctx.brand        ?? sc.brand;
  const model        = ctx.model        ?? sc.model;
  const maxPrice     = ctx.maxPrice     ?? sc.maxPrice;
  const currency     = ctx.currency     ?? sc.currency;
  const transmission = ctx.transmission ?? sc.transmission;
  const fuel         = ctx.fuel         ?? sc.fuel;
  const bodywork     = (ctx.bodywork    ?? sc.bodywork)?.toLowerCase();
  const gnc          = ctx.gnc          ?? sc.gnc;
  const fuelEconomyPriority = ctx.fuelEconomyPriority ?? (sc as any).fuelEconomyPriority;

  // Rango de año: priorizar yearMin/yearMax explícitos; fallback a año único ±2
  const yearMin  = ctx.yearMin  ?? sc.minYear;
  const yearMax  = ctx.yearMax  ?? sc.maxYear;
  const yearPoint = ctx.year   ?? sc.year;
  const hasYearRange = !!(yearMin || yearMax);

  console.info(`[filter] extractedConstraints=${JSON.stringify({ brand, model, bodywork, yearMin, yearMax, yearPoint, maxPrice, currency, transmission, fuel, gnc, fuelEconomyPriority })}`);

  const totalBefore = catalog.filter(i => i.inStock).length;

  let results = catalog.filter(item => {
    if (!item.inStock) return false;

    if (brand && item.brand) {
      if (!item.brand.toLowerCase().includes(brand.toLowerCase())) return false;
    }
    if (model && item.model) {
      if (!item.model.toLowerCase().includes(model.toLowerCase())) return false;
    }

    // Rango de año: hard constraints (sin tolerancia cuando se especificó rango)
    if (item.year) {
      if (yearMin && item.year < yearMin) return false;
      if (yearMax && item.year > yearMax) return false;
      // Año único solo con tolerancia ±2 cuando NO hay rango explícito
      if (yearPoint && !hasYearRange && Math.abs(item.year - yearPoint) > 2) return false;
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
    if (gnc && item.fuel) {
      if (!item.fuel.toLowerCase().includes('gnc')) return false;
    }

    // Carrocería: filtro duro para tipos específicos; soft para compactos/genéricos sin brand/model.
    // Si el usuario dijo "auto chico" / "económico" / "para la familia" sin marca/modelo,
    // el bodywork extraído (hatch/sedan/familiar) es una señal de preferencia, no un filtro estricto.
    // fuelEconomyPriority ya excluye pickups/furgones más abajo.
    if (bodywork) {
      const softBodywork = !brand && !model && !_STRICT_BODY_TYPES.has(bodywork);
      if (!softBodywork) {
        const effectiveBw = quickInferBodywork(item);
        if (effectiveBw) {
          if (!effectiveBw.includes(bodywork)) return false;
        } else {
          if (_STRICT_BODY_TYPES.has(bodywork)) return false;
        }
      }
    }

    // Exclusión dura por economía: "gaste poco" / "auto chico" → fuera pickup, furgon, etc.
    if (fuelEconomyPriority) {
      const effectiveBw = quickInferBodywork(item);
      if (effectiveBw && _LARGE_BODY_TYPES.has(effectiveBw)) return false;
      // Sin bodywork detectable y sin filtro de tipo específico: dejar pasar (puede ser compacto genérico)
    }

    return true;
  });

  const countAfterHard = results.length;
  console.info(`[filter] hardFiltersApplied=true filteredCountBeforeRanking=${totalBefore} filteredCountAfterHard=${countAfterHard}`);

  // Fallback blando: relajar año/transmisión SOLO si hay brand/model específico
  // NUNCA relajar bodywork — el tipo de vehículo es constraint dura siempre
  if (results.length === 0 && (brand || model)) {
    results = catalog.filter(item => {
      if (!item.inStock) return false;
      if (brand && item.brand && !item.brand.toLowerCase().includes(brand.toLowerCase())) return false;
      if (model && item.model && !item.model.toLowerCase().includes(model.toLowerCase())) return false;
      // Mantener bodywork como constraint dura incluso en fallback
      if (bodywork) {
        const effectiveBw = quickInferBodywork(item);
        if (effectiveBw && !effectiveBw.includes(bodywork)) return false;
        if (!effectiveBw && _STRICT_BODY_TYPES.has(bodywork)) return false;
      }
      // Mantener exclusión por economía en fallback
      if (fuelEconomyPriority) {
        const effectiveBw = quickInferBodywork(item);
        if (effectiveBw && _LARGE_BODY_TYPES.has(effectiveBw)) return false;
      }
      return true;
    });
    console.info(`[filter] fallbackReason=relaxed_year_transmission fallback_count=${results.length}`);
  } else if (results.length === 0) {
    console.info(`[filter] fallbackReason=no_match_no_soft_fallback`);
  }

  const finalCount = Math.min(results.length, 12);
  console.info(`[filter] filteredCountAfterRanking=${finalCount} snapshotSaved=pending`);
  return results.slice(0, 12);
}

// ── Detección determinística de selección numérica/ordinal ───────────────────

/**
 * Detecta si el mensaje es una selección clara del catálogo mostrado.
 * Solo se invoca cuando hay un snapshot activo (last_hits_detail).
 * Retorna índice 1-based si hay match, null si no.
 *
 * Cubre: "1", "la 1", "el 2", "opcion 3", "la primera", "me interesa la 2"
 * NO cubre: "busco un auto de 3 puertas" (evita falsos positivos)
 */
export function detectCatalogSelection(message: string): number | null {
  const t = message.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  // 1. Número puro: "1", "2", " 10 "
  const pureNum = t.match(/^\s*([1-9][0-9]?)\s*$/);
  if (pureNum) return parseInt(pureNum[1], 10);

  // 2. Ordinales textuales
  const ordinals: Record<string, number> = {
    'primero': 1, 'primera': 1,
    'segundo': 2, 'segunda': 2,
    'tercero': 3, 'tercera': 3,
    'cuarto': 4, 'cuarta': 4,
    'quinto': 5, 'quinta': 5,
    'sexto': 6, 'sexta': 6,
    'septimo': 7, 'septima': 7,
    'octavo': 8, 'octava': 8,
    'noveno': 9, 'novena': 9,
    'decimo': 10, 'decima': 10,
  };
  for (const [word, num] of Object.entries(ordinals)) {
    if (t.includes(word)) return num;
  }

  // 3. Frases de selección explícita: "la 1", "el 2", "opcion 3", "me interesa la 2"
  const selMatch = t.match(
    /(?:la|el|los|opci[oa]n|numero|n[uú]mero|quiero\s+(?:la|el)|me\s+interesa(?:\s+(?:la|el))?|ese\s+(?:es\s+)?(?:el)?)\s+([1-9][0-9]?)\b/
  );
  if (selMatch) return parseInt(selMatch[1], 10);

  return null;
}

// ── Detección de follow-up de financiación (sin GPT) ─────────────────────────
// Mensajes cortos que son respuesta a una pregunta de entrega/cuotas.
// Solo se activa si hay un vehículo activo en contexto.
const FINANCE_FOLLOWUP_RE = /^(lo\s*m[ií]nimo|m[ií]nimo|la\s*menor|la\s*m[ií]nima?|con\s+cu[aá]nto\s+entro|cu[aá]nto\s+de\s+(entrega|anticipo|enganche)|entrega\??|anticipo\??|enganche\??|y\s+cuotas?\??|cuotas?\??|financiac[ií][oó]n\??|sin\s+entrada|lo\s+m[aá]s\s+chico|la\s+m[aá]s\s+baja?|lo\s+menos\s+posible|cu[aá]nto\s+m[ií]nimo)[\s?.!]*$/i;
const MINIMUM_PAYMENT_RE = /m[ií]nimo|menor|m[aá]s\s+chico|m[aá]s\s+baj[ao]|lo\s+menos|sin\s+entrada|lo\s+m[aá]s\s+chico/i;

export function detectFinancingFollowup(message: string): boolean {
  return FINANCE_FOLLOWUP_RE.test(message.trim());
}

// ── Detección rápida de reset/catálogo (sin GPT) ─────────────────────────────
// Frases que siempre reinician contexto, independientemente de lo que GPT clasifique.
const RESET_RE = /^(hola+(\s+(como\s+and[aá]s|como\s+est[aá]s|qu[eé]\s+tal|che|todo\s+bien|y\s+vos?))?|buen[ao]s?(\s*(d[ií]as?|tardes?|noches?))?(\s+(como\s+and[aá]s|todo\s+bien))?|arrancamos?\s*de\s*nuevo|empecemos?\s*de\s*nuevo|quiero\s*ver\s*otra\s*cosa|busco\s*otra\s*cosa|estoy\s*buscando\s*otra\s*cosa|cambio\s*de\s*b[uú]squeda|otra\s*cosa|busco\s*otra\s*opci[oó]n|quiero\s*buscar\s*otra\s*cosa)[\s!?.]*$/i;
const CATALOG_RE = /mostrame?\s*(el\s*)?cat[aá]logo|me\s*pod[eé]s?\s*mostrar\s*(el\s*)?cat[aá]logo|que\s*(autos?|veh[ií]culos?|opciones?)\s*(ten[eé]s?|hay|tienen?)|pasame?\s*(el\s*)?cat[aá]logo|quiero\s*ver\s*(las?\s*)?opciones?|qu[eé]\s*(tienen?|tenes?\s*disponible)/i;
const CATALOG_MORE_RE = /m[aá]s\s*opciones|mostrame?\s*m[aá]s|segu[ií]|que\s*m[aá]s\s*(ten[eé]s?|hay)|otros?\s*(autos?|veh[ií]culos?)|ver\s*m[aá]s|m[aá]s\s*autos?/i;

const CATALOG_PAGE_SIZE = 10;

export function detectResetOrCatalog(message: string): 'reset' | 'catalog' | 'catalog_more' | null {
  const m = message.trim();
  if (RESET_RE.test(m)) return 'reset';
  if (CATALOG_RE.test(m)) return 'catalog';
  if (CATALOG_MORE_RE.test(m)) return 'catalog_more';
  return null;
}

// ── Selección contextual determinística ───────────────────────────────────────

/**
 * Intenta resolver cuál auto eligió el cliente basándose en tokens del mensaje.
 * Esto es un backup determinístico para cuando GPT no resuelve selectedVehicleId.
 */
function resolveVehicleByText(
  text: string,
  hitsDetail: NonNullable<ConvState['last_hits_detail']>
): NonNullable<ConvState['last_hits_detail']>[number] | null {
  const t = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  // Por índice ordinal ("el 1", "el primero", "la primera", "opción 2", "el tercero")
  const ordinals: Record<string, number> = {
    'primer': 0, 'primero': 0, 'primera': 0, 'uno': 0,
    'segun': 1, 'segundo': 1, 'segunda': 1, 'dos': 1,
    'tercer': 2, 'tercero': 2, 'tercera': 2, 'tres': 2,
    'cuart': 3, 'cuarto': 3, 'cuarta': 3, 'cuatro': 3,
    'quint': 4, 'quinto': 4, 'quinta': 4, 'cinco': 4,
  };
  for (const [word, idx] of Object.entries(ordinals)) {
    if (t.includes(word) && hitsDetail[idx]) return hitsDetail[idx];
  }

  // Por número directo ("el 1", "opción 3")
  const numMatch = t.match(/\b([1-5])\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (hitsDetail[idx]) return hitsDetail[idx];
  }

  // Por modelo/marca mencioada en el mensaje
  const tokens = t.split(/\s+/).filter(tok => tok.length > 2);
  let bestMatch: NonNullable<ConvState['last_hits_detail']>[number] | null = null;
  let bestScore = 0;

  for (const hit of hitsDetail) {
    const nameTokens = (hit.name + ' ' + (hit.brand ?? '') + ' ' + (hit.model ?? ''))
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .split(/\s+/)
      .filter(tok => tok.length > 2);

    const score = tokens.filter(tok => nameTokens.some(n => n.includes(tok) || tok.includes(n))).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = hit;
    }
  }

  // Solo lo usamos si hay al menos 1 token que matchea y el candidato es claro
  return bestScore >= 1 ? bestMatch : null;
}

// ── Compositor de respuesta (GPT) ──────────────────────────────────────────────

const RESPONSE_SYSTEM = `Sos el vendedor virtual de una concesionaria en Argentina. Objetivo: avanzar la venta, no sólo responder.

TONO: directo, argentino (vos), comercial. Ni robot ni chamuyo. 2–4 líneas (máx 6). Sin listas >5 ítems. Cerrá con UNA sola pregunta o acción concreta por turno. Sin frases vacías: "¡Con gusto!", "Gracias por tu consulta", "Como asistente…", "Te comparto", "Aquí tenés", "¡Perfecto!", "¡Claro que sí!", "Estoy aquí para ayudarte".

REGLAS DURAS (no negociables):
- Nunca inventes precio, stock, cuotas, financiación, entrega mínima ni disponibilidad.
- Usá SOLO datos que estén en el contexto que te paso.
- Si no tenés el dato, decilo con honestidad y ofrecé el siguiente paso.
- No mandes links de MercadoLibre como respuesta principal.
- No repitas preguntas que el cliente ya respondió.

ACCIONES (respondé según "Acción" que te llega):
mostrar_resultados        → Lista numerada con nombre, año y precio (ARS). Sin intro de relleno. Cerrá: cuál le interesa / fotos / cuotas.
mostrar_auto_puntual      → Describí con los datos que te paso (nombre, año, km, motor, color si hay, precio). Decí que mandás fotos. Preguntá visita o cuotas.
sin_match                 → Decí que no hay exacto. Si hay alternativas, ofrecelas; si no, hacé UNA pregunta orientadora.
derivar_humano            → "Te paso con alguien del equipo." Sin seguir vendiendo.
credit_sin_auto           → Preguntá sobre qué auto calculamos.
credit_sin_entrega        → Preguntá cuánto pone de entrega.
entrega_minima            → NO inventes monto. Decí que la entrega mínima depende del banco/plan y que el asesor confirma. Ofrecé handoff. Máx 2 líneas.
mostrar_cuotas            → Mostrá planes reales (del dato que te paso). Aclará que son estimados. Preguntá si avanza.
credit_supera_tope        → Explicá el tope. Sugerí mayor entrega u otro auto.
credit_api_error          → Decí que no se pudo consultar y ofrecé asesor.
credit_dato_invalido      → Pedí el dato que falta.
permuta                   → Pedí modelo, año y km del usado. No valúes. Asesor evalúa.
coordinar_visita          → Decí que lo pasás con el equipo para coordinar. Sin horarios inventados.
saludo_inicial            → Saludo breve + qué busca / presupuesto aproximado.
saludo_retorno            → Breve. Retomá fresco sin mencionar lo anterior. Preguntá qué busca ahora.
catalogo_general          → Listá la "muestra" tal cual. Seguí la "nota" si viene. UNA pregunta de navegación.
cambio_de_busqueda        → Confirmá arranque limpio. Preguntá qué busca ahora.
despedida                 → Cierre cálido y corto. Sin nueva pregunta comercial.
indeciso_sin_contexto     → UNA sola pregunta: uso + presupuesto.
modo_exploratorio         → UNA pregunta suave (uso o presupuesto). Sin presionar, sin tirar catálogo.
objecion_precio_sin_presupuesto → UNA pregunta: cuánto tiene pensado gastar. Sin alternativas todavía.
reclamo                   → Empatía breve + derivar a asesor. No intentes resolver.
consulta_general          → Usá el contexto. Sé concreto.

Frases útiles: "Bien, hoy tengo estas opciones:", "Ese lo tengo así:", "¿Te cierra o querés ver otro?", "¿Cuánto ponés de entrega para calcular?", "Lo paso con alguien del equipo.", "Dale, cualquier duda estamos."`;

// Mapeo de action string → RouterAction para inyección de ejemplos dinámicos
const _ACTION_TO_ROUTER: Partial<Record<string, RouterAction>> = {
  mostrar_resultados:     'SHOW_OPTIONS',
  mostrar_auto_puntual:   'SHOW_SINGLE',
  sin_match:              'SAFE_FALLBACK',
  derivar_humano:         'ESCALATE_HUMAN',
  reclamo:                'COMPLAINT',
  credit_sin_auto:        'FINANCING_FLOW',
  credit_sin_entrega:     'FINANCING_FLOW',
  entrega_minima:         'FINANCING_FLOW',
  mostrar_cuotas:         'FINANCING_FLOW',
  permuta:                'TRADE_IN_FLOW',
  coordinar_visita:       'COORDINAR_VISITA',
  indeciso_sin_contexto:  'ASK_ONE_QUESTION',
  modo_exploratorio:      'ASK_ONE_QUESTION',
};

export async function composeResponse(
  action: string,
  data: Record<string, any>,
  historyLines: string[],
  _skillHint?: string
): Promise<string> {
  const historyCtx = historyLines.slice(-6).join('\n');

  // Inyectar ejemplos dinámicos desde exampleSelector (fallback silencioso si DB vacía)
  const routerAction = _ACTION_TO_ROUTER[action];
  let examplesBlock = '';
  if (routerAction) {
    try {
      const examples = await selectExamples(routerAction, [], 1);
      if (examples.length > 0) {
        examplesBlock = `\n\nEJEMPLOS ADICIONALES PARA ESTA SITUACIÓN:\n${examples.join('\n\n')}`;
      }
    } catch {
      // No bloquear si falla el selector
    }
  }

  // Inyectar contexto de skill si hay una activa
  let skillBlock = '';
  if (_skillHint) {
    const hint = getSkillHint(_skillHint);
    if (hint) skillBlock = `\n\n${hint}`;
  }

  const userMessage = `Acción: ${action}\nDatos:\n${JSON.stringify(data, null, 2)}${historyCtx ? `\n\nContexto conversación:\n${historyCtx}` : ''}${examplesBlock}${skillBlock}`;

  const reply = await askGPT({
    systemPrompt: RESPONSE_SYSTEM,
    userMessage,
    maxTokens: 320,
    temperature: 0.6,
    traceCaller: 'botIntelligence.composeResponse',
  });

  return reply ?? 'Hubo un problema técnico. Probá de vuelta en un momento.';
}

// ── Engine principal ───────────────────────────────────────────────────────────

export async function processMessage(params: {
  instance: string;
  remoteJid: string;
  message: string;
  state: ConvState;
}): Promise<IntelligenceResult> {
  const { instance, remoteJid, message, state } = params;
  const historyLines = buildHistory(state);

  // ── Fast path: selección numérica/ordinal determinística ─────────────────────
  // Si hay snapshot vigente Y el mensaje es claramente una selección, resolvermos
  // ANTES de llamar a GPT para evitar clasificación errónea (catalog/other/etc).
  const SNAPSHOT_TTL_MS = 30 * 60 * 1000; // 30 minutos
  const snapshotAge = state.last_hits_at
    ? Date.now() - new Date(state.last_hits_at).getTime()
    : Infinity;
  const snapshotValid = (state.last_hits_detail?.length ?? 0) > 0 && snapshotAge <= SNAPSHOT_TTL_MS;

  if (snapshotValid) {
    const selNum = detectCatalogSelection(message);
    console.info(`[selection] raw_input="${message.slice(0, 50)}" detected_num=${selNum ?? 'none'} snapshot_count=${state.last_hits_detail!.length} snapshot_age_min=${Math.round(snapshotAge / 60000)}`);

    if (selNum !== null) {
      const idx = selNum - 1;
      if (idx < 0 || idx >= state.last_hits_detail!.length) {
        console.info(`[selection] failed reason=index_out_of_range index=${selNum} max=${state.last_hits_detail!.length}`);
        return {
          reply: `Solo tengo opciones del 1 al ${state.last_hits_detail!.length}. ¿Cuál te interesa?`,
          newState: {
            ...state,
            last_user_at: new Date().toISOString(),
            user_msg_count: (state.user_msg_count ?? 0) + 1,
          },
        };
      }

      const selected = state.last_hits_detail![idx];
      console.info(`[catalog] snapshotUsed=true parsed_index=${selNum} resolved_vehicle_id=${selected.id} resolved_vehicle_title="${selected.name}" snapshot_age_min=${Math.round(snapshotAge / 60000)}`);

      const selResult = await handleSpecificById(selected.id, state, message, historyLines);

      // Guardrail: el vehículo presentado DEBE coincidir con la selección
      if (selResult.presentedVehicle && selResult.presentedVehicle.id !== selected.id) {
        console.error(`[selection] guardrail_mismatch expected=${selected.id} actual=${selResult.presentedVehicle.id}`);
      }

      const selNewState: ConvState = {
        ...state,
        last_intent: 'specific',
        last_user_at: new Date().toISOString(),
        user_msg_count: (state.user_msg_count ?? 0) + 1,
        last_bot_reply_at: new Date().toISOString(),
        lastBotAt: new Date().toISOString(),
      };
      if (selResult.presentedVehicle) {
        selNewState.lastPresentedVehicleId    = selResult.presentedVehicle.id;
        selNewState.lastPresentedVehicleTitle = selResult.presentedVehicle.name;
        selNewState.lastPresentedVehiclePriceArs = selResult.presentedVehicle.priceNumber;
        selNewState.lastPresentedVehicleBrand = selResult.presentedVehicle.brand;
        selNewState.lastPresentedVehicleModel = selResult.presentedVehicle.model;
        selNewState.lastPresentedAt = new Date().toISOString();
      }
      return {
        reply: selResult.reply,
        newState: selNewState,
        imagesToSend: selResult.imagesToSend,
      };
    }
  } else {
    const selNum = detectCatalogSelection(message);
    if (selNum !== null) {
      if ((state.last_hits_detail?.length ?? 0) > 0 && snapshotAge > SNAPSHOT_TTL_MS) {
        // Había snapshot pero expiró
        console.info(`[selection] snapshot_expired age_min=${Math.round(snapshotAge / 60000)} raw_input="${message.slice(0, 50)}"`);
        return {
          reply: 'El listado que te mostré ya venció. ¿Qué auto estás buscando?',
          newState: {
            ...state,
            last_hits_detail: [],
            last_hits: [],
            last_user_at: new Date().toISOString(),
            user_msg_count: (state.user_msg_count ?? 0) + 1,
          },
        };
      }
      // Sin snapshot previo: solo loggear y dejar caer al flujo normal de GPT
      console.info(`[selection] failed reason=no_snapshot raw_input="${message.slice(0, 50)}"`);
    }
  }

  // ── Fast path: follow-up de financiación cuando hay vehículo activo ──────────
  // "lo mínimo", "y cuotas?", "cuánto de entrega?", etc. → NO pasar por GPT
  if (state.lastPresentedVehicleId && detectFinancingFollowup(message)) {
    const isMinimumQuery = MINIMUM_PAYMENT_RE.test(message);
    console.info(`[bot] activeVehicleUsed=true financing_followup_detected vehicle=${state.lastPresentedVehicleId} title="${state.lastPresentedVehicleTitle ?? '?'}" isMinimumQuery=${isMinimumQuery} msg="${message.slice(0, 50)}"`);

    const financeState: ConvState = {
      ...state,
      last_intent: 'credit_quote',
      last_user_at: new Date().toISOString(),
      user_msg_count: (state.user_msg_count ?? 0) + 1,
      last_bot_reply_at: new Date().toISOString(),
      lastBotAt: new Date().toISOString(),
    };

    if (isMinimumQuery) {
      // No tenemos dato real de entrega mínima → no inventar, derivar al asesor
      const reply = await composeResponse('entrega_minima', {
        auto: state.lastPresentedVehicleTitle ?? 'ese auto',
        precio: state.lastPresentedVehiclePriceArs
          ? `ARS ${Math.round(state.lastPresentedVehiclePriceArs).toLocaleString('es-AR')}`
          : null,
        nota: 'No inventés ningún monto. Decí que lo confirma el asesor. Ofrecé pasarlo con el equipo.',
      }, historyLines);
      return { reply, newState: financeState };
    }

    // Otro follow-up de financiación → handleCredit con vehículo activo
    const finResult = await handleCredit(
      { intent: 'credit_quote' } as Extracted,
      state,
      message,
      historyLines
    );
    return { reply: finResult.reply, newState: financeState, imagesToSend: finResult.imagesToSend };
  }

  // 1. Pre-chequeo rápido sin GPT para reset/catálogo obvios
  const fastOverride = detectResetOrCatalog(message);

  // 2. Extraer intención (con contexto de autos mostrados para resolver referencias)
  const extracted = await extractIntent(message, historyLines);

  // Pre-chequeo tiene prioridad sobre GPT para reset/greeting/catalog
  if (fastOverride === 'reset' && extracted.intent !== 'farewell' && extracted.intent !== 'advisor') {
    extracted.intent = extracted.intent === 'greeting' ? 'greeting' : 'reset';
  } else if (fastOverride === 'catalog') {
    extracted.intent = 'catalog';
  } else if (fastOverride === 'catalog_more' && state.catalog_offset != null && state.catalog_offset > 0) {
    extracted.intent = 'catalog';
  }

  // ── Guardrail: bloquear reset de contexto por mensaje ambiguo ────────────────
  // Si hay vehículo activo Y GPT devuelve catalog/reset/search vago sin señal explícita
  // → no resetear el flujo, mantener contexto del vehículo/financiación activa
  const hasActiveVehicle = !!state.lastPresentedVehicleId;
  const hasExplicitReset = fastOverride === 'reset' || fastOverride === 'catalog';
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  const hasNewStrongFilter = !!(
    extracted.brand || extracted.model || extracted.maxPrice || extracted.bodywork ||
    extracted.fuel || extracted.gnc || extracted.transmission || extracted.useCase
  );
  const isAmbiguousOverride =
    hasActiveVehicle &&
    !hasExplicitReset &&
    ['catalog', 'reset', 'search', 'unsure'].includes(extracted.intent) &&
    !hasNewStrongFilter &&
    (extracted.confidence === 'low' || !extracted.confidence || wordCount <= 3);

  if (isAmbiguousOverride) {
    console.info(`[bot] fallback_blocked hasVehicleContext=true intent_was=${extracted.intent} last_intent=${state.last_intent} vehicle=${state.lastPresentedVehicleId} confidence=${extracted.confidence ?? 'n/a'} msg="${message.slice(0, 50)}" → maintaining vehicle context`);
    extracted.intent = 'specific';
    extracted.selectedVehicleId = state.lastPresentedVehicleId;
  }

  const isContextReset = ['greeting', 'reset', 'catalog'].includes(extracted.intent);
  console.info(`[bot] intent=${extracted.intent} leadMode=${extracted.leadMode ?? 'n/a'} confidence=${extracted.confidence ?? 'n/a'} needsClarification=${extracted.needsClarification ?? false} reset_detected=${isContextReset} catalog_intent=${extracted.intent === 'catalog'} fast_override=${fastOverride ?? 'none'} hasActiveVehicle=${hasActiveVehicle} fallback_blocked=${isAmbiguousOverride} selectedVehicleId=${extracted.selectedVehicleId ?? 'none'} msg="${message.slice(0, 50)}"`);

  // 3. Si GPT no resolvió selectedVehicleId pero hay hits previos, intentar resolución determinística
  if (
    !extracted.selectedVehicleId &&
    (extracted.intent === 'specific' || extracted.intent === 'refine') &&
    state.last_hits_detail?.length
  ) {
    const resolved = resolveVehicleByText(message, state.last_hits_detail);
    if (resolved) extracted.selectedVehicleId = resolved.id;
  }

  // 3. Detectar lead caliente (corre en paralelo, no bloquea)
  const hotResult = detectHotLead(message, state);
  if (hotResult.isHot) {
    notifyHotLead({ instance, remoteJid, state, lastMessage: message, signals: hotResult.signals })
      .catch(() => {});
  }

  // ── Router de decisiones (para logging y trazabilidad) ───────────────────────
  const routerDecision = routeDecision(extracted, state);
  logPipelineEvent({
    ts: new Date().toISOString(),
    instance,
    remoteJid,
    intent: extracted.intent,
    intentConfidence: extracted.confidence,
    leadMode: extracted.leadMode,
    needsClarification: extracted.needsClarification,
    action: routerDecision.action,
    actionReason: routerDecision.reason,
    skillHint: routerDecision.skillHint,
    isHotLead: hotResult.isHot,
    leadScore: (state.leadScore ?? 0) + hotResult.score,
    fastPath: null,
  });

  // ── Detección de objeción (para ajustar objection_count en estado) ──────────
  const objection = detectObjection(message, extracted, state);

  // ── Handoff notification — no esperar al hot lead check ──────────────────────
  // ESCALATE_HUMAN debe notificar siempre, independientemente del lead score
  if (routerDecision.action === 'ESCALATE_HUMAN') {
    console.log(`[handoff] handoff_decided instance=${instance} jid=${remoteJid} reason=${routerDecision.reason}`);
    notifyAdvisorHandoff({
      instance,
      remoteJid,
      state,
      lastMessage: message,
      reason: routerDecision.reason,
    }).catch(e => console.error(`[handoff] handoff_notify_result=error handoff_notify_error="${e?.message ?? e}"`));
  }

  // Catalog offset: reset si es catálogo nuevo, conservar si es "más opciones"
  let effectiveState = state;
  if (extracted.intent === 'catalog') {
    const isCatalogMore = fastOverride === 'catalog_more';
    if (!isCatalogMore) {
      effectiveState = { ...state, catalog_offset: 0 };
    }
  }

  // ── Bug 8: Pivot de no-match a búsqueda por presupuesto/segmento ─────────────
  // Si el bot respondió sin-match en el turno anterior y el usuario da nuevos filtros
  // sin reiterar marca/modelo, salir del contexto de exact-match anterior
  const prevWasNoMatch = state.last_reply_action === 'sin_match';
  const isPivotToSearch = ['search', 'refine', 'alternatives'].includes(extracted.intent);
  const hasNewFilter = !!(extracted.maxPrice || extracted.bodywork || extracted.useCase || extracted.fuel);
  const hasNoNewBrandModel = !extracted.brand && !extracted.model;
  const hasPivotSignal = /presupuesto|alternativa|algo\s+parecido|similar|algo\s+m[aá]s?\s+(barato|accesible)|otra\s+opci[oó]n|qu[eé]\s+ten[eé]s?\s+en\s+ese|uno\s+hasta|hasta\s+\d/i.test(message);

  if (prevWasNoMatch && isPivotToSearch && (hasNewFilter || hasPivotSignal) && hasNoNewBrandModel) {
    const droppedBrand = state.search_context?.brand ?? 'none';
    const droppedModel = state.search_context?.model ?? 'none';
    console.info(`[bot] pivot_from_nomatch=true dropped_brand="${droppedBrand}" dropped_model="${droppedModel}" new_budget=${extracted.maxPrice ?? 'none'} msg="${message.slice(0, 50)}"`);
    effectiveState = {
      ...state,
      search_context: {
        // Mantener filtros no-mark: bodywork, useCase, fuel, transmission
        ...(extracted.bodywork || state.search_context?.bodywork ? { bodywork: extracted.bodywork ?? state.search_context?.bodywork } : {}),
        ...(extracted.useCase || state.search_context?.useCase ? { useCase: extracted.useCase ?? state.search_context?.useCase } : {}),
        ...(extracted.fuel || state.search_context?.fuel ? { fuel: extracted.fuel ?? state.search_context?.fuel } : {}),
        ...(extracted.transmission || state.search_context?.transmission ? { transmission: extracted.transmission ?? state.search_context?.transmission } : {}),
        // Nuevo presupuesto tiene prioridad
        ...(extracted.maxPrice ? { maxPrice: extracted.maxPrice, currency: extracted.currency ?? 'ARS' } : (state.search_context?.maxPrice ? { maxPrice: state.search_context.maxPrice, currency: state.search_context.currency } : {})),
        // brand/model explícitamente ausentes — pivot a búsqueda sin exact-match
      },
    };
    // Forzar intent search para que pase por handleSearch con el nuevo contexto
    extracted.intent = 'search';
  }

  // 4. Decidir y responder
  const result = await decide(extracted, effectiveState, message, historyLines);

  // ── TruthGuard: validar respuesta antes de enviar ─────────────────────────────
  const guardCatalog = await getCatalog().catch(() => [] as CatalogItem[]);
  const guardResult = await runTruthGuardWorker({
    instance,
    remoteJid,
    responseText: result.reply,
    presentedVehicleId: result.presentedVehicle?.id,
    catalog: guardCatalog,
    state: effectiveState,
    action: routerDecision.action,
  });
  if (guardResult.blocked) {
    result.reply = guardResult.finalText;
  }

  // 5. Actualizar estado
  const newState: Partial<ConvState> = {
    ...state,
    last_intent: extracted.intent,
    last_user_at: new Date().toISOString(),
    user_msg_count: (state.user_msg_count ?? 0) + 1,
    leadScore: Math.min(100, (state.leadScore ?? 0) + hotResult.score),
    agent: {
      ...state.agent,
      intent: extracted.intent,
      confidence: extracted.confidence === 'high' ? 1 : extracted.confidence === 'medium' ? 0.6 : 0.3,
      urgency: extracted.urgency ?? (extracted.leadMode === 'hot' ? 'high' : 'low'),
      internalReason: extracted.leadMode ? `leadMode=${extracted.leadMode}` : undefined,
      updatedAt: new Date().toISOString(),
    },
  };

  // Trazar last_reply_action para anti-repetición y pivot detection
  newState.last_reply_action = result.isNoMatch ? 'sin_match' : routerDecision.action;

  if (isContextReset) {
    newState.search_context = {};
    newState.last_hits = [];
    newState.last_hits_detail = [];
    newState.last_query = undefined;
    newState.lastPresentedVehicleId    = undefined;
    newState.lastPresentedVehicleTitle = undefined;
    newState.lastPresentedVehiclePriceArs = undefined;
    newState.lastPresentedVehicleBrand = undefined;
    newState.lastPresentedVehicleModel = undefined;
    newState.lastPresentedAt           = undefined;
    newState.last_reply_action         = undefined;
    if (extracted.intent === 'catalog') {
      newState.catalog_offset = result.nextCatalogOffset ?? 0;
    } else {
      newState.catalog_offset = 0;
    }
    console.info(`[bot] previous_context_cleared=true reason=${extracted.intent} response_mode=${extracted.intent === 'catalog' ? 'catalog' : extracted.intent === 'greeting' ? 'greeting' : 'reset'}`);
  } else if (['search', 'refine', 'unsure'].includes(extracted.intent)) {
    newState.search_context = mergeSearchContext(effectiveState.search_context, extracted);
    newState.last_query = message;
  }

  if (result.hitIds?.length && result.hitsDetail?.length) {
    newState.last_hits = result.hitIds;
    newState.last_hits_at = new Date().toISOString();
    newState.last_hits_detail = result.hitsDetail;
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

  // Actualizar objection_count si se detectó objeción este turno
  if (objection.detected) {
    newState.objection_count = incrementObjectionCount(state);
  }

  // Log final del turno: reply enviada + guard result
  logPipelineEvent({
    ts: new Date().toISOString(),
    instance,
    remoteJid,
    action: routerDecision.action,
    guardPassed: guardResult.passed,
    guardIssues: guardResult.blocked ? undefined : undefined, // issues ya loggeadas en worker
    replyLengthChars: result.reply.length,
    vehicleIds: result.hitIds,
    vehiclesShown: result.hitsDetail?.length,
  });

  return {
    reply: result.reply,
    newState: newState as ConvState,
    isHot: hotResult.isHot,
    imagesToSend: result.imagesToSend,
  };
}

// ── Handler: catálogo / exploración ───────────────────────────────────────────

async function handleCatalog(historyLines: string[], offset = 0): Promise<DecideResult & { nextOffset?: number }> {
  const catalog = await getCatalog();
  const available = catalog.filter(i => i.inStock);
  const { rate: usdRate } = await getUsdToArs();

  const safeOffset = Math.max(0, Math.min(offset, available.length));
  const page = available.slice(safeOffset, safeOffset + CATALOG_PAGE_SIZE);
  const hasMore = safeOffset + CATALOG_PAGE_SIZE < available.length;
  const remaining = available.length - safeOffset - page.length;
  const nextOffset = hasMore ? safeOffset + CATALOG_PAGE_SIZE : 0;

  const sample = page.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');

  console.info(`[bot] catalog_total_count=${available.length} catalog_display_count=${page.length} catalog_offset=${safeOffset} catalog_has_more=${hasMore} catalog_mode=${safeOffset === 0 ? 'first_page' : 'paginated'}`);

  // Snapshot con precios normalizados a ARS — fuente única para financiación/handoff
  const hitsDetail: NonNullable<ConvState['last_hits_detail']> = page.map((v, i) => ({
    idx: i,
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    priceNumber: priceToArs(v, usdRate),
    currency: 'ARS',
    images: v.images,
  }));

  console.info(`[catalog] presented options saved count=${page.length} ids=[${page.map(v => v.id).join(',')}]`);
  page.forEach((v, i) => console.info(`[catalog] option ${i + 1} vehicleId=${v.id} priceArs=${priceToArs(v, usdRate) ?? 'n/a'}`));

  const reply = await composeResponse('catalogo_general', {
    total_disponibles: available.length,
    muestra: sample || 'Sin stock disponible en este momento.',
    tiene_mas: hasMore,
    restantes: hasMore ? remaining : 0,
    nota: hasMore
      ? `Mostrá estas ${page.length} opciones y al final agregá una línea: "Tengo ${remaining} autos más en stock. Decime 'más opciones' para ver el resto." Cerrá con UNA pregunta de navegación.`
      : 'Estas son todas las opciones disponibles. Cerrá con UNA pregunta de navegación (marca, tipo o presupuesto).',
  }, historyLines);

  return { reply, nextOffset, hitIds: page.map(v => v.id), hitsDetail };
}

// ── Decision engine ────────────────────────────────────────────────────────────

interface DecideResult {
  reply: string;
  hitIds?: string[];
  hitsDetail?: ConvState['last_hits_detail'];
  presentedVehicle?: CatalogItem;
  imagesToSend?: string[];
  nextCatalogOffset?: number;
  /** true cuando la respuesta fue un sin-match — usado para pivot detection y anti-repetición */
  isNoMatch?: boolean;
}

/**
 * Busca alternativas razonablemente cercanas cuando hay no-match.
 * Una alternativa es cercana si comparte al menos 2 de: marca, segmento, rango de precio, año similar.
 * Evita ofrecer cosas absurdas (ej: Fiat como alternativa a BMW).
 */
function findClosestAlternatives(
  catalog: CatalogItem[],
  ex: Extracted,
  usdRate: number,
  searchCtx?: ConvState['search_context']
): CatalogItem[] {
  const inStock = catalog.filter(i => i.inStock !== false);
  const sc = searchCtx ?? {};
  const brand = ex.brand ?? sc.brand;
  const bodywork = (ex.bodywork ?? sc.bodywork)?.toLowerCase();
  const rawBudget = ex.maxPrice ?? sc.maxPrice;
  // Budget puede estar en USD si el catálogo usa USD — normalizar
  const budgetArs = rawBudget
    ? ((ex.currency ?? sc.currency ?? 'ARS').toUpperCase() === 'USD' && usdRate > 0
        ? Math.round(rawBudget * usdRate) : rawBudget)
    : undefined;

  // Estrategia 1: misma marca, relajar modelo/año
  if (brand) {
    const sameBrand = inStock
      .filter(i => i.brand?.toLowerCase().includes(brand.toLowerCase()))
      .slice(0, 3);
    if (sameBrand.length > 0) {
      console.info(`[nomatch] alternatives_strategy=same_brand brand="${brand}" count=${sameBrand.length}`);
      return sameBrand;
    }
  }

  // Estrategia 2: mismo segmento + rango de precio razonable (±40%)
  const scored = inStock.map(i => {
    let pts = 0;
    const iBodywork = quickInferBodywork(i)?.toLowerCase();
    if (bodywork && iBodywork === bodywork) pts += 3;
    if (budgetArs && i.priceNumber) {
      const itemArs = priceToArs(i, usdRate) ?? i.priceNumber;
      const ratio = itemArs / budgetArs;
      if (ratio <= 1.4 && ratio >= 0.5) pts += 2;
      if (ratio <= 1.1 && ratio >= 0.7) pts += 1;
    }
    const targetYear = ex.year ?? sc.year;
    if (targetYear && i.year && Math.abs(i.year - targetYear) <= 3) pts += 1;
    return { i, pts };
  }).filter(x => x.pts >= 2).sort((a, b) => b.pts - a.pts);

  if (scored.length > 0) {
    console.info(`[nomatch] alternatives_strategy=segment_price count=${scored.length} top_pts=${scored[0].pts}`);
    return scored.slice(0, 3).map(x => x.i);
  }

  // Estrategia 3: solo por presupuesto (±30%)
  if (budgetArs) {
    const byBudget = inStock
      .filter(i => {
        const itemArs = priceToArs(i, usdRate) ?? i.priceNumber ?? 0;
        return itemArs > 0 && itemArs <= budgetArs * 1.3 && itemArs >= budgetArs * 0.5;
      })
      .slice(0, 3);
    if (byBudget.length > 0) {
      console.info(`[nomatch] alternatives_strategy=budget_only budget_ars=${budgetArs} count=${byBudget.length}`);
      return byBudget;
    }
  }

  console.info(`[nomatch] alternatives_strategy=none — no reasonable alternatives found`);
  return [];
}

async function decide(
  ex: Extracted,
  state: ConvState,
  rawMessage: string,
  historyLines: string[]
): Promise<DecideResult> {

  // Derivar a humano inmediatamente
  if (ex.intent === 'advisor' || ex.wantsAdvisor) {
    const reply = await composeResponse('derivar_humano', { mensaje: rawMessage }, historyLines);
    return { reply };
  }

  // Reclamo
  if (ex.intent === 'complaint') {
    const reply = await composeResponse('reclamo', { mensaje: rawMessage }, historyLines);
    return { reply };
  }

  // Despedida
  if (ex.intent === 'farewell') {
    const reply = await composeResponse('despedida', { mensaje: rawMessage }, historyLines);
    return { reply };
  }

  // Saludo — siempre reinicia, con o sin historial previo
  // No pasar historyLines: evita que GPT genere "seguimos" basado en conversación anterior
  if (ex.intent === 'greeting') {
    const action = state.last_intent ? 'saludo_retorno' : 'saludo_inicial';
    const reply = await composeResponse(action, {}, []);
    return { reply };
  }

  // Catálogo explícito — muestra opciones disponibles con pregunta de navegación
  if (ex.intent === 'catalog') {
    // Si viene del fast-override catalog_more y hay offset guardado, continuar desde ahí.
    // Si es un catalog nuevo (sin offset), empieza desde 0.
    const offset = state.catalog_offset ?? 0;
    const { reply, nextOffset, hitIds, hitsDetail } = await handleCatalog(historyLines, offset);
    return { reply, nextCatalogOffset: nextOffset, hitIds, hitsDetail };
  }

  // Reset / cambio de búsqueda — limpia contexto y vuelve a exploración
  if (ex.intent === 'reset') {
    const reply = await composeResponse('cambio_de_busqueda', { mensaje: rawMessage }, historyLines);
    return { reply };
  }

  // Permuta
  if (ex.intent === 'trade_in') {
    const reply = await composeResponse('permuta', {
      mensaje: rawMessage,
      nota: 'Pedir modelo, año y km del usado. No dar valuación. Asesor evalúa.',
    }, historyLines);
    return { reply };
  }

  // Visita
  if (ex.intent === 'visit' || ex.wantsVisit) {
    const auto = state.lastPresentedVehicleTitle ?? state.last_query ?? 'el auto';
    const reply = await composeResponse('coordinar_visita', {
      auto,
      nota: 'Confirmar el auto y coordinar con el equipo. No dar horarios específicos.',
    }, historyLines);
    return { reply };
  }

  // Crédito / cuotas
  if (ex.intent === 'credit_quote' || ex.downPayment) {
    return await handleCredit(ex, state, rawMessage, historyLines);
  }

  // Auto puntual elegido de los mostrados (referencia contextual)
  if (ex.selectedVehicleId) {
    return await handleSpecificById(ex.selectedVehicleId, state, rawMessage, historyLines);
  }

  // Búsqueda específica de un modelo puntual (intent=specific con brand/model)
  if (ex.intent === 'specific' && (ex.brand || ex.model)) {
    return await handleSearch(ex, state, historyLines);
  }

  // Objeción de precio: rescate comercial primero, luego alternativas
  // Solo derivar a humano si ya hay presupuesto Y se agotaron los intents de precio
  if (ex.leadMode === 'price_sensitive') {
    const hasKnownBudget = !!(ex.maxPrice || state.search_context?.maxPrice);
    if (!hasKnownBudget) {
      // No sabemos el presupuesto real — preguntar UNA cosa antes de cualquier acción
      console.info(`[bot] price_objection_rescue=ask_budget no_known_budget=true`);
      const reply = await composeResponse('objecion_precio_sin_presupuesto', {
        mensaje: rawMessage,
        nota: 'El cliente dice que está caro pero no tenemos presupuesto confirmado. Preguntá UNA sola cosa: cuánto tiene pensado gastar. Sin mostrar alternativas todavía. Sin derivar.',
      }, historyLines, 'price-objection');
      return { reply };
    }
    // Hay presupuesto → buscar alternativas dentro de ese rango
    console.info(`[bot] price_objection_rescue=search_within_budget budget=${ex.maxPrice ?? state.search_context?.maxPrice}`);
    return await handleSearch(ex, state, historyLines, 'price-objection');
  }

  // Indeciso / pide recomendación
  if (ex.intent === 'unsure') {
    const sc = state.search_context;
    const hasContext = sc && (sc.brand || sc.maxPrice || sc.bodywork || sc.useCase);

    // Si hay contexto previo suficiente → buscar y recomendar
    if (hasContext) {
      return await handleSearch(ex, state, historyLines);
    }

    // Si el lead extrajo al menos un filtro útil (useCase o bodywork) → usarlo
    if (ex.useCase || ex.bodywork) {
      return await handleSearch(ex, state, historyLines);
    }

    // Sin contexto → preguntar una sola cosa útil
    const reply = await composeResponse('indeciso_sin_contexto', {
      nota: 'UNA sola pregunta: uso + presupuesto. Nada más.',
      leadMode: ex.leadMode ?? 'exploratory',
    }, historyLines);
    return { reply };
  }

  // Búsqueda / refinamiento / alternativas — pero primero validar que hay contexto mínimo
  if (['search', 'refine', 'alternatives'].includes(ex.intent)) {
    // Si el lead es exploratorio y no tiene ningún filtro útil → pedir orientación primero
    if (
      ex.needsClarification &&
      ex.leadMode === 'exploratory' &&
      ex.confidence === 'low' &&
      !ex.brand && !ex.model && !ex.maxPrice && !ex.bodywork &&
      !state.search_context?.brand && !state.search_context?.maxPrice &&
      !state.search_context?.bodywork && !state.search_context?.useCase
    ) {
      const reply = await composeResponse('modo_exploratorio', {
        mensaje: rawMessage,
        nota: 'El lead anda viendo sin filtros. UNA pregunta orientadora (uso o presupuesto). No mostrar catálogo todavía.',
      }, historyLines);
      return { reply };
    }

    // Si hay needsClarification pero SÍ hay algún filtro parcial → buscar igual y pedir 1 dato más al final
    return await handleSearch(ex, state, historyLines);
  }

  // Fallback con contexto completo
  const catalog = await getCatalog();
  const topItems = filterCatalog(catalog, { ...ex, search_context: state.search_context });
  const { rate: usdRate } = await getUsdToArs();
  const catalogCtx = topItems.length
    ? topItems.map((v, i) => formatItemLine(v, i, usdRate)).join('\n')
    : 'Sin vehículos disponibles para ese criterio.';

  const reply = await composeResponse('consulta_general', {
    mensaje: rawMessage,
    catalogo: catalogCtx,
    estado: summarizeState(state),
  }, historyLines);
  return { reply };
}

// ── Handler: auto puntual por ID (referencia contextual) ──────────────────────

async function handleSpecificById(
  vehicleId: string,
  state: ConvState,
  rawMessage: string,
  historyLines: string[]
): Promise<DecideResult> {
  const catalog = await getCatalog();
  const vehicle = catalog.find(v => v.id === vehicleId);
  const { rate: usdRate } = await getUsdToArs();

  if (!vehicle) {
    const alternatives = catalog.filter(i => i.inStock !== false).slice(0, 3);
    const reply = await composeResponse('sin_match', {
      busqueda: { id: vehicleId },
      nota: 'El auto referenciado ya no está disponible. Ofrecer alternativas si las hay.',
      alternativas: alternatives.map((v, i) => formatItemLine(v, i, usdRate)).join('\n') || '',
      tiene_alternativas: alternatives.length > 0,
    }, historyLines);
    return { reply, isNoMatch: true };
  }

  // Precio siempre en ARS — fuente única para detalle y financiación posterior
  const priceArs = priceToArs(vehicle, usdRate);
  const lineDetalle = buildVehicleDetail(vehicle, usdRate);

  console.info(`[catalog] detail vehicleId=${vehicle.id} name="${vehicle.name}" rawCurrency=${vehicle.currency ?? 'ARS'} rawPrice=${vehicle.priceNumber ?? 'n/a'} priceArs=${priceArs ?? 'n/a'} usdRate=${usdRate}`);

  const reply = await composeResponse('mostrar_auto_puntual', {
    auto: lineDetalle,
    nota: 'Describí este auto puntual. Mencioná que enviás las fotos. Preguntá si quiere verlo o calcular cuotas.',
  }, historyLines);

  return {
    reply,
    // presentedVehicle siempre con priceNumber en ARS para que handleCredit lo use directo
    presentedVehicle: { ...vehicle, priceNumber: priceArs, currency: 'ARS' },
    imagesToSend: vehicle.images?.slice(0, 5) ?? (vehicle.image ? [vehicle.image] : []),
  };
}

// ── Handler: búsqueda ──────────────────────────────────────────────────────────

async function handleSearch(ex: Extracted, state: ConvState, historyLines: string[], skillHint?: string): Promise<DecideResult> {
  const catalog = await getCatalog();
  const hits = filterCatalog(catalog, { ...ex, search_context: state.search_context });
  const { rate: usdRate } = await getUsdToArs();

  if (hits.length === 0) {
    // Fallback suave: intent exploratorio sin brand/model (auto chico, económico, para la familia).
    // En vez de "sin match", expandir quitando bodywork/fuelEconomy y mostrar top opciones del catálogo.
    const isSoftIntent = !ex.brand && !ex.model && (ex.fuelEconomyPriority || !!ex.useCase);
    if (isSoftIntent) {
      const softHits = filterCatalog(catalog, {
        ...ex,
        bodywork: undefined,
        fuelEconomyPriority: false,
        search_context: { ...(state.search_context ?? {}), bodywork: undefined },
      });
      if (softHits.length > 0) {
        const shown = softHits.slice(0, 5);
        const softLines = shown.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');
        const softDetail: ConvState['last_hits_detail'] = shown.map((v, i) => ({
          idx: i, id: v.id, name: v.name, brand: v.brand, model: v.model,
          priceNumber: priceToArs(v, usdRate), currency: 'ARS',
          images: v.images,
        }));
        console.info(`[search] softIntentFallback=true expanded_count=${shown.length}`);
        const softReply = await composeResponse('mostrar_resultados', {
          resultados: softLines,
          cantidad: shown.length,
          leadMode: ex.leadMode ?? 'exploratory',
          needsClarification: false,
          nota: 'El cliente buscó algo genérico (auto chico, económico, para la familia). Mostrá estas opciones como las más cercanas a lo que buscó. Arrancá con algo como "Tengo algunas opciones que pueden encajar con lo que buscás". No digas que no hay match exacto.',
        }, historyLines, skillHint);
        return {
          reply: softReply,
          hitIds: shown.map(h => h.id),
          hitsDetail: softDetail,
          presentedVehicle: { ...shown[0], priceNumber: priceToArs(shown[0], usdRate), currency: 'ARS' },
        };
      }
    }

    const alternatives = findClosestAlternatives(catalog, ex, usdRate, state.search_context);
    const altLines = alternatives.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');
    const tieneAlternativas = alternatives.length > 0;
    const prevWasNoMatch = state.last_reply_action === 'sin_match';
    const reply = await composeResponse('sin_match', {
      busqueda: { brand: ex.brand, model: ex.model, bodywork: ex.bodywork, year: ex.year, maxPrice: ex.maxPrice },
      alternativas: altLines || '',
      tiene_alternativas: tieneAlternativas,
      nota: tieneAlternativas
        ? `Decí que no tenés exactamente eso. Ofrecé estas alternativas que SÍ comparten segmento/precio real. NO ofrezcas autos de precio/segmento completamente diferente como "cercanos".${prevWasNoMatch ? ' El usuario ya vio una respuesta de no-match — variá el tono, no repitas.' : ''}`
        : `No hay match exacto ni alternativas razonables. Reconocé el gap con claridad. Hacé UNA sola pregunta para orientar: presupuesto, tipo de uso o segmento deseado.${prevWasNoMatch ? ' No repitas la misma respuesta.' : ''}`,
    }, historyLines, skillHint);
    return { reply, isNoMatch: true };
  }

  // Un solo resultado: auto puntual con precio ARS normalizado
  if (hits.length === 1) {
    const vehicle = hits[0];
    const priceArs = priceToArs(vehicle, usdRate);
    const lineDetalle = buildVehicleDetail(vehicle, usdRate);
    const reply = await composeResponse('mostrar_auto_puntual', {
      auto: lineDetalle,
      nota: 'Solo hay un resultado. Presentarlo bien. Preguntar si quiere fotos, cuotas o verlo.',
    }, historyLines, skillHint);
    return {
      reply,
      hitIds: [vehicle.id],
      hitsDetail: [{ idx: 0, id: vehicle.id, name: vehicle.name, brand: vehicle.brand, model: vehicle.model, priceNumber: priceArs, currency: 'ARS', images: vehicle.images }],
      presentedVehicle: { ...vehicle, priceNumber: priceArs, currency: 'ARS' },
      imagesToSend: vehicle.images?.slice(0, 5) ?? (vehicle.image ? [vehicle.image] : []),
    };
  }

  const hitLines = hits.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');

  let resultadosNota = 'Mostrar opciones numeradas concretas. Cerrar preguntando cuál le interesa o si quiere fotos/cuotas de alguno.';
  if (ex.needsClarification && ex.leadMode === 'exploratory') {
    resultadosNota = 'Mostrar opciones numeradas. Al final, hacé UNA pregunta suave para refinar (presupuesto o tipo preferido). No presiones.';
  } else if (ex.leadMode === 'hot') {
    resultadosNota = 'Mostrar opciones numeradas. Cerrar con acción concreta: cuál le interesa para coordinar visita o calcular cuotas HOY.';
  } else if (ex.leadMode === 'price_sensitive') {
    resultadosNota = 'Mostrar opciones de menor precio primero. Cerrá preguntando si alguna se acerca al presupuesto.';
  }

  const reply = await composeResponse('mostrar_resultados', {
    resultados: hitLines,
    cantidad: hits.length,
    leadMode: ex.leadMode ?? 'decided',
    needsClarification: ex.needsClarification ?? false,
    nota: resultadosNota,
  }, historyLines, skillHint);

  // Snapshot con precios normalizados a ARS (fuente única para contexto/financiación)
  const hitsDetail: ConvState['last_hits_detail'] = hits.map((v, i) => ({
    idx: i,
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    priceNumber: priceToArs(v, usdRate),
    currency: 'ARS',
    images: v.images,
  }));

  console.info(`[catalog] snapshotSaved=true count=${hits.length} ids=[${hits.map(h => h.id).join(',')}]`);
  hits.forEach((v, i) => console.info(`[catalog] option ${i + 1} vehicleId=${v.id} name="${v.name}" priceArs=${priceToArs(v, usdRate) ?? 'n/a'}`));

  const firstHitPriceArs = priceToArs(hits[0], usdRate);
  return {
    reply,
    hitIds: hits.map(h => h.id),
    hitsDetail,
    presentedVehicle: { ...hits[0], priceNumber: firstHitPriceArs, currency: 'ARS' },
  };
}

// ── Handler: crédito ───────────────────────────────────────────────────────────

async function handleCredit(
  ex: Extracted,
  state: ConvState,
  rawMessage: string,
  historyLines: string[]
): Promise<DecideResult> {
  const vehicle = state.lastPresentedVehicleTitle
    ? {
        title: state.lastPresentedVehicleTitle,
        price: state.lastPresentedVehiclePriceArs,
        year: Number(state.lastPresentedAt?.slice(0, 4)) || new Date().getFullYear(),
      }
    : null;

  if (!vehicle?.price && !ex.maxPrice) {
    const reply = await composeResponse('credit_sin_auto', {
      nota: 'Preguntar sobre qué auto están calculando las cuotas.',
    }, historyLines);
    return { reply };
  }

  const vehiclePrice = vehicle?.price ?? ex.maxPrice!;
  const downPayment = ex.downPayment ?? state.finance?.downPayment;

  if (!downPayment) {
    // vehiclePrice ya está en ARS (lastPresentedVehiclePriceArs se almacena normalizado)
    const reply = await composeResponse('credit_sin_entrega', {
      auto: vehicle?.title ?? 'el auto seleccionado',
      precio: `ARS ${Math.round(vehiclePrice).toLocaleString('es-AR')}`,
      nota: 'Preguntar cuánto puede poner de entrega. Solo eso. El precio ya está en ARS.',
    }, historyLines);
    return { reply };
  }

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
      }, historyLines);
      return { reply };
    }
    if (creditResult.reason === 'invalid_input') {
      const reply = await composeResponse('credit_dato_invalido', { detalle: creditResult.detail }, historyLines);
      return { reply };
    }
    const reply = await composeResponse('credit_api_error', {
      nota: 'No se pudo consultar la API de crédito. Sugerir hablar con asesor para cotización real.',
    }, historyLines);
    return { reply };
  }

  const cuotasTexto = formatCreditPlans(creditResult.plans, creditResult.montoFinanciado);
  const reply = await composeResponse('mostrar_cuotas', {
    cuotas: cuotasTexto,
    auto: vehicle?.title ?? 'el vehículo',
    entrega: `ARS ${Math.round(downPayment).toLocaleString('es-AR')}`,
    nota: 'Mostrar cuotas reales. Aclarar que son estimadas y el asesor confirma. Preguntar si quiere avanzar.',
  }, historyLines);
  return { reply };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * buildHistory — construye el contexto conversacional para GPT.
 *
 * Incluye los autos mostrados en el turno anterior numerados con sus IDs,
 * para que el extractor pueda resolver referencias como "el 207", "la primera".
 */
function buildHistory(state: ConvState): string[] {
  const lines: string[] = [];
  if (state.last_query) lines.push(`Cliente buscó: ${state.last_query}`);
  if (state.last_intent) lines.push(`Última intención detectada: ${state.last_intent}`);

  if (state.last_hits_detail?.length) {
    lines.push('Opciones_mostradas en el turno anterior:');
    for (const h of state.last_hits_detail) {
      const price = h.priceNumber
        ? `${h.currency ?? 'ARS'} ${h.priceNumber.toLocaleString('es-AR')}`
        : '';
      lines.push(`  ${h.idx + 1}. ${h.name}${price ? ' — ' + price : ''} [id:${h.id}]`);
    }
  } else if (state.lastPresentedVehicleTitle) {
    lines.push(`Auto presentado: ${state.lastPresentedVehicleTitle}${state.lastPresentedVehiclePriceArs ? ' — ARS ' + state.lastPresentedVehiclePriceArs.toLocaleString('es-AR') : ''} [id:${state.lastPresentedVehicleId ?? '?'}]`);
  }

  // Contexto acumulado de búsqueda — todo lo que se sabe del lead
  const sc = state.search_context;
  if (sc) {
    const contextParts: string[] = [];
    if (sc.brand) contextParts.push(`marca: ${sc.brand}`);
    if (sc.model) contextParts.push(`modelo: ${sc.model}`);
    if (sc.bodywork) contextParts.push(`tipo: ${sc.bodywork}`);
    if (sc.minYear && sc.maxYear) contextParts.push(`año: ${sc.minYear}–${sc.maxYear}`);
    else if (sc.minYear) contextParts.push(`año desde: ${sc.minYear}`);
    else if (sc.maxYear) contextParts.push(`año hasta: ${sc.maxYear}`);
    else if (sc.year) contextParts.push(`año: ~${sc.year}`);
    if (sc.maxPrice) {
      const curr = sc.currency ?? 'ARS';
      contextParts.push(`presupuesto máx: ${curr} ${sc.maxPrice.toLocaleString('es-AR')}`);
    }
    if (sc.useCase) contextParts.push(`uso: ${sc.useCase}`);
    if (sc.transmission) contextParts.push(`caja: ${sc.transmission}`);
    if (sc.fuel) contextParts.push(`combustible: ${sc.fuel}`);
    if (sc.gnc) contextParts.push('requiere GNC');
    if ((sc as any).fuelEconomyPriority) contextParts.push('prioridad: bajo consumo');
    if (contextParts.length > 0) {
      lines.push(`Contexto del lead: ${contextParts.join(' | ')}`);
    }
  }

  return lines;
}

function summarizeState(state: ConvState): string {
  const parts: string[] = [];
  if (state.last_query) parts.push(`búsqueda: ${state.last_query}`);
  if (state.lastPresentedVehicleTitle) parts.push(`auto visto: ${state.lastPresentedVehicleTitle}`);
  if (state.leadScore) parts.push(`score: ${state.leadScore}`);
  return parts.join(' | ') || 'sin contexto previo';
}

/** Formatea el detalle completo de un auto para composeResponse.
 *  Precio siempre en ARS (convierte si viene en USD). Fuente única de verdad. */
function buildVehicleDetail(v: CatalogItem, usdRate = 0): string {
  const parts: string[] = [v.name];
  if (v.year) parts.push(String(v.year));
  if (v.isNew) parts.push('0 km');
  else if (typeof v.km === 'number') parts.push(`${Math.round(v.km).toLocaleString('es-AR')} km`);
  if (v.transmission) parts.push(v.transmission);
  if (v.fuel) parts.push(v.fuel);
  if (v.engine) parts.push(v.engine);
  if (v.color) parts.push(v.color);
  if (v.version) parts.push(v.version);
  const priceNum = priceToArs(v, usdRate);
  const priceStr = priceNum ? `ARS ${priceNum.toLocaleString('es-AR')}` : null;
  return parts.join(' · ') + (priceStr ? ` — Precio: ${priceStr}` : '');
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
    ...(ex.yearMin !== undefined ? { minYear: ex.yearMin }  : {}),
    ...(ex.yearMax !== undefined ? { maxYear: ex.yearMax }  : {}),
    ...(ex.maxPrice     ? { maxPrice: ex.maxPrice }         : {}),
    ...(ex.currency     ? { currency: ex.currency }         : {}),
    ...(ex.transmission ? { transmission: ex.transmission } : {}),
    ...(ex.fuel         ? { fuel: ex.fuel }                 : {}),
    ...(ex.bodywork     ? { bodywork: ex.bodywork }         : {}),
    ...(ex.gnc !== undefined ? { gnc: ex.gnc }              : {}),
    ...(ex.useCase      ? { useCase: ex.useCase }           : {}),
    ...(ex.name         ? { name: ex.name }                 : {}),
    ...(ex.fuelEconomyPriority !== undefined ? { fuelEconomyPriority: ex.fuelEconomyPriority } : {}),
  } as ConvState['search_context'];
}
