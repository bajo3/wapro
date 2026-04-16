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

import { getCatalog, formatItemLine } from './catalog.js';
import { getUsdToArs } from './exchangeRate.js';
import { askGPT } from './gpt.js';
import { getCreditQuote, formatCreditPlans } from './creditService.js';
import { detectHotLead, notifyHotLead } from './hotLead.js';
import type { ConvState } from './state.js';
import type { CatalogItem } from './catalog.js';

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

const EXTRACTION_PROMPT = `Sos un extractor de datos para un bot de ventas de autos.
Dado un mensaje de WhatsApp y el contexto previo, devolvé SOLO un JSON con estos campos (omití los que no apliquen):
{
  "intent": "search|catalog|credit_quote|trade_in|advisor|visit|specific|refine|alternatives|reset|greeting|farewell|complaint|unsure|other",
  "brand": string,
  "model": string,
  "year": number,
  "yearMin": number,
  "yearMax": number,
  "maxPrice": number,
  "currency": "ARS"|"USD",
  "downPayment": number,
  "transmission": "manual"|"automático",
  "fuel": string,
  "bodywork": "suv"|"pickup"|"sedan"|"hatch"|"familiar"|"furgon"|"coupe",
  "useCase": string,
  "isNew": boolean,
  "gnc": boolean,
  "fuelEconomyPriority": boolean,
  "wantsVisit": boolean,
  "wantsAdvisor": boolean,
  "urgency": "low"|"high",
  "name": string,
  "selectedVehicleId": string,
  "leadMode": "decided"|"exploratory"|"hot"|"price_sensitive"|"lost",
  "needsClarification": boolean,
  "confidence": "high"|"medium"|"low"
}

REGLAS DE INTENT:
- Si el mensaje menciona "entrega" o "anticipo" seguido de un número → eso es downPayment
- Si menciona "cuotas", "financiar", "banco", "crédito" → intent = credit_quote
- Si menciona "quiero verlo", "puedo ir", "test drive" → wantsVisit = true
- Si menciona "asesor", "humano", "persona", "hablar con alguien" → wantsAdvisor = true
- Si dice "cambio", "tengo un usado", "lo entrego" → intent = trade_in
- Si cambia completamente de búsqueda → intent = reset
- Si pide ver el catálogo, todas las opciones, todos los autos, qué tienen disponible (sin filtro específico) → intent = catalog
- Si dice "chau", "gracias", "lo pienso" → intent = farewell
- Si está enojado, reclama, insulta → intent = complaint
- Si es un saludo (hola, buenas, buen día, etc.) → intent = greeting, siempre, independientemente del historial
- Si "no sé qué quiero", "qué me recomendás", "qué me recomendarías", "qué me conviene" → intent = unsure
- maxPrice: si dice "hasta X" o "con X" o "por X" → eso es el tope
- Si hay opciones_mostradas en el contexto Y el cliente hace referencia a una por número ordinal
  ("el primero", "el 2", "ese", "esa blanca", "el de 17", "la primera opción") → resolver cuál
  es y poner su id en selectedVehicleId. El intent en ese caso es "specific".

REGLAS DE leadMode:
- "decided" → el cliente sabe exactamente qué quiere: tiene marca o modelo o presupuesto claro. Ej: "busco un Cronos 2023", "quiero un 0km automático hasta $20M"
- "exploratory" → el cliente anda viendo, sin filtros claros, sin urgencia. Ej: "ando viendo", "estoy mirando opciones", "algo para la familia", "algo cómodo", "no sé bien todavía"
- "hot" → hay señal de cierre o urgencia real. Ej: "lo quiero esta semana", "ya hablé con el banco", "tengo el dinero listo", "quiero ir a verlo ya"
- "price_sensitive" → el precio es la preocupación principal. Ej: "me parece caro", "no llego al presupuesto", "algo más barato", "tengo poco presupuesto"
- "lost" → el mensaje es incomprensible, cambia de tema sin contexto, o el intent no se pudo determinar con seguridad

REGLAS DE needsClarification:
- true si el mensaje es ambiguo y no hay suficiente información para buscar autos concretos
- true si leadMode es "exploratory" o "lost" y no hay ningún filtro usable (marca/modelo/presupuesto/tipo)
- true si el intent es "unsure" sin contexto previo de búsqueda
- false si ya hay filtros suficientes para hacer una búsqueda útil (aunque no sea perfecta)
- Cuando es true: el bot debe hacer UNA SOLA pregunta, no un formulario

REGLAS DE confidence:
- "high" → el mensaje es claro, intent inequívoco, campos bien extraídos
- "medium" → intent razonable pero falta algún campo clave para actuar (ej: tiene marca pero no presupuesto)
- "low" → mensaje vago, múltiples interpretaciones posibles, no hay filtros claros

CASOS ESPECIALES:
- "ando viendo" → intent=unsure, leadMode=exploratory, needsClarification=true, confidence=low
- "algo para la familia" → intent=search, bodywork=familiar (o SUV si no hay más), leadMode=exploratory, needsClarification=true (falta presupuesto), confidence=medium
- "algo cómodo" → intent=unsure, leadMode=exploratory, needsClarification=true, confidence=low
- "no sé bien todavía" → intent=unsure, leadMode=exploratory, needsClarification=true, confidence=low
- "qué me recomendás?" → intent=unsure, leadMode=exploratory, needsClarification=false si hay contexto previo, confidence=medium
- "tomarias mi usado?" / "tengo para entregar" → intent=trade_in, leadMode=decided, confidence=high
- "cuotas?" / "me financian?" → intent=credit_quote, leadMode=decided, confidence=high
- "lo mínimo" / "mínimo" / "la menor" / "sin entrada" / "lo más chico" → cuando el contexto muestra que el bot acaba de preguntar por entrega/anticipo → intent=credit_quote, confidence=high
- "con cuánto entro?" / "cuánto de entrega?" / "cuánto de anticipo?" → intent=credit_quote, confidence=high

REGLAS DE AÑO Y RANGO:
- "del 2014 al 2018", "entre 2014 y 2018", "años 2014 a 2018" → yearMin=2014, yearMax=2018 (NO setear year)
- "del 2016 en adelante", "desde 2016", "más nuevo que 2015" → yearMin=2016
- "hasta 2020", "no más viejo que 2020" → yearMax=2020
- Si solo hay UN año mencionado → year=X (sin yearMin/yearMax)
- NUNCA setear yearMin Y year al mismo tiempo si hay un rango claro

REGLAS DE CARROCERÍA EXTENDIDAS:
- "camioneta", "pick up", "pickup", "doble cabina" → bodywork=pickup
- "utilitario", "furgón", "furgon", "cargo" → bodywork=furgon
- "auto chico", "chiquito", "compacto", "pequeño" → bodywork=hatch, fuelEconomyPriority=true
- "crossover", "4x4", "todoterreno" → bodywork=suv
- "familiar" → bodywork=familiar
- "monovolumen", "minivan", "van" → bodywork=monovolumen

REGLAS DE ECONOMÍA DE COMBUSTIBLE (fuelEconomyPriority):
- "que gaste poco", "bajo consumo", "ahorrador", "económico en nafta", "poco consumo", "que no consuma tanto" → fuelEconomyPriority=true
- "auto chico", "compacto", "pequeño" → fuelEconomyPriority=true (además de bodywork=hatch)
- Cuando fuelEconomyPriority=true, el sistema EXCLUIRÁ automáticamente pickup, furgon, utilitario, monovolumen

IMPORTANTE — NO clasificar como catalog ni search cuando:
- El mensaje es corto y vago ("lo mínimo", "mínimo", "entrega?") Y el contexto previo muestra una conversación activa sobre un auto puntual o financiación.
- En esos casos, mantener el intent credit_quote o specific. NO reiniciar contexto.

Devolvé SOLO el JSON, sin texto extra.`;

