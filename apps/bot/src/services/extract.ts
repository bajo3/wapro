/**
 * extract.ts — Extracción estructurada de campos desde texto libre en español.
 *
 * Mejoras v2:
 *  - Detección de marca/modelo por diccionario (40+ marcas)
 *  - Presupuesto en múltiples formatos (USD/ARS, "13 palos", "800 mil")
 *  - Año con rangos ("entre 2018 y 2021", "del 2020 en adelante")
 *  - Kilometraje con alias ("cero km", "0km")
 *  - Transmisión por sinónimos robustos
 *  - Color de vehículo
 *  - Combustible (nafta/diesel/eléctrico/híbrido/GNC)
 *  - Tipo de uso (remis, familia, trabajo, etc.)
 *  - Nombre y ciudad
 *  - Trade-in (auto a entregar en parte de pago)
 *  - Financiación (cuotas, entrada, porcentaje)
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

function parseMoney(text: string): { amount: number; currency: 'ARS' | 'USD' } | null {
  const t = norm(text);
  const isUSD = /\b(?:dolares?|usd|u\$s|u\$d|\$u)\b/.test(t);
  const currency: 'ARS' | 'USD' = isUSD ? 'USD' : 'ARS';

  // "13 palos" — ARS coloquial
  const palos = t.match(/\b(\d+(?:[.,]\d+)?)\s*palos?\b/);
  if (palos) return { amount: Math.round(Number(palos[1].replace(',', '.')) * 1_000_000), currency: 'ARS' };

  // "13 millones" / "13m"
  const mill = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:mill?(?:ones?)?|m)\b/);
  if (mill) return { amount: Math.round(Number(mill[1].replace(',', '.')) * 1_000_000), currency };

  // "800 mil"
  const miles = t.match(/\b(\d{3,4})\s*(?:mil)\b/);
  if (miles) { const n = Number(miles[1]) * 1000; if (n > 50000) return { amount: n, currency }; }

  // "$ 13.800.000"
  const pesos = t.match(/\$\s*([0-9.,]+)/);
  if (pesos) { const n = Number(stripSep(pesos[1])); if (Number.isFinite(n) && n > 0) return { amount: n, currency }; }

  // Plain big number (7+ digits)
  const big = t.match(/\b(\d{7,12})\b/);
  if (big) return { amount: Number(big[1]), currency };

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
  vw: 'volkswagen', 'volk': 'volkswagen', 'wolks': 'volkswagen',
  chevy: 'chevrolet', 'chevi': 'chevrolet',
  merc: 'mercedes', 'merche': 'mercedes', benz: 'mercedes',
  'land rover': 'landrover', landrover: 'landrover'
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
  'caja manual': 'manual', manual: 'manual', sincronico: 'manual',
  automatica: 'automatico', automatico: 'automatico',
  tiptronic: 'automatico', dsg: 'automatico', cvt: 'automatico'
};

const USE_CASE_MAP: Record<string, string> = {
  remis: 'remis', taxi: 'remis', uber: 'remis', cabify: 'remis',
  familia: 'familiar', familiar: 'familiar',
  trabajo: 'trabajo', laburo: 'trabajo',
  campo: 'campo', rural: 'campo', offroad: 'campo',
  ciudad: 'city', city: 'city',
  ruta: 'viaje', viaje: 'viaje'
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
  const triggers = /\b(?:tengo\s+un|entrego|parte\s+de\s+pago|doy\s+en\s+parte|permut[ao]|canje|mi\s+(?:auto|coche|carro))\b/i;
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

// ─── Exported interface ───────────────────────────────────────────────────────

export type Extracted = Record<string, any>;

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

  // Budget
  const money = parseMoney(t);
  if (money) {
    out.amount = money.amount;
    if (!out.currency) out.currency = money.currency;
    if (/\b(?:hasta|m[aá]ximo?|no\s+m[aá]s)\b/i.test(t)) out.maxPrice = money.amount;
  }

  // Financing
  const pct = parsePercent(t);
  if (pct) out.percent = pct;
  const cuotas = parseCuotas(t);
  if (cuotas) out.cuotas = cuotas;

  // Brand / model
  const bm = detectBrandModel(t);
  if (bm.brand && !out.brand) out.brand = bm.brand;
  if (bm.model && !out.model) out.model = bm.model;

  // Vehicle attributes
  const color = detectColor(t);
  if (color) out.color = color;

  const fuel = detectFuel(t);
  if (fuel) out.fuel = fuel;

  const tx = detectTransmission(t);
  if (tx) out.transmission = tx;

  const gnc = detectGNC(t);
  if (gnc !== null) out.gnc = gnc;

  const use = detectUseCase(t);
  if (use) out.useCase = use;

  // Bodywork
  if (/\b(?:suv|crossover|4x4|cuatro\s*por\s*cuatro)\b/i.test(t)) out.bodywork = 'suv';
  else if (/\b(?:sedan|4\s*puertas?)\b/i.test(t)) out.bodywork = 'sedan';
  else if (/\b(?:hatch|hatchback|3\s*puertas?)\b/i.test(t)) out.bodywork = 'hatch';
  else if (/\b(?:pickup|pick\s*up|doble\s*cabina)\b/i.test(t)) out.bodywork = 'pickup';
  else if (/\b(?:furgon|utilitario)\b/i.test(t)) out.bodywork = 'furgon';

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

export function requiredFieldsForIntent(intent: string, playbookConfig?: any): Array<{ key: string; question: string }> {
  const cfg = playbookConfig && typeof playbookConfig === 'object' ? playbookConfig : {};
  if (Array.isArray(cfg.required_fields) && cfg.required_fields.length) {
    return cfg.required_fields
      .map((x: any) => ({ key: String(x?.key ?? ''), question: String(x?.question ?? '') }))
      .filter((x: any) => x.key);
  }

  const i = norm(intent);
  if (i.includes('usado') || i.includes('permuta') || i.includes('tradein') || i.includes('canje')) {
    return [
      { key: 'tradeInModel', question: '¿Qué vehículo tenés para entregar (marca/modelo)?' },
      { key: 'tradeInYear', question: '¿De qué año es?' },
      { key: 'tradeInKm', question: '¿Cuántos km tiene?' },
      { key: 'gnc', question: '¿Tiene GNC? (sí/no)' }
    ];
  }
  if (i.includes('finan') || i.includes('cuota')) {
    return [
      { key: 'percent', question: '¿Qué % del precio querés financiar?' },
      { key: 'cuotas', question: '¿En cuántas cuotas?' }
    ];
  }
  if (i.includes('ubic') || i.includes('horario')) {
    return [{ key: 'city', question: '¿En qué ciudad/zona estás?' }];
  }
  if (i.includes('stock') || i.includes('dispon') || i.includes('busco')) {
    return [
      { key: 'brand', question: '¿Qué marca/modelo buscás?' },
      { key: 'amount', question: '¿Tenés un presupuesto?' }
    ];
  }
  return [];
}

export function computeMissingFields(
  required: Array<{ key: string; question: string }>,
  extracted: Extracted
): string[] {
  return (required || [])
    .filter(({ key }) => {
      const k = key.trim();
      if (!k) return false;
      const v = extracted?.[k];
      return v === undefined || v === null || String(v).trim() === '' || v === false;
    })
    .map(({ key }) => key);
}

export function buildMissingQuestions(
  required: Array<{ key: string; question: string }>,
  missing: string[]
): string {
  const lines = missing
    .map((m) => required.find((r) => r.key === m)?.question)
    .filter(Boolean)
    .map((q) => `• ${q}`);
  if (!lines.length) return '';
  return ['Para ayudarte mejor necesito algunos datos 👇', ...lines].join('\n');
}

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
  if (ex.amount) {
    const cur = ex.currency ?? 'ARS';
    parts.push(`${cur} ${Number(ex.amount).toLocaleString('es-AR')}`);
  }
  return parts.join(', ');
}
