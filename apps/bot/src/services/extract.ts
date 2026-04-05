/**
 * extract.ts — Extracción estructurada de campos desde texto libre en español.
 *
 * Mejoras v4:
 *  - parseMoney: detecta "30m", "30" en contexto de presupuesto, typos comunes
 *    ("pesod", "millon" sin tilde), rangos "entre X y Y millones"
 *  - extractLeadFields: maxPrice = amount por defecto (cualquier mención de
 *    precio es un techo implícito si no había uno previo)
 *  - formatMoney / buildConfirmationPhrase: helpers para confirmación visual
 *  - hasUsefulData(): saber si hay suficiente contexto acumulado
 *  - Nuevos alias de marcas (typos frecuentes)
 *  - Intención implícita: "algo para trabajar" → pickup/utilitario,
 *    "algo económico" / "económico de mantener" → gnc/diesel implícito,
 *    "no muy grande" / "chico" / "compacto" → bodywork compacto
 *  - Variantes 0km/usado: "sin rodar", "nuevo", "de segunda", "de uso", "con km"
 *  - Permuta/canje mejorado: "cambio", "te doy el mío", "mi auto como parte"
 *  - Financiación: "con cuotas", "en cuotas", "con crédito", "banco", "anticipo"
 *  - detectShowIntent(): detecta cuando el cliente pide VER opciones directamente
 *  - detectClosingIntent(): detecta señales de cierre / avance concreto
 *  - detectRangeExpansion(): detecta "algo mejor por un poco más"
 */

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function stripSep(s: string): string {
  return s.replace(/[.,\s]/g, '');
}

// ─── Parsers atómicos ──────────────────────────────────────────────────────────

function parseYear(text: string): number | null {
  const t = norm(text);
  const m = t.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1960 && y <= 2030 ? y : null;
}

function parseYearRange(text: string): { minYear?: number; maxYear?: number } {
  const t = norm(text);
  const out: { minYear?: number; maxYear?: number } = {};

  const range = t.match(/\b(?:entre|del?)\s*(20\d{2}|19\d{2})\s*(?:y|al?)\s*(20\d{2}|19\d{2})\b/);
  if (range) { out.minYear = Number(range[1]); out.maxYear = Number(range[2]); return out; }

  const since = t.match(/\b(?:del?|desde)\s*(20\d{2}|19\d{2})\s*(?:en\s+adelante|para\s+arriba)?/);
  if (since) { out.minYear = Number(since[1]); return out; }

  const until = t.match(/\b(?:hasta|no\s+m[aá]s\s+de)\s*(?:el\s+)?(20\d{2}|19\d{2})\b/);
  if (until) { out.maxYear = Number(until[1]); return out; }

  const single = parseYear(text);
  if (single) { out.minYear = single; out.maxYear = single; }
  return out;
}

function parseKm(text: string): number | null {
  const t = norm(text);
  if (/\b(?:cero\s*km|0\s*km|okm|0km)\b/.test(t)) return 0;
  const mil = t.match(/\b(\d{2,3})\s*(?:mil|k)\b/);
  if (mil) return Number(mil[1]) * 1000;
  const dotted = t.match(/\b(\d{1,3}(?:[.,]\d{3})+)\s*(?:km|kms)?\b/);
  if (dotted) return Number(stripSep(dotted[1]));
  const plain = t.match(/\b(\d{4,6})\s*(?:km|kms)\b/);
  if (plain) return Number(plain[1]);
  return null;
}

/**
 * parseMoney — v4:
 * - "entre X y Y millones" → toma el mayor como techo
 * - "13m" / "800k" shorthand de millones/miles (pegados al número)
 * - typos: "millon", "palos", "kilos"
 * - "medio millon" / "media palo" → 500.000
 * - "0.8 millones" / "1.5 palos" → decimales
 * - contexto de presupuesto: "tengo 30" → 30 millones
 * - "800" suelto con contexto vehicular → 800.000 (ARS miles) o 800 (USD)
 */
