function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function parseIntLoose(raw: string): number | null {
  const s = String(raw || '').replace(/[^0-9]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseKm(text: string): number | null {
  const t = normalize(text);
  // Examples: "190 mil", "190.000 km", "190k"
  const mil = t.match(/\b(\d{2,3})\s*(mil|m)\b/);
  if (mil) {
    const n = Number(mil[1]);
    if (Number.isFinite(n)) return n * 1000;
  }
  const k = t.match(/\b(\d{2,3})\s*k\b/);
  if (k) {
    const n = Number(k[1]);
    if (Number.isFinite(n)) return n * 1000;
  }
  const full = t.match(/\b(\d{1,3}(?:[\.,]\d{3})+)\s*(?:km|kms)?\b/);
  if (full) {
    const n = parseIntLoose(full[1]);
    if (n) return n;
  }
  const plain = t.match(/\b(\d{5,6})\s*(?:km|kms)?\b/);
  if (plain) {
    const n = Number(plain[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseYear(text: string): number | null {
  const t = normalize(text);
  const m = t.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  if (y >= 1950 && y <= 2035) return y;
  return null;
}

function parsePercent(text: string): number | null {
  const t = normalize(text);
  const m = t.match(/\b(\d{1,2})\s*%\b/);
  if (!m) return null;
  const p = Number(m[1]);
  if (p >= 1 && p <= 99) return p;
  return null;
}

function parseCuotas(text: string): number | null {
  const t = normalize(text);
  const m = t.match(/\b(\d{1,3})\s*(?:cuotas?|mes(?:es)?|m)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 1 && n <= 180) return n;
  return null;
}

function parseMoney(text: string): number | null {
  const t = normalize(text);
  // Rough: "$ 13.800.000" or "13800000" or "13,8m" or "13.8m"
  const m = t.match(/\$\s*([0-9\.,]+)/);
  if (m) {
    const n = parseIntLoose(m[1]);
    if (n) return n;
  }
  const mm = t.match(/\b(\d+(?:[\.,]\d+)?)\s*(m|mill|millon(?:es)?)\b/);
  if (mm) {
    const base = Number(String(mm[1]).replace(',', '.'));
    if (Number.isFinite(base)) return Math.round(base * 1_000_000);
  }
  const plain = t.match(/\b(\d{6,9})\b/);
  if (plain) {
    const n = Number(plain[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export type Extracted = Record<string, any>;

export function extractLeadFields(text: string, prev: any = {}): Extracted {
  const t = String(text || '');
  const out: Extracted = { ...(prev || {}) };

  // Common
  const y = parseYear(t);
  if (y) out.year = y;

  const km = parseKm(t);
  if (km) out.km = km;

  const pct = parsePercent(t);
  if (pct) out.percent = pct;

  const cuotas = parseCuotas(t);
  if (cuotas) out.cuotas = cuotas;

  const money = parseMoney(t);
  if (money) out.amount = money;

  // Trade-in / usado
  if (/\bgnc\b/i.test(t)) out.gnc = true;
  if (/sin\s+gnc/i.test(t)) out.gnc = false;

  const model = normalize(t).match(/\b(?:tengo|seria|es)\s+un\s+([a-z0-9]+\s+[a-z0-9]+(?:\s+\d{1,3})?)/);
  if (model && model[1]) out.model = String(model[1]).trim();

  // Location hints (very rough)
  const city = normalize(t).match(/\b(tandil|mar del plata|balcarce|azul|olavarria|necochea|benito juarez)\b/);
  if (city && city[1]) out.city = city[1];

  // Name
  const name = normalize(t).match(/\bsoy\s+([a-z]+)\b/);
  if (name && name[1]) out.name = name[1];

  return out;
}

export function requiredFieldsForIntent(intent: string, playbookConfig?: any): Array<{ key: string; question: string }> {
  const cfg = playbookConfig && typeof playbookConfig === 'object' ? playbookConfig : {};
  if (Array.isArray(cfg.required_fields) && cfg.required_fields.length) {
    return cfg.required_fields
      .map((x: any) => ({ key: String(x?.key ?? ''), question: String(x?.question ?? '') }))
      .filter((x: any) => x.key);
  }

  const i = normalize(intent);
  if (i.includes('usado') || i.includes('permuta') || i.includes('tradein')) {
    return [
      { key: 'model', question: '¿Qué vehículo tenés para entregar (marca/modelo)?' },
      { key: 'year', question: '¿De qué año es?' },
      { key: 'km', question: '¿Cuántos km tiene?' },
      { key: 'gnc', question: '¿Tiene GNC? (sí/no)' }
    ];
  }
  if (i.includes('finan') || i.includes('cuota')) {
    return [
      { key: 'percent', question: '¿Qué % querés financiar (aprox.)?' },
      { key: 'cuotas', question: '¿En cuántas cuotas te gustaría?' }
    ];
  }
  if (i.includes('ubic') || i.includes('direccion') || i.includes('horario')) {
    return [{ key: 'city', question: '¿En qué ciudad/zona estás?' }];
  }
  if (i.includes('stock') || i.includes('dispon')) {
    return [{ key: 'query', question: '¿Qué modelo/producto querés consultar?' }];
  }
  return [];
}

export function computeMissingFields(required: Array<{ key: string; question: string }>, extracted: Extracted): string[] {
  const missing: string[] = [];
  for (const r of required || []) {
    const key = String(r.key || '').trim();
    if (!key) continue;
    const v = (extracted as any)?.[key];
    const ok = v !== undefined && v !== null && String(v).trim() !== '';
    if (!ok) missing.push(key);
  }
  return missing;
}

export function buildMissingQuestions(required: Array<{ key: string; question: string }>, missing: string[]): string {
  const lines: string[] = [];
  for (const m of missing || []) {
    const q = required.find((r) => r.key === m)?.question;
    if (q) lines.push(`• ${q}`);
  }
  if (!lines.length) return '';
  return ['Para avanzar, necesito estos datos 👇', ...lines].join('\n');
}