async function extractIntent(message: string, historyLines: string[]): Promise<Extracted> {
  const historyContext = historyLines.slice(-6).join('\n');
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

    // Carrocería: intentar inferir si no está seteada en el ítem, luego aplicar filtro duro
    if (bodywork) {
      const effectiveBw = quickInferBodywork(item);
      if (effectiveBw) {
        // Si el ítem tiene (o se infirió) carrocería: debe coincidir
        if (!effectiveBw.includes(bodywork)) return false;
      } else {
        // Ítem sin carrocería detectable: para tipos estrictos (pickup/furgon/suv) excluir
        // Para tipos sueltos (sedan/hatch/familiar) dejar pasar (beneficio de la duda)
        if (_STRICT_BODY_TYPES.has(bodywork)) return false;
      }
    }

    // Exclusión dura por economía: "gaste poco" / "auto chico" → fuera pickup, furgon, etc.
    if (fuelEconomyPriority) {
      const effectiveBw = quickInferBodywork(item);
      if (effectiveBw && _LARGE_BODY_TYPES.has(effectiveBw)) return false;
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
function detectCatalogSelection(message: string): number | null {
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

function detectFinancingFollowup(message: string): boolean {
  return FINANCE_FOLLOWUP_RE.test(message.trim());
}

// ── Detección rápida de reset/catálogo (sin GPT) ─────────────────────────────
// Frases que siempre reinician contexto, independientemente de lo que GPT clasifique.
const RESET_RE = /^(hola+|buen[ao]s?(\s*(d[ií]as?|tardes?|noches?))?|arrancamos?\s*de\s*nuevo|empecemos?\s*de\s*nuevo|quiero\s*ver\s*otra\s*cosa|busco\s*otra\s*cosa|estoy\s*buscando\s*otra\s*cosa|cambio\s*de\s*b[uú]squeda)[\s!?.]*$/i;
const CATALOG_RE = /mostrame?\s*(el\s*)?cat[aá]logo|me\s*pod[eé]s?\s*mostrar\s*(el\s*)?cat[aá]logo|que\s*(autos?|veh[ií]culos?|opciones?)\s*(ten[eé]s?|hay|tienen?)|pasame?\s*(el\s*)?cat[aá]logo|quiero\s*ver\s*(las?\s*)?opciones?|qu[eé]\s*(tienen?|tenes?\s*disponible)/i;
const CATALOG_MORE_RE = /m[aá]s\s*opciones|mostrame?\s*m[aá]s|segu[ií]|que\s*m[aá]s\s*(ten[eé]s?|hay)|otros?\s*(autos?|veh[ií]culos?)|ver\s*m[aá]s|m[aá]s\s*autos?/i;

const CATALOG_PAGE_SIZE = 10;

function detectResetOrCatalog(message: string): 'reset' | 'catalog' | 'catalog_more' | null {
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

const RESPONSE_SYSTEM = `Sos el asistente de ventas de una concesionaria de autos en Argentina.
Tu objetivo es avanzar la venta. No solo contestar.

TONO: directo, argentino, comercial. Ni robot ni chamuyo.
- Respuestas cortas (2-4 líneas en general, nunca más de 6).
- Sin frases vacías: nada de "¡Con gusto!", "Acá estoy para ayudarte", "Gracias por tu consulta", "Como asistente virtual", "Te comparto".
- Sin listas de más de 5 ítems.
- Cerrá siempre con una pregunta o acción concreta.
- Usá "vos" no "usted".

REGLAS DURAS:
- Nunca inventar precio, stock, cuotas ni disponibilidad.
- Nunca usar datos que no estén en el contexto que te pasan.
- Si no tenés el dato, decilo y ofrecé el siguiente paso.
- No mandes links de MercadoLibre como respuesta principal.
- No repitas preguntas que el cliente ya respondió.

POR ACCIÓN:
mostrar_resultados → Listá las opciones con nombre, año y precio. Sin texto de relleno antes. Cerrá preguntando cuál le interesa o si quiere fotos/cuotas de alguno.
mostrar_auto_puntual → Describí ese auto con lo que tenés (precio, año, km, motor, color si hay). Decí que te mandás fotos. Preguntá si quiere verlo o calcular cuotas.
sin_match → Decí que no tenés exactamente eso. Ofrecé la alternativa más cercana si la hay. No inventes.
derivar_humano → Decí que lo pasás con alguien del equipo. No sigas vendiendo.
credit_sin_auto → Preguntá sobre qué auto calculamos. Solo eso.
credit_sin_entrega → Preguntá cuánto pone de entrega. Solo eso.
entrega_minima → El cliente pregunta por la entrega mínima pero no hay datos del banco. NO inventés ningún número. Decí que la entrega mínima depende del banco y del plan, y que lo confirma el asesor. Ofrecé pasarlo con alguien del equipo para que le den el número real. Breve, máximo 2 líneas.
mostrar_cuotas → Mostrá los planes de cuotas reales. Aclará que son estimados y que el asesor confirma el número final. Preguntá si quiere avanzar.
permuta → Pedí modelo, año y km del usado. No des valuación. Decí que lo evalúa el equipo.
coordinar_visita → Decí que lo pasás con el equipo para coordinar. No des horarios si no los tenés.
saludo_inicial → Saludá breve. Preguntá qué está buscando o cuál es su presupuesto.
saludo_retorno → El cliente vuelve a saludar con conversación previa. Retomá fresco sin mencionar lo anterior. Preguntá qué está buscando ahora.
catalogo_general → Mostrá las opciones disponibles. Cerrá con UNA pregunta de navegación (marca, tipo o presupuesto). No hagas lista de más de 5.
cambio_de_busqueda → El cliente quiere buscar otra cosa. Confirmá que arrancás de cero. Preguntá qué busca ahora.
despedida → Cierre cálido, muy breve. Sin nueva pregunta comercial.
indeciso_sin_contexto → UNA sola pregunta: para qué lo usa y cuánto tiene pensado gastar.
modo_exploratorio → El cliente anda viendo sin saber bien qué quiere. No lo interrogues ni le tires el catálogo. Hacé UNA pregunta suave que lo oriente: uso principal O presupuesto aproximado. Tono abierto, sin presión.
reclamo → Empatía breve + derivar a asesor. No intentes resolver.
consulta_general → Respondé con lo que tenés disponible en el contexto. Sé concreto.

FRASES QUE SÍ:
- "Bien, hoy tengo estas opciones:"
- "Dale, de ese te paso más detalle."
- "Ese lo tengo así:"
- "Si querés te mando fotos de ese."
- "¿Cuánto ponés de entrega para calcular bien?"
- "¿Ese te cierra o preferís ver otro?"
- "Lo paso con alguien del equipo para coordinar."
- "¿Para qué lo vas a usar principalmente?"

FRASES PROHIBIDAS:
"Estoy aquí para ayudarte" / "Te comparto la siguiente información" / "Como asistente virtual"
"Gracias por tu consulta" / "¡Con gusto!" / "Aquí tienes" / "¡Perfecto!" / "¡Claro que sí!"

EJEMPLOS FEW-SHOT:
ENTRADA: mostrar_resultados con 3 autos
SALIDA: "Bien, hoy tengo estas opciones:\n1. Cronos 2023 — ARS 18.500.000 (0 km · manual · nafta)\n2. Onix Plus 2022 — ARS 16.800.000 (45.000 km · manual · nafta)\n3. Corsa Classic 2015 — ARS 9.200.000 (82.000 km · manual · nafta)\n¿Cuál te interesa más? Te paso fotos y detalle del que elijas."

ENTRADA: mostrar_auto_puntual
SALIDA: "Ese lo tengo así: [nombre], [año], [km], [motor/combustible]. Precio: [precio]. Te mando las fotos. ¿Querés calcular cuotas o coordinar una visita?"

ENTRADA: derivar_humano
SALIDA: "Dale, te paso con alguien del equipo que te atiende directo."

ENTRADA: credit_sin_entrega para un auto de $20M
SALIDA: "Para el [auto] a $20.000.000, ¿cuánto ponés de entrega? Con eso te calculo los planes."

ENTRADA: despedida
SALIDA: "Dale, cualquier duda estamos. ¡Éxitos!"

ENTRADA: indeciso_sin_contexto
SALIDA: "Para ayudarte bien: ¿para qué lo vas a usar y cuánto tenés pensado gastar?"

ENTRADA: modo_exploratorio (cliente dijo "ando viendo")
SALIDA: "Dale, sin apuro. ¿Tenés algún tipo de auto en mente o un presupuesto aproximado? Así te oriento mejor."

ENTRADA: modo_exploratorio (cliente dijo "algo para la familia")
SALIDA: "Entendido. ¿Tenés un presupuesto aproximado? Con eso te filtro las mejores opciones familiares que tengo."

ENTRADA: modo_exploratorio (cliente dijo "no sé bien todavía")
SALIDA: "No hay drama. ¿Lo buscás para uso diario, familia, trabajo? Con eso ya te puedo dar una orientación."

ENTRADA: mostrar_resultados con needsClarification (filtros parciales, falta presupuesto)
SALIDA: "Bien, hoy tengo estas opciones:\n[lista]\n¿Alguna te interesa? Si me decís el presupuesto aproximado te puedo afinar más."`;

async function composeResponse(action: string, data: Record<string, any>, historyLines: string[]): Promise<string> {
  const historyCtx = historyLines.slice(-6).join('\n');
  const userMessage = `Acción: ${action}\nDatos:\n${JSON.stringify(data, null, 2)}${historyCtx ? `\n\nContexto conversación:\n${historyCtx}` : ''}`;

  const reply = await askGPT({
    systemPrompt: RESPONSE_SYSTEM,
    userMessage,
    maxTokens: 400,
    temperature: 0.65,
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
  const isAmbiguousOverride =
    hasActiveVehicle &&
    !hasExplicitReset &&
    ['catalog', 'reset', 'search', 'unsure'].includes(extracted.intent) &&
    !extracted.brand && !extracted.model &&
    (extracted.confidence === 'low' || !extracted.confidence);

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

  // Catalog offset: reset si es catálogo nuevo, conservar si es "más opciones"
  let effectiveState = state;
  if (extracted.intent === 'catalog') {
    const isCatalogMore = fastOverride === 'catalog_more';
    if (!isCatalogMore) {
      // Fresh catalog request — always start from page 0
      effectiveState = { ...state, catalog_offset: 0 };
    }
    // catalog_more: mantener state.catalog_offset tal como está
  }

  // 4. Decidir y responder
  const result = await decide(extracted, effectiveState, message, historyLines);

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

  if (isContextReset) {
    // Limpiar TODO el contexto previo — vehículo enfocado, hits, filtros, query
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
    // Persist catalog offset from this catalog response (or reset on greeting/reset)
    if (extracted.intent === 'catalog') {
      newState.catalog_offset = result.nextCatalogOffset ?? 0;
    } else {
      newState.catalog_offset = 0;
    }
    console.info(`[bot] previous_context_cleared=true reason=${extracted.intent} response_mode=${extracted.intent === 'catalog' ? 'catalog' : extracted.intent === 'greeting' ? 'greeting' : 'reset'}`);
  } else if (['search', 'refine', 'unsure'].includes(extracted.intent)) {
    newState.search_context = mergeSearchContext(state.search_context, extracted);
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

  // Guardar snapshot exacto del catálogo mostrado (índices 1-based para el usuario)
  const hitsDetail: NonNullable<ConvState['last_hits_detail']> = page.map((v, i) => ({
    idx: i,
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    priceNumber: v.priceNumber,
    currency: v.currency,
    images: v.images,
  }));

  console.info(`[catalog] presented options saved count=${page.length} ids=[${page.map(v => v.id).join(',')}]`);
  page.forEach((v, i) => console.info(`[catalog] option ${i + 1} vehicleId=${v.id}`));

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
  if (ex.intent === 'greeting') {
    const action = state.last_intent ? 'saludo_retorno' : 'saludo_inicial';
    const reply = await composeResponse(action, {}, historyLines);
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

  if (!vehicle) {
    // El ID del estado ya no existe en el catálogo (puede haberse vendido)
    const { rate: usdRateAlt } = await getUsdToArs();
    const reply = await composeResponse('sin_match', {
      busqueda: { id: vehicleId },
      nota: 'El auto referenciado ya no está disponible. Ofrecer alternativas.',
      alternativas: catalog.filter(i => i.inStock).slice(0, 3).map((v, i) => formatItemLine(v, i, usdRateAlt)).join('\n'),
    }, historyLines);
    return { reply };
  }

  const lineDetalle = buildVehicleDetail(vehicle);
  const reply = await composeResponse('mostrar_auto_puntual', {
    auto: lineDetalle,
    nota: 'Describí este auto puntual. Mencioná que enviás las fotos. Preguntá si quiere verlo o calcular cuotas.',
  }, historyLines);

  return {
    reply,
    presentedVehicle: vehicle,
    imagesToSend: vehicle.images?.slice(0, 5) ?? (vehicle.image ? [vehicle.image] : []),
  };
}

// ── Handler: búsqueda ──────────────────────────────────────────────────────────

async function handleSearch(ex: Extracted, state: ConvState, historyLines: string[]): Promise<DecideResult> {
  const catalog = await getCatalog();
  const hits = filterCatalog(catalog, { ...ex, search_context: state.search_context });
  const { rate: usdRate } = await getUsdToArs();

  if (hits.length === 0) {
    const alternatives = catalog.filter(i => i.inStock).slice(0, 3);
    const altLines = alternatives.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');
    const reply = await composeResponse('sin_match', {
      busqueda: ex,
      alternativas: altLines || 'No hay stock disponible en este momento.',
      nota: 'Decir que no hay match exacto. Ofrecer alternativas sin mentir.',
    }, historyLines);
    return { reply };
  }

  // Si es un solo resultado, tratarlo como auto puntual
  if (hits.length === 1) {
    const vehicle = hits[0];
    const lineDetalle = buildVehicleDetail(vehicle);
    const reply = await composeResponse('mostrar_auto_puntual', {
      auto: lineDetalle,
      nota: 'Solo hay un resultado. Presentarlo bien. Preguntar si quiere fotos, cuotas o verlo.',
    }, historyLines);
    return {
      reply,
      hitIds: [vehicle.id],
      hitsDetail: [{ idx: 0, id: vehicle.id, name: vehicle.name, brand: vehicle.brand, model: vehicle.model, priceNumber: vehicle.priceNumber, currency: vehicle.currency, images: vehicle.images }],
      presentedVehicle: vehicle,
      imagesToSend: vehicle.images?.slice(0, 5) ?? (vehicle.image ? [vehicle.image] : []),
    };
  }

  const hitLines = hits.map((v, i) => formatItemLine(v, i, usdRate)).join('\n');

  // Construir nota según contexto del lead
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
  }, historyLines);

  const hitsDetail: ConvState['last_hits_detail'] = hits.map((v, i) => ({
    idx: i,
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    priceNumber: v.priceNumber,
    currency: v.currency,
    images: v.images,
  }));

  console.info(`[catalog] snapshotSaved=true count=${hits.length} ids=[${hits.map(h => h.id).join(',')}]`);
  hits.forEach((v, i) => console.info(`[catalog] option ${i + 1} vehicleId=${v.id} name="${v.name}"`));

  return {
    reply,
    hitIds: hits.map(h => h.id),
    hitsDetail,
    presentedVehicle: hits[0],
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
    const reply = await composeResponse('credit_sin_entrega', {
      auto: vehicle?.title ?? 'el auto seleccionado',
      precio: `${vehicle?.price ? (vehicle.price > 10000 ? 'ARS' : 'USD') : 'ARS'} ${Math.round(vehiclePrice).toLocaleString('es-AR')}`,
      nota: 'Preguntar cuánto puede poner de entrega. Solo eso.',
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

/** Formatea el detalle completo de un auto para composeResponse */
function buildVehicleDetail(v: CatalogItem): string {
  const parts: string[] = [v.name];
  if (v.year) parts.push(String(v.year));
  if (v.isNew) parts.push('0 km');
  else if (typeof v.km === 'number') parts.push(`${Math.round(v.km).toLocaleString('es-AR')} km`);
  if (v.transmission) parts.push(v.transmission);
  if (v.fuel) parts.push(v.fuel);
  if (v.engine) parts.push(v.engine);
  if (v.color) parts.push(v.color);
  if (v.version) parts.push(v.version);
  const priceStr = v.priceNumber
    ? `${v.currency ?? 'ARS'} ${v.priceNumber.toLocaleString('es-AR')}`
    : null;
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