export function parseMoney(text: string): { amount: number; currency: 'ARS' | 'USD' } | null {
  const t = norm(text);
  const isUSD = /\b(?:dolares?|usd|u\$s|u\$d|\$u|verdes?|dolar)\b/.test(t);
  const currency: 'ARS' | 'USD' = isUSD ? 'USD' : 'ARS';

  // Rango: "entre X y Y millones" → usar el mayor como techo
  const range = t.match(/\bentre\s+(\d+(?:[.,]\d+)?)\s+y\s+(\d+(?:[.,]\d+)?)\s*(?:mill?(?:ones?)?|m|palos?)\b/);
  if (range) {
    const cap = Math.max(Number(range[1].replace(',', '.')), Number(range[2].replace(',', '.')));
    return { amount: Math.round(cap * 1_000_000), currency };
  }

  // "medio millon" / "media palo" → 500.000
  if (/\bmedio\s+mill?(?:ones?)?|media\s+palo\b/.test(t)) return { amount: 500_000, currency };

  // "13 palos" / "1.5 palos" — ARS coloquial
  const palos = t.match(/\b(\d+(?:[.,]\d+)?)\s*palos?\b/);
  if (palos) return { amount: Math.round(Number(palos[1].replace(',', '.')) * 1_000_000), currency: 'ARS' };

  // "13 millones" / "13 mill" / "0.8 millones" (con espacio)
  const mill = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mill?(?:ones?)?|millon(?:es)?)\b/);
  if (mill) return { amount: Math.round(Number(mill[1].replace(',', '.')) * 1_000_000), currency };

  // "13m" shorthand pegado: solo si la m está pegada al número sin espacio
  const mShort = t.match(/\b(\d+(?:[.,]\d+)?)m\b/);
  if (mShort) {
    const n = Number(mShort[1].replace(',', '.'));
    if (n >= 1 && n <= 999) return { amount: Math.round(n * 1_000_000), currency };
  }

  // "800 mil" / "1500 kilos"
  const miles = t.match(/\b(\d{3,4})\s*(?:mil|kilos?)\b/);
  if (miles) { const n = Number(miles[1]) * 1000; if (n > 50_000) return { amount: n, currency }; }

  // "800k" shorthand de miles (k pegado al número)
  const kShort = t.match(/\b(\d{3,4})k\b/);
  if (kShort) { const n = Number(kShort[1]) * 1000; if (n > 50_000) return { amount: n, currency }; }

  // "$ 13.800.000"
  const pesos = t.match(/\$\s*([0-9.,]+)/);
  if (pesos) { const n = Number(stripSep(pesos[1])); if (Number.isFinite(n) && n > 0) return { amount: n, currency }; }

  // Plain big number (7+ digits)
  const big = t.match(/\b(\d{7,12})\b/);
  if (big) return { amount: Number(big[1]), currency };

  // Número suelto con contexto de presupuesto → asumir millones
  const budgetCtx = /\b(?:presupuesto|plata|guita|hasta|maximo?|dispongo|tengo|cuento\s+con)\b/i.test(t);
  if (budgetCtx) {
    const loose = t.match(/\b(\d{1,4})\b/);
    if (loose) {
      const n = Number(loose[1]);
      if (n >= 5 && n <= 9999) return { amount: n * 1_000_000, currency };
    }
  }

  // "800" con contexto vehicular explícito → 800k ARS o 800 USD
  const vehicleCtx = /\b(?:auto|coche|carro|vehiculo|0\s*km|usado|precio|vale|cuesta|oferta|busco)\b/i.test(t);
  if (vehicleCtx) {
    const midNum = t.match(/\b(\d{3,4})\b/);
    if (midNum) {
      const n = Number(midNum[1]);
      if (n >= 100 && n <= 9999) {
        // USD: dejar el número tal cual (800 USD = 800)
        // ARS: interpretar como miles (800 ARS → 800.000)
        return { amount: isUSD ? n : n * 1_000, currency };
      }
    }
  }

  return null;
}

function parsePercent(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\s*%/);
  if (!m) return null;
  const p = Number(m[1]);
  return p >= 1 && p <= 99 ? p : null;
}

function parseCuotas(text: string): number | null {
  const t = norm(text);
  const m = t.match(/\b(\d{1,3})\s*(?:cuotas?|meses?|pagos?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 240 ? n : null;
}

// ─── Diccionarios ──────────────────────────────────────────────────────────────

const BRAND_MODELS: Record<string, string[]> = {
  toyota: ['corolla', 'hilux', 'etios', 'yaris', 'rav4', 'sw4', 'prius', 'rush', 'fortuner', 'camry', 'landcruiser'],
  volkswagen: ['gol', 'polo', 'golf', 'amarok', 'saveiro', 'suran', 'up', 'vento', 'tiguan', 'touareg', 'virtus', 'taos', 'nivus', 'tcross'],
  ford: ['ranger', 'ecosport', 'focus', 'fiesta', 'mustang', 'kuga', 'bronco', 'maverick', 'f150', 'territory', 'edge'],
  chevrolet: ['onix', 'cruze', 'tracker', 'trax', 's10', 'captiva', 'cobalt', 'spin', 'montana', 'agile', 'corsa', 'meriva'],
  renault: ['duster', 'sandero', 'logan', 'kwid', 'stepway', 'symbol', 'koleos', 'captur', 'clio', 'kangoo', 'megane', 'arkana'],
  fiat: ['cronos', 'argo', 'pulse', 'toro', 'strada', 'mobi', 'palio', 'siena', 'bravo', 'punto', 'uno', 'doblo', 'linea'],
  peugeot: ['208', '308', '408', '508', '2008', '3008', '5008', 'partner', 'expert', 'boxer'],
  citroen: ['c3', 'c4', 'c5', 'berlingo', 'jumpy', 'picasso', 'ds3', 'ds4'],
  honda: ['civic', 'hrv', 'crv', 'fit', 'jazz', 'city', 'accord', 'pilot'],
  nissan: ['frontier', 'kicks', 'versa', 'sentra', 'tiida', 'xtrail', 'murano', 'pathfinder'],
  jeep: ['renegade', 'compass', 'cherokee', 'wrangler', 'gladiator', 'commander'],
  hyundai: ['tucson', 'creta', 'accent', 'i20', 'i30', 'ioniq', 'elantra', 'santa fe', 'kona'],
  kia: ['sportage', 'sorento', 'cerato', 'rio', 'seltos', 'stinger', 'niro'],
  mitsubishi: ['l200', 'outlander', 'eclipse', 'pajero', 'asx', 'montero'],
  suzuki: ['vitara', 'swift', 'jimny', 'sx4'],
  mazda: ['cx5', 'cx3', 'cx30', 'mazda3', 'mazda6', 'bt50'],
  subaru: ['impreza', 'forester', 'outback', 'xv', 'legacy', 'brz'],
  bmw: ['320', '330', '118', '120', 'x1', 'x3', 'x5', 'x6', 'm3', 'm5'],
  mercedes: ['c200', 'c300', 'e300', 'a200', 'gla', 'glc', 'gle', 'sprinter', 'vito'],
  audi: ['a3', 'a4', 'a6', 'q3', 'q5', 'q7', 'tt'],
  ram: ['700', '1500', '2500', 'rampage', 'promaster'],
  dodge: ['journey', 'durango', 'charger', 'challenger'],
  chery: ['tiggo', 'arrizo'],
  byd: ['f3', 'tang', 'song', 'atto', 'seal', 'dolphin'],
  mg: ['hs', 'zs', 'rx5', 'rx8'],
  geely: ['emgrand', 'coolray', 'azkarra'],
  haval: ['h6', 'jolion', 'h2'],
  tesla: ['model3', 'modely', 'modelx', 'models']
};

const BRAND_ALIASES: Record<string, string> = {
  vw: 'volkswagen', volk: 'volkswagen', wolks: 'volkswagen', wolksvagen: 'volkswagen',
  chevy: 'chevrolet', chevi: 'chevrolet',
  merc: 'mercedes', merche: 'mercedes', benz: 'mercedes',
  'land rover': 'landrover', landrover: 'landrover',
  toyo: 'toyota', toyot: 'toyota',
  renol: 'renault', renou: 'renault',
  pejo: 'peugeot', peugot: 'peugeot', pejeot: 'peugeot',
  citro: 'citroen', sitro: 'citroen',
  hiunday: 'hyundai', hundai: 'hyundai'
};

const COLORS = [
  'blanco', 'negro', 'rojo', 'azul', 'gris', 'plata', 'plateado',
  'verde', 'amarillo', 'naranja', 'bordo', 'marron', 'cafe',
  'celeste', 'beige', 'champagne', 'perla', 'blanco perla'
];

const FUEL_MAP: Record<string, string> = {
  nafta: 'nafta', gasolina: 'nafta', naftero: 'nafta',
  diesel: 'diesel', gasoil: 'diesel', turbodiesel: 'diesel',
  gnc: 'gnc',
  hibrido: 'hibrido', hybrid: 'hibrido',
  electrico: 'electrico', ev: 'electrico'
};

const TRANSMISSION_MAP: Record<string, string> = {
  'caja manual': 'manual', manual: 'manual', sincronico: 'manual', 'a palanca': 'manual',
  automatica: 'automatico', automatico: 'automatico',
  tiptronic: 'automatico', dsg: 'automatico', cvt: 'automatico', 'caja automatica': 'automatico'
};

const USE_CASE_MAP: Record<string, string> = {
  remis: 'remis', taxi: 'remis', uber: 'remis', cabify: 'remis',
  familia: 'familiar', familiar: 'familiar',
  trabajo: 'trabajo', laburo: 'trabajo',
  campo: 'campo', rural: 'campo', offroad: 'campo',
  ciudad: 'city', city: 'city',
  ruta: 'viaje', viaje: 'viaje',
  reparto: 'reparto', delivery: 'reparto', carga: 'reparto'
};

const CITY_LIST = [
  'tandil', 'mar del plata', 'balcarce', 'azul', 'olavarria',
  'necochea', 'benito juarez', 'quequen', 'miramar',
  'tres arroyos', 'pinamar', 'villa gesell', 'buenos aires', 'rosario',
  'cordoba', 'mendoza', 'santa fe', 'la plata', 'bahia blanca',
  'loberia', 'gonzalez chaves'
];

// ─── Detectores ───────────────────────────────────────────────────────────────

function detectBrandModel(text: string): { brand?: string; model?: string } {
  const t = norm(text);
  const out: { brand?: string; model?: string } = {};

  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (t.includes(norm(alias))) { out.brand = canonical; break; }
  }

  for (const brand of Object.keys(BRAND_MODELS)) {
    if (!out.brand && t.includes(norm(brand.replace('_', ' ')))) out.brand = brand;
    for (const model of BRAND_MODELS[brand]) {
      if (t.includes(norm(model))) {
        out.model = model;
        if (!out.brand) out.brand = brand;
        return out;
      }
    }
  }
  return out;
}

function detectColor(text: string): string | null {
  const t = norm(text);
  for (const color of COLORS) { if (t.includes(norm(color))) return color; }
  return null;
}

function detectFuel(text: string): string | null {
  const t = norm(text);
  if (/\bsin\s+gnc\b/.test(t)) return null;
  const sorted = Object.entries(FUEL_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [kw, fuel] of sorted) { if (t.includes(norm(kw))) return fuel; }
  return null;
}

function detectTransmission(text: string): string | null {
  const t = norm(text);
  const sorted = Object.entries(TRANSMISSION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [kw, tx] of sorted) { if (t.includes(norm(kw))) return tx; }
  return null;
}

function detectUseCase(text: string): string | null {
  const t = norm(text);
  for (const [kw, use] of Object.entries(USE_CASE_MAP)) { if (t.includes(norm(kw))) return use; }
  return null;
}

function detectCity(text: string): string | null {
  const t = norm(text);
  for (const city of CITY_LIST) { if (t.includes(norm(city))) return city; }
  return null;
}

function detectName(text: string): string | null {
  const t = norm(text);
  const m = t.match(/\bsoy\s+([a-z\u00e0-\u00fc]+)\b/);
  if (m && m[1].length >= 3) return m[1];
  const m2 = t.match(/\bme\s+llamo\s+([a-z\u00e0-\u00fc]+)\b/);
  if (m2 && m2[1].length >= 3) return m2[1];
  return null;
}

function detectGNC(text: string): boolean | null {
  if (/\b(?:con\s+)?gnc\b/i.test(text)) return true;
  if (/\bsin\s+gnc\b/i.test(text)) return false;
  return null;
}

function detectTradeIn(text: string): { hasTradeIn: boolean; tradeInModel?: string; tradeInYear?: number; tradeInKm?: number } | null {
  const triggers = /\b(?:tengo\s+(?:un|una)|entrego|parte\s+de\s+pago|doy\s+en\s+parte|permut[ao]|canje|cambio|te\s+(?:doy|traigo|llevo)\s+(?:el|la|mi)|mi\s+(?:auto|coche|carro|camioneta|moto)\s+(?:como|de|en)|lo\s+cambio|lo\s+entrego|dar\s+en\s+parte)\b/i;
  if (!triggers.test(text)) return null;
  const out: any = { hasTradeIn: true };
  const bm = detectBrandModel(text);
  if (bm.model) out.tradeInModel = bm.model;
  else if (bm.brand) out.tradeInModel = bm.brand;
  const y = parseYear(text);
  if (y) out.tradeInYear = y;
  const km = parseKm(text);
  if (km !== null) out.tradeInKm = km;
  return out;
}

/**
 * detectCondition — v4: detecta si el cliente busca 0km o usado.
 * Cubre variantes coloquiales y errores ortográficos comunes.
 */
function detectCondition(text: string): 'nuevo' | 'usado' | null {
  const t = norm(text);

  // 0km explícito
  if (/\b(?:0\s*km|cero\s*km|okm|0km|sin\s*rodar|sin\s*uso|brand\s*new|nuevo\s+de\s+agencia|directo\s+de\s+agencia)\b/.test(t)) return 'nuevo';
  // "0km" como atributo de búsqueda
  if (/\b(?:quiero|busco|necesito|dame|mostrame)\b.*\b(?:nuevo|0\s*km)\b/.test(t)) return 'nuevo';

  // Usado explícito
  if (/\b(?:usado|usada|de\s*segunda|segunda\s*mano|de\s*uso|con\s*km|con\s*kilometros?|km\s+recorridos?|semi\s*nuevo|seminuevo|oc[au]sion|de\s*ocasi[oó]n)\b/.test(t)) return 'usado';

  return null;
}

/**
 * detectFinancing — v4: detecta intención de financiación aunque no se digan cuotas exactas.
 */
function detectFinancing(text: string): boolean {
  const t = norm(text);
  // Extend financing detection to capture more conjugations and synonyms like "financian" or "financia".
  return /\b(?:con\s*cuotas?|en\s*cuotas?|a\s*cuotas?|financian|financia|financiar|financiado|financiacion|financiamiento|credito|banco|prestamo|anticipo|cuota\s*fija|pago\s*mensual|a\s*plazos?|plan\s*de\s*pago|lotes?)\b/.test(t);
}

/**
 * detectShowIntent — v4: detecta cuando el cliente quiere ver opciones directamente,
 * sin necesidad de que el bot siga preguntando datos.
 */
export function detectShowIntent(text: string): boolean {
  const t = norm(text);
  // Extend show-intent detection with "disponibles", "stock" and generic vehicle queries like "que autos tenes".
  // Also match phrases like "que autos disponibles tenes".
  const base = /\b(?:mostrame|mostra|muestrame|muestra|que\s+tenes|que\s+tienen|que\s+hay|listame|lista|ver\s+opciones?|quiero\s+ver|dame\s+opciones?|que\s+opciones?|que\s+modelos?|tenes\s+algo|tienen\s+algo|hay\s+algo|que\s+tienen\s+de|manda|mandame|pasame|disponible|disponibles|stock|que\s+autos|que\s+coches|que\s+vehiculos)\b/.test(t);
  const extras = /\bque\s+.*disponibles\s+tenes\b/.test(t);
  return base || extras;
}

/**
 * detectClosingIntent — v4: detecta señales de cierre o avance concreto hacia la compra.
 */
export function detectClosingIntent(text: string): boolean {
  const t = norm(text);
  return /\b(?:quiero\s+reservar|reservalo|lo\s+reservo|cuando\s+puedo\s+ir|voy\s+a\s+verlo|paso\s+a\s+verlo|me\s+lo\s+llevo|lo\s+compro|hacemos\s+algo|cerramos|hablo\s+con\s+alguien|quiero\s+hablar\s+con|me\s+comunicas?|me\s+da[ns]?\s+un\s+contacto|senal|sena|señ[ao]|abonar|pagar)\b/.test(t);
}

/**
 * detectClosure — v4: detecta despedidas y agradecimientos para responder con cierre cálido.
 */
export function detectClosure(text: string): boolean {
  const t = norm(text).trim();
  return /^(?:chau|bye|adios|hasta\s+luego|gracias|muchas\s+gracias|ok\s+gracias|listo\s+gracias|dale\s+gracias|buenas|ok|listo|entendido|ah\s+ok|ya\s+entendi|me\s+quedo\s+pensando|lo\s+pienso)\.?$/.test(t)
    || /\b(?:gracias\s+(?:y\s+)?(?:chau|hasta\s+luego|bye)|chau\s+gracias)\b/.test(t);
}

/**
 * detectRangeExpansion — v4: detecta cuando el cliente pide ver opciones de nivel superior.
 * Ej: "y algo mejor por un poco más" → expandir rango en +15-20%.
 */
export function detectRangeExpansion(text: string): boolean {
  const t = norm(text);
  return /\b(?:algo\s+mejor|un\s+poco\s+mas|poco\s+mas\s+de\s+presupuesto|estiro\s+el\s+presupuesto|puedo\s+llegar\s+a\s+(?:un\s+poco\s+)?mas|subiendo\s+el\s+presupuesto|y\s+(?:si\s+)?subo|que\s+mas\s+tenes\s+(?:por\s+)?arriba|que\s+me\s+das\s+por\s+mas|siguiente\s+nivel|algo\s+mejor\s+(?:por\s+)?un\s+poco)\b/.test(t);
}

/**
 * detectCheapestRequest — v4: detecta cuando el cliente quiere ver los más baratos.
 */
export function detectCheapestRequest(text: string): boolean {
  const t = norm(text);
  return /\b(?:lo\s+mas\s+barato|los\s+mas\s+baratos?|mas\s+economico|mas\s+accesible|mas\s+bajo\s+de\s+precio|menor\s+precio|el\s+mas\s+economico|opciones?\s+economicas?|algo\s+barato|el\s+mas\s+barato)\b/.test(t);
}

/**
 * detectImplicitBodywork — v4: detecta intenciones implícitas que se traducen a tipo de vehículo.
 * "algo para trabajar" → pickup/utilitario
 * "algo familiar" / "para la familia" → familiar/suv
 * "no muy grande" / "algo chico" → compacto
 */
function detectImplicitBodywork(text: string): string | null {
  const t = norm(text);

  // Pickup / utilitario por uso laboral
  if (/\b(?:para\s+trabajar|para\s+el\s+laburo|para\s+cargar|para\s+transportar|llevar\s+herramientas?|carga|negocio)\b/.test(t)) return 'pickup';

  // Familiar / SUV por necesidad de espacio
  if (/\b(?:para\s+(?:la\s+)?familia|somos\s+(?:muchos|\d+)|viaj[ao](?:mos)?\s+(?:mucho|seguido)|varios\s+chicos?|con\s+chicos?|baulera\s+grande|maletero\s+grande)\b/.test(t)) return 'suv';

  // Compacto por tamaño reducido
  if (/\b(?:no\s+muy\s+grande|algo\s+chico|chiquito|compacto|facil\s+de\s+maniobrar|para\s+la\s+ciudad|estacion(?:ar)?\s+facil|poco\s+espacio)\b/.test(t)) return 'hatch';

  return null;
}

/**
 * detectImplicitFuel — v4: detecta preferencia de combustible por contexto implícito.
 * "económico de mantener" / "gasto poco" → gnc o diesel implícito
 */
function detectImplicitFuelPreference(text: string): string | null {
  const t = norm(text);

  if (/\b(?:economico\s+de\s+mantener|gasto\s+(?:poco|menos)|bajo\s+consumo|que\s+consuma\s+poco|no\s+gaste\s+mucho\s+(?:nafta|gasoil|combustible)|ahorrar\s+en\s+combustible|rendidor|que\s+rinda)\b/.test(t)) {
    return 'gnc'; // sugerencia implícita de bajo costo operativo
  }

  if (/\b(?:muchos\s+km|muchos\s+kilometros?|viajo\s+(?:mucho|lejos|largas?\s+distancias?)|ruta\s+(?:siempre|seguido)|muchos\s+viajes)\b/.test(t)) {
    return 'diesel'; // sugerencia implícita para viajes largos
  }

  return null;
}

// ─── Exported interface ───────────────────────────────────────────────────────

export type Extracted = Record<string, any>;

/**
 * extractLeadFields — v3:
 * - maxPrice se setea siempre que haya monto detectado y no hubiera uno previo.
 * - Si el cliente usa "hasta/máximo", siempre reemplaza el maxPrice anterior.
 */
export function extractLeadFields(text: string, prev: any = {}): Extracted {
  const t = String(text || '');
  const out: Extracted = { ...(prev || {}) };

  // Year range
  const yr = parseYearRange(t);
  if (yr.minYear) out.minYear = yr.minYear;
  if (yr.maxYear) out.maxYear = yr.maxYear;
  if (yr.minYear && yr.maxYear && yr.minYear === yr.maxYear) out.year = yr.minYear;

  // Km
  const km = parseKm(t);
  if (km !== null) out.km = km;

  // Budget — v3: maxPrice se setea con cualquier monto si no había uno previo
  const money = parseMoney(t);
  if (money) {
    out.amount = money.amount;
    if (!out.currency) out.currency = money.currency;

    const isExplicitCap = /\b(?:hasta|m[áa]ximo?|no\s+m[áa]s|tope|limite?)\b/i.test(t);
    if (isExplicitCap) {
      // Explícito: siempre actualizar
      out.maxPrice = money.amount;
    } else if (!out.maxPrice) {
      // Implícito: solo si no había maxPrice
      out.maxPrice = money.amount;
    }
  }

  // Financing
  const pct = parsePercent(t);
  if (pct) out.percent = pct;
  const cuotas = parseCuotas(t);
  if (cuotas) out.cuotas = cuotas;

  // Brand / model — v4: respect semantic link between brand+model detected together
  // and handle brand switches cleanly (changing brand must clear model from old brand).
  const bm = detectBrandModel(t);
  if (bm.brand && bm.model) {
    // Both detected in this message — they're semantically linked, always override.
    // Prevents accumulating brand from memory + model from current message → invalid pair.
    out.brand = bm.brand;
    out.model = bm.model;
  } else if (bm.brand) {
    const normalizedNew = norm(bm.brand);
    const normalizedPrev = norm(out.brand ?? '');
    if (!out.brand || normalizedNew === normalizedPrev) {
      // No previous brand or same brand: update normally
      out.brand = bm.brand;
    } else {
      // Brand changed → update brand AND clear model if it belonged to the old brand
      const oldBrandModels: string[] = (BRAND_MODELS as any)[normalizedPrev] ?? [];
      const prevModel = norm(out.model ?? '');
      if (prevModel && oldBrandModels.includes(prevModel)) {
        delete out.model; // model from old brand is now semantically invalid
      }
      out.brand = bm.brand;
    }
  }
  if (bm.model && !out.model) out.model = bm.model;

  // Vehicle attributes
  const color = detectColor(t);
  if (color) out.color = color;

  const fuel = detectFuel(t);
  if (fuel) {
    out.fuel = fuel;
  } else if (!out.fuel) {
    // Intención implícita de combustible (v4) — solo si no hay preferencia explícita
    const implicitFuel = detectImplicitFuelPreference(t);
    if (implicitFuel) out.implicitFuelHint = implicitFuel;
  }

  const tx = detectTransmission(t);
  if (tx) out.transmission = tx;

  const gnc = detectGNC(t);
  if (gnc !== null) out.gnc = gnc;

  const use = detectUseCase(t);
  if (use) out.useCase = use;

  // Condition: 0km vs usado (v4)
  const condition = detectCondition(t);
  if (condition) out.condition = condition;

  // Financing intent (v4)
  if (detectFinancing(t)) out.wantsFinancing = true;

  // Show intent flag (v4) — informa al agente que debe mostrar, no preguntar
  if (detectShowIntent(t)) out.showIntent = true;

  // Closing intent flag (v4)
  if (detectClosingIntent(t)) out.closingIntent = true;

  // Closure / farewell flag (v4)
  if (detectClosure(t)) out.isClosure = true;

  // Range expansion flag (v4)
  if (detectRangeExpansion(t)) out.rangeExpansion = true;

  // Cheapest request flag (v4)
  if (detectCheapestRequest(t)) out.cheapestRequest = true;

  // Bodywork — explícito primero, luego implícito
  if (/\b(?:suv|crossover|4x4|cuatro\s*por\s*cuatro)\b/i.test(t)) out.bodywork = 'suv';
  else if (/\b(?:sedan|4\s*puertas?)\b/i.test(t)) out.bodywork = 'sedan';
  else if (/\b(?:hatch|hatchback|3\s*puertas?)\b/i.test(t)) out.bodywork = 'hatch';
  else if (/\b(?:pickup|pick\s*up|doble\s*cabina|camioneta)\b/i.test(t)) out.bodywork = 'pickup';
  else if (/\b(?:furgon|utilitario)\b/i.test(t)) out.bodywork = 'furgon';
  else if (/\b(?:familiar|station\s*wagon|sw)\b/i.test(t)) out.bodywork = 'familiar';
  else if (/\b(?:compacto|compacta)\b/i.test(t)) out.bodywork = 'hatch';
  else if (/\b(?:monovolumen|minivan|van)\b/i.test(t)) out.bodywork = 'monovolumen';
  else if (/\b(?:coupe|coup[eé]|2\s*puertas?)\b/i.test(t)) out.bodywork = 'coupe';
  // Intención implícita de carrocería (v4) — solo si no hay bodywork explícito ya
  if (!out.bodywork) {
    const implicitBody = detectImplicitBodywork(t);
    if (implicitBody) out.bodywork = implicitBody;
  }

  // People info
  const city = detectCity(t);
  if (city) out.city = city;
  const name = detectName(t);
  if (name) out.name = name;

  // Trade-in
  const tradeIn = detectTradeIn(t);
  if (tradeIn) {
    out.tradeIn = true;
    out.hasTradeIn = true;
    if (tradeIn.tradeInModel) out.tradeInModel = tradeIn.tradeInModel;
    if (tradeIn.tradeInYear) out.tradeInYear = tradeIn.tradeInYear;
    if (tradeIn.tradeInKm !== undefined) out.tradeInKm = tradeIn.tradeInKm;
  }

  return out;
}

const REQUIRED_FIELD_QUESTIONS: Record<string, string> = {
  tradein_model: '¿Qué auto tenés para entregar? Pasame marca y modelo.',
  tradein_year: '¿De qué año es?',
  tradein_km: '¿Cuántos kilómetros tiene?',
  tradein_gnc: '¿Tiene GNC?',
  gnc: '¿Tiene GNC?',
  down_payment: '¿Cuánto podrías poner de anticipo?',
  installments: '¿En cuántas cuotas te gustaría?',
  amount: '¿Qué presupuesto tenés en mente?',
  max_price: '¿Hasta qué presupuesto querés mirar?',
  vehicle_query: '¿Qué marca o modelo te interesa?',
  from_zone: '¿Desde qué zona venís?',
  payment_type: '¿Vas a pagar en efectivo o querés financiar parte?',
  use_case: '¿Para qué lo vas a usar más: ciudad, ruta, familia o trabajo?',
  budget: '¿Cuál es tu presupuesto máximo?',
  priority: '¿Qué priorizás más: ciudad, ruta, espacio o presupuesto?',
  vehicle_id: '¿Cuál de las opciones te interesa ver?',
  city: '¿En qué zona estás?'
};

function normalizeRequiredFieldKey(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  const aliases: Record<string, string> = {
    trade_in_model: 'tradein_model',
    trade_in_year: 'tradein_year',
    trade_in_km: 'tradein_km',
    tradeinkm: 'tradein_km',
    tradeinyear: 'tradein_year',
    tradeinmodel: 'tradein_model',
    entrada: 'down_payment',
    anticipo: 'down_payment',
    cuotas: 'installments',
    months: 'installments',
    vehicle: 'vehicle_query',
    query: 'vehicle_query',
    zona: 'from_zone',
    payment: 'payment_type',
    usecase: 'use_case',
    priority_type: 'priority'
  };
  return aliases[snake] || snake;
}

function getExtractedValueByRequiredKey(extracted: Extracted, key: string): any {
  const k = normalizeRequiredFieldKey(key);
  const aliases: Record<string, string[]> = {
    tradein_model: ['tradeInModel', 'model'],
    tradein_year: ['tradeInYear', 'year'],
    tradein_km: ['tradeInKm', 'km'],
    tradein_gnc: ['gnc'],
    down_payment: ['downPayment', 'amount'],
    installments: ['cuotas', 'installments'],
    amount: ['amount', 'maxPrice'],
    max_price: ['maxPrice', 'amount'],
    vehicle_query: ['brand', 'model', 'bodywork', 'useCase'],
    from_zone: ['city'],
    payment_type: ['paymentType'],
    use_case: ['useCase'],
    budget: ['maxPrice', 'amount'],
    priority: ['priority'],
    vehicle_id: ['vehicleId', 'selectedVehicleId'],
    city: ['city'],
    gnc: ['gnc']
  };
  const candidates = [k, ...(aliases[k] || [])];
  for (const candidate of candidates) {
    const value = (extracted as any)?.[candidate];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

export function requiredFieldsForIntent(intent: string, playbookConfig?: any): Array<{ key: string; question: string }> {
  const cfg = playbookConfig && typeof playbookConfig === 'object' ? playbookConfig : {};
  if (Array.isArray(cfg.required_fields) && cfg.required_fields.length) {
    return cfg.required_fields
      .map((item: any) => {
        if (typeof item === 'string') {
          const key = normalizeRequiredFieldKey(item);
          return key ? { key, question: REQUIRED_FIELD_QUESTIONS[key] || '¿Me pasás un dato más para seguir?' } : null;
        }
        const key = normalizeRequiredFieldKey(String(item?.key ?? item?.field ?? ''));
        if (!key) return null;
        const question = String(item?.question ?? REQUIRED_FIELD_QUESTIONS[key] ?? '¿Me pasás un dato más para seguir?');
        return { key, question };
      })
      .filter(Boolean) as Array<{ key: string; question: string }>;
  }

  const i = norm(intent);
  if (i.includes('usado') || i.includes('permuta') || i.includes('tradein') || i.includes('canje')) {
    return [
      { key: 'tradein_model', question: REQUIRED_FIELD_QUESTIONS.tradein_model },
      { key: 'tradein_year', question: REQUIRED_FIELD_QUESTIONS.tradein_year },
      { key: 'tradein_km', question: REQUIRED_FIELD_QUESTIONS.tradein_km },
      { key: 'gnc', question: REQUIRED_FIELD_QUESTIONS.gnc }
    ];
  }
  if (i.includes('finan') || i.includes('cuota')) {
    return [
      { key: 'down_payment', question: REQUIRED_FIELD_QUESTIONS.down_payment },
      { key: 'installments', question: REQUIRED_FIELD_QUESTIONS.installments }
    ];
  }
  if (i.includes('ubic') || i.includes('horario') || i.includes('visita')) {
    return [{ key: 'from_zone', question: REQUIRED_FIELD_QUESTIONS.from_zone }];
  }
  if (i.includes('stock') || i.includes('dispon') || i.includes('busco')) {
    return [
      { key: 'vehicle_query', question: REQUIRED_FIELD_QUESTIONS.vehicle_query },
      { key: 'budget', question: REQUIRED_FIELD_QUESTIONS.budget }
    ];
  }
  return [];
}

export function computeMissingFields(
  required: Array<{ key: string; question: string }>,
  extracted: Extracted
): string[] {
  return (required || [])
    .map(({ key, question }) => ({ key: normalizeRequiredFieldKey(key), question }))
    .filter(({ key }) => {
      if (!key) return false;
      const value = getExtractedValueByRequiredKey(extracted, key);
      return value === undefined || value === null || String(value).trim() === '' || value === false;
    })
    .map(({ key }) => key);
}

export function buildMissingQuestions(
  required: Array<{ key: string; question: string }>,
  missing: string[]
): string {
  const firstMissing = (missing || [])[0];
  if (!firstMissing) return '';
  const key = normalizeRequiredFieldKey(firstMissing);
  const question = required.find((r) => normalizeRequiredFieldKey(r.key) === key)?.question || REQUIRED_FIELD_QUESTIONS[key];
  if (!question) return '';
  return question;
}

/**
 * formatMoney — muestra montos de forma legible.
 * ARS 30 M / ARS 800 mil / USD 25.000
 */
export function formatMoney(amount: number, currency: 'ARS' | 'USD' = 'ARS'): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (currency === 'USD') return `USD ${amount.toLocaleString('es-AR')}`;
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `ARS ${Number.isInteger(m) ? m : parseFloat(m.toFixed(1))} M`;
  }
  if (amount >= 1_000) return `ARS ${(amount / 1000).toFixed(0)} mil`;
  return `ARS ${amount.toLocaleString('es-AR')}`;
}

/**
 * summarizeExtracted — v3: usa formatMoney, agrega "hasta" en presupuesto.
 */
export function summarizeExtracted(ex: Extracted): string {
  const parts: string[] = [];
  if (ex.brand) parts.push(String(ex.brand));
  if (ex.model) parts.push(String(ex.model));
  if (ex.year) parts.push(String(ex.year));
  else {
    const mn = ex.minYear ? String(ex.minYear) : '';
    const mx = ex.maxYear ? String(ex.maxYear) : '';
    if (mn || mx) parts.push(mn && mx && mn !== mx ? `${mn}-${mx}` : mn || mx);
  }
  if (ex.transmission) parts.push(ex.transmission);
  if (ex.fuel) parts.push(ex.fuel);
  if (ex.bodywork) parts.push(ex.bodywork);
  if (ex.color) parts.push(ex.color);
  const budget = ex.maxPrice ?? ex.amount;
  if (budget) parts.push(`hasta ${formatMoney(budget, (ex.currency ?? 'ARS') as 'ARS' | 'USD')}`);
  return parts.join(', ');
}

/**
 * buildConfirmationPhrase — genera frase de confirmación de datos extraídos.
 * Ej: "Perfecto, entonces buscás un Corolla hasta ARS 30 M."
 */
export function buildConfirmationPhrase(ex: Extracted): string {
  const parts: string[] = [];
  if (ex.brand && ex.model) parts.push(`${ex.brand} ${ex.model}`);
  else if (ex.brand) parts.push(ex.brand);
  else if (ex.model) parts.push(ex.model);

  if (ex.year) parts.push(`del ${ex.year}`);
  else if (ex.minYear && ex.maxYear && ex.minYear !== ex.maxYear) {
    parts.push(`entre ${ex.minYear} y ${ex.maxYear}`);
  } else if (ex.minYear) parts.push(`desde ${ex.minYear}`);

  if (ex.bodywork) parts.push(ex.bodywork);
  if (ex.transmission) parts.push(`caja ${ex.transmission}`);

  const budget = ex.maxPrice ?? ex.amount;
  if (budget) parts.push(`hasta ${formatMoney(budget, (ex.currency ?? 'ARS') as 'ARS' | 'USD')}`);

  if (!parts.length) return '';
  return `Perfecto, entonces buscás ${parts.join(', ')}.`;
}

/**
 * hasUsefulData — v4: indica si hay suficiente contexto para buscar resultados.
 * Incluye flags de intención explícita de ver opciones.
 */
export function hasUsefulData(ctx: Extracted): boolean {
  return !!(
    ctx?.brand ||
    ctx?.model ||
    ctx?.maxPrice ||
    ctx?.amount ||
    ctx?.bodywork ||
    ctx?.showIntent ||
    ctx?.condition ||
    ctx?.useCase
  );
}

/**
 * shouldShowResults — v4: decide si el bot debe mostrar resultados directamente
 * sin pedir más datos. Retorna true si hay al menos un filtro útil O si el cliente
 * pidió explícitamente ver opciones.
 */
export function shouldShowResults(ctx: Extracted): boolean {
  if (ctx?.showIntent) return true;
  if (ctx?.cheapestRequest) return true;
  const hasFilter = !!(ctx?.brand || ctx?.model || ctx?.maxPrice || ctx?.amount || ctx?.bodywork || ctx?.condition || ctx?.useCase || ctx?.fuel || ctx?.transmission);
  return hasFilter;
}

// ─── Topic Change Detection ───────────────────────────────────────────────────

/**
 * detectTopicChange — detecta cuando el usuario indica explícitamente que quiere
 * buscar algo distinto a lo anterior ("otra cosa", "cambio de tema", "ahora busco").
 *
 * Cuando esto ocurre, el contexto de vehículo acumulado debe resetearse para
 * no contaminar la nueva búsqueda con datos de la búsqueda anterior.
 *
 * IMPORTANT: patrones intencionalmente conservadores para evitar falsos positivos.
 */
export function detectTopicChange(text: string): boolean {
  return /\b(otra\s+cosa|cambio\s+de\s+tema|ahora\s+(busco|quiero|me\s+interesa|necesito)\b|algo\s+distinto|olvid[aá](te|lo|me)(\s+de\s+(eso|todo|lo\s+anterior))?|empez[ao]r\s+de\s+(cero|nuevo)|en\s+realidad\s+(busco|quiero|me\s+interesa)\b|cambi[eé]\s+de\s+idea|ya\s+no\s+me\s+interesa|no\s+lo\s+de\s+antes|busco\s+otra\s+(cosa|opci[oó]n)|quiero\s+ver\s+otra\s+cosa)\b/i.test(text);
}

/**
 * clearVehicleContext — elimina campos específicos de vehículo del contexto acumulado.
 * Retiene: presupuesto, nombre, ciudad (datos personales no atados al vehículo buscado).
 * Usar en topic change para hacer soft-reset del contexto de búsqueda.
 */
export function clearVehicleContext(ctx: Record<string, any>): Record<string, any> {
  const {
    brand, model, bodywork, transmission, fuel, year, minYear, maxYear,
    condition, color, gnc, implicitFuelHint, implicitBodyHint,
    showIntent, closingIntent, rangeExpansion, cheapestRequest,
    // keep: maxPrice, amount, currency, name, city, useCase, hasTradeIn, wantsFinancing
    ...rest
  } = ctx;
  return rest;
}

// ─── Brand-Model Semantic Validator ──────────────────────────────────────────

/**
 * sanitizeBrandModel — valida que brand y model sean semánticamente coherentes.
 *
 * Problema real: si se acumula brand de memoria + model del mensaje actual,
 * pueden combinarse marcas y modelos de distintas marcas (ej: "ford strada").
 * Este guardrail detecta el par inválido y limpia el model, manteniendo el brand
 * (que suele ser más fiable por ser más reciente o explícito).
 *
 * Si el brand no está en BRAND_MODELS (marca desconocida), no valida (pasa todo).
 */
export function sanitizeBrandModel(extracted: Record<string, any>): Record<string, any> {
  const brand = norm(extracted.brand ?? '');
  const model = norm(extracted.model ?? '');
  if (!brand || !model) return extracted; // nada que validar

  const validModels: string[] | undefined = BRAND_MODELS[brand];
  if (!validModels) return extracted; // marca desconocida — no podemos validar

  if (!validModels.includes(model)) {
    // Par inválido — limpiar model, mantener brand
    console.warn(`[extract] invalid brand-model pair detected: ${brand}+${model} → model cleared`);
    const { model: _dropped, ...rest } = extracted;
    return rest;
  }
  return extracted;
}

/**
 * getLeadTemperature — v4: clasifica el lead según datos disponibles e intenciones detectadas.
 */
export function getLeadTemperature(ctx: Extracted): 'frio' | 'tibio' | 'caliente' {
  if (ctx?.closingIntent) return 'caliente';
  if (ctx?.wantsFinancing && (ctx?.brand || ctx?.model || ctx?.maxPrice)) return 'caliente';

  const dataPoints = [
    ctx?.brand, ctx?.model, ctx?.maxPrice, ctx?.bodywork,
    ctx?.fuel, ctx?.transmission, ctx?.condition, ctx?.useCase
  ].filter(Boolean).length;

  if (dataPoints >= 2) return 'tibio';
  if (dataPoints === 1) return 'tibio';
  return 'frio';
}
