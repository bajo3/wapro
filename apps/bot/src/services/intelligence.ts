/**
 * intelligence.ts — Motor de conocimiento y matching del bot.
 *
 * Mejoras v2:
 *  - matchFaq / matchPolicy / matchPlaybook con scoring multi-señal:
 *      · score de trigger-overlap (cuántos triggers coinciden, no solo el primero)
 *      · bonus por título si coincide con el texto
 *      · desempate por score → devuelve el mejor, no el primero
 *  - matchBest(): un solo call que evalúa las tres tablas y devuelve el
 *    resultado de mayor score con su tipo, listo para usar en el webhook
 *  - refreshCacheIfNeeded(): TTL aumentado a 30s, se invalida con forceRefresh()
 *    para uso post-edición en admin
 *  - renderTemplate(): soporte añadido para {{#each list}}...{{/each}}
 *    y filtros simples {{key | upper}}, {{key | lower}}, {{key | currency}}
 *  - searchKnowledge(): agrega fallback de búsqueda por ILIKE cuando
 *    plainto_tsquery devuelve vacío (palabras cortas, typos, etc.)
 */

import { pool } from './db.js';

type Settings = Record<string, any>;

export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}


function tokenize(s: string): string[] {
  return normalize(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function uniqueTokens(s: string): string[] {
  return [...new Set(tokenize(s))];
}

function levenshtein(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x) return y.length;
  if (!y) return x.length;

  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 0; i <= x.length; i++) dp[i][0] = i;
  for (let j = 0; j <= y.length; j++) dp[0][j] = j;

  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[x.length][y.length];
}

function fuzzyWordSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const dist = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  if (!maxLen) return 0;
  return Math.max(0, 1 - dist / maxLen);
}

function tokenOverlapScore(text: string, sample: string): number {
  const a = uniqueTokens(text);
  const b = uniqueTokens(sample);
  if (!a.length || !b.length) return 0;

  let hits = 0;
  for (const bt of b) {
    const best = a.reduce((acc, at) => Math.max(acc, fuzzyWordSimilarity(at, bt)), 0);
    if (best >= 0.84) hits += best >= 0.96 ? 1 : 0.75;
  }
  return Math.min(1, hits / b.length);
}

function titleScore(text: string, title?: string | null): number {
  if (!title) return 0;
  return tokenOverlapScore(text, title);
}

function escapeRegExp(s: string): string {
  const specials = new Set(['\\', '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']']);
  return Array.from(String(s || '')).map((ch) => specials.has(ch) ? `\${ch}` : ch).join('');
}


// ─── Trigger scoring ────────────────────────────────────────────────────────────
// Multi-signal score: exact/contains + token overlap + fuzzy similarity.
// Returns a score in [0, 1].
function triggerScore(text: string, triggers: string[]): number {
  if (!triggers?.length) return 0;
  const t = normalize(text);
  if (!t) return 0;

  let best = 0;

  for (const raw of triggers) {
    const trig = normalize(raw);
    if (!trig) continue;

    let exact = 0;
    if (t === trig) exact = 1;
    else if (t.includes(trig) || trig.includes(t)) exact = 0.92;

    const overlap = tokenOverlapScore(t, trig);
    const fuzzy = fuzzyWordSimilarity(t, trig);

    const re = new RegExp(`(^|[\\s,;.!?])${escapeRegExp(trig)}([\\s,;.!?]|$)`);
    const boundaryBonus = re.test(t) ? 0.06 : 0;

    const score = Math.min(1, Math.max(exact, overlap * 0.9, fuzzy * 0.8) + boundaryBonus);
    if (score > best) best = score;
  }

  const overlapHits = (triggers || []).reduce((acc, raw) => {
    const s = tokenOverlapScore(t, String(raw || ''));
    return acc + (s >= 0.55 ? 1 : 0);
  }, 0);
  if (overlapHits >= 2) best = Math.min(1, best + 0.05);

  return best;
}

// ─── Settings ────────────────────────────────────────────────────────────────────
export async function getIntelligenceSettings(): Promise<Settings> {
  const r = await pool.query('select value from bot_intelligence_settings where id=1');
  return (r.rows?.[0]?.value as Settings) || {};
}

export async function updateIntelligenceSettings(value: Settings): Promise<Settings> {
  const r = await pool.query(
    'insert into bot_intelligence_settings (id, value, updated_at) values (1, $1::jsonb, now())\n' +
      'on conflict (id) do update set value=excluded.value, updated_at=now()\n' +
      'returning value',
    [JSON.stringify(value ?? {})]
  );
  return r.rows[0].value as Settings;
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────────
export async function listFaq(): Promise<any[]> {
  const r = await pool.query('select * from bot_faq order by id desc');
  return r.rows;
}

export async function createFaq(input: { title?: string; triggers: string[]; answer: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const r = await pool.query(
    'insert into bot_faq (title, triggers, answer, enabled, draft) values ($1, $2, $3, $4, $5) returning *',
    [input.title ?? null, input.triggers ?? [], input.answer, input.enabled ?? true, input.draft ?? false]
  );
  invalidateCache();
  return r.rows[0];
}

export async function updateFaq(id: number, patch: { title?: string | null; triggers?: string[]; answer?: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const current = await pool.query('select * from bot_faq where id=$1', [id]);
  if ((current.rowCount ?? 0) === 0) return null;
  const cur = current.rows[0];
  const next = {
    title: patch.title !== undefined ? patch.title : cur.title,
    triggers: patch.triggers !== undefined ? patch.triggers : cur.triggers,
    answer: patch.answer !== undefined ? patch.answer : cur.answer,
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    draft: patch.draft !== undefined ? patch.draft : cur.draft
  };
  const r = await pool.query(
    'update bot_faq set title=$2, triggers=$3, answer=$4, enabled=$5, draft=$6 where id=$1 returning *',
    [id, next.title, next.triggers ?? [], next.answer, next.enabled, next.draft]
  );
  invalidateCache();
  return r.rows[0];
}

export async function deleteFaq(id: number): Promise<void> {
  await pool.query('delete from bot_faq where id=$1', [id]);
  invalidateCache();
}

// ─── Policies ───────────────────────────────────────────────────────────────────
export async function listPolicies(): Promise<any[]> {
  const r = await pool.query('select * from bot_policies order by id desc');
  return r.rows;
}

export async function createPolicy(input: { title?: string; triggers: string[]; body: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const r = await pool.query(
    'insert into bot_policies (title, triggers, body, enabled, draft) values ($1, $2, $3, $4, $5) returning *',
    [input.title ?? null, input.triggers ?? [], input.body, input.enabled ?? true, input.draft ?? false]
  );
  invalidateCache();
  return r.rows[0];
}

export async function updatePolicy(id: number, patch: { title?: string | null; triggers?: string[]; body?: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const current = await pool.query('select * from bot_policies where id=$1', [id]);
  if ((current.rowCount ?? 0) === 0) return null;
  const cur = current.rows[0];
  const next = {
    title: patch.title !== undefined ? patch.title : cur.title,
    triggers: patch.triggers !== undefined ? patch.triggers : cur.triggers,
    body: patch.body !== undefined ? patch.body : cur.body,
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    draft: patch.draft !== undefined ? patch.draft : cur.draft
  };
  const r = await pool.query(
    'update bot_policies set title=$2, triggers=$3, body=$4, enabled=$5, draft=$6 where id=$1 returning *',
    [id, next.title, next.triggers ?? [], next.body, next.enabled, next.draft]
  );
  invalidateCache();
  return r.rows[0];
}

export async function deletePolicy(id: number): Promise<void> {
  await pool.query('delete from bot_policies where id=$1', [id]);
  invalidateCache();
}

// ─── Playbooks ──────────────────────────────────────────────────────────────────
export async function listPlaybooks(): Promise<any[]> {
  const r = await pool.query('select * from bot_playbooks order by id desc');
  return r.rows;
}

export async function createPlaybook(input: {
  intent: string;
  triggers: string[];
  template: string;
  enabled?: boolean;
  draft?: boolean;
  config?: any;
}): Promise<any> {
  const r = await pool.query(
    'insert into bot_playbooks (intent, triggers, template, enabled, draft, config) values ($1, $2, $3, $4, $5, $6::jsonb) returning *',
    [input.intent, input.triggers ?? [], input.template, input.enabled ?? true, input.draft ?? false, JSON.stringify(input.config ?? {})]
  );
  invalidateCache();
  return r.rows[0];
}

export async function updatePlaybook(id: number, patch: {
  intent?: string;
  triggers?: string[];
  template?: string;
  enabled?: boolean;
  draft?: boolean;
  config?: any;
}): Promise<any> {
  const current = await pool.query('select * from bot_playbooks where id=$1', [id]);
  if ((current.rowCount ?? 0) === 0) return null;
  const cur = current.rows[0];
  const next = {
    intent: patch.intent !== undefined ? patch.intent : cur.intent,
    triggers: patch.triggers !== undefined ? patch.triggers : cur.triggers,
    template: patch.template !== undefined ? patch.template : cur.template,
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    draft: patch.draft !== undefined ? patch.draft : cur.draft,
    config: patch.config !== undefined ? patch.config : cur.config
  };
  const r = await pool.query(
    'update bot_playbooks set intent=$2, triggers=$3, template=$4, enabled=$5, draft=$6, config=$7::jsonb where id=$1 returning *',
    [id, next.intent, next.triggers ?? [], next.template, next.enabled, next.draft, JSON.stringify(next.config ?? {})]
  );
  invalidateCache();
  return r.rows[0];
}

export async function deletePlaybook(id: number): Promise<void> {
  await pool.query('delete from bot_playbooks where id=$1', [id]);
  invalidateCache();
}

// ─── Examples ───────────────────────────────────────────────────────────────────
export async function listExamples(): Promise<any[]> {
  const r = await pool.query('select * from bot_examples order by id desc');
  return r.rows;
}

export async function createExample(input: {
  intent: string;
  user_text: string;
  ideal_answer: string;
  notes?: string;
}): Promise<any> {
  const r = await pool.query(
    'insert into bot_examples (intent, user_text, ideal_answer, notes) values ($1, $2, $3, $4) returning *',
    [input.intent, input.user_text, input.ideal_answer, input.notes ?? null]
  );
  return r.rows[0];
}

export async function deleteExample(id: number): Promise<void> {
  await pool.query('delete from bot_examples where id=$1', [id]);
}

// ─── Test cases ─────────────────────────────────────────────────────────────────
export async function listTestCases(): Promise<any[]> {
  const r = await pool.query('select * from bot_test_cases order by id desc');
  return r.rows;
}

export async function createTestCase(input: {
  name: string;
  user_text: string;
  expected_intent?: string;
  expected_source_type?: string;
  expected_source_id?: number;
  expected_contains?: string[];
  expected_not_contains?: string[];
  expected_regex?: string;
  expected_must_ask_fields?: string[];
  enabled?: boolean;
}): Promise<any> {
  const r = await pool.query(
    'insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_source_id, expected_contains, expected_not_contains, expected_regex, expected_must_ask_fields, enabled)\n' +
      'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',
    [
      input.name, input.user_text,
      input.expected_intent ?? null, input.expected_source_type ?? null, input.expected_source_id ?? null,
      input.expected_contains ?? [], input.expected_not_contains ?? [],
      input.expected_regex ?? null, input.expected_must_ask_fields ?? [],
      input.enabled ?? true
    ]
  );
  return r.rows[0];
}

export async function deleteTestCase(id: number): Promise<void> {
  await pool.query('delete from bot_test_cases where id=$1', [id]);
}

// ─── Decisions ──────────────────────────────────────────────────────────────────
export async function listDecisions(limit = 100): Promise<any[]> {
  const r = await pool.query('select * from bot_decisions order by id desc limit $1', [limit]);
  return r.rows;
}

export async function logDecision(input: {
  instance: string;
  remoteJid: string;
  intent?: string;
  confidence?: number;
  data?: any;
}): Promise<void> {
  await pool.query(
    'insert into bot_decisions (instance, remote_jid, intent, confidence, data) values ($1, $2, $3, $4, $5::jsonb)',
    [input.instance, input.remoteJid, input.intent ?? null, input.confidence ?? null, JSON.stringify(input.data ?? {})]
  );
}

// ─── Cache ───────────────────────────────────────────────────────────────────────
const cache = {
  at: 0,
  ttlMs: 30_000,
  faqs: [] as any[],
  playbooks: [] as any[],
  policies: [] as any[]
};

/** Call after any write to ensure next request reflects latest data. */
export function invalidateCache(): void {
  cache.at = 0;
}

async function refreshCacheIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - cache.at < cache.ttlMs && (cache.faqs.length || cache.playbooks.length || cache.policies.length)) return;
  const [policies, faqs, playbooks] = await Promise.all([
    pool.query('select * from bot_policies where enabled=true and draft=false order by id desc'),
    pool.query('select * from bot_faq where enabled=true and draft=false order by id desc'),
    pool.query('select * from bot_playbooks where enabled=true and draft=false order by id desc')
  ]);
  cache.policies = policies.rows;
  cache.faqs = faqs.rows;
  cache.playbooks = playbooks.rows;
  cache.at = now;
}

// ─── Knowledge search (RAG-lite) ────────────────────────────────────────────────
export async function searchKnowledge(
  query: string,
  limit = 5
): Promise<Array<{ type: 'policy' | 'faq'; id: number; title: string | null; snippet: string; rank: number }>> {
  const q = String(query || '').trim();
  if (!q) return [];

  // Primary: Postgres full-text search
  const sql = `
    with q as (select plainto_tsquery('spanish', $1) as tsq, websearch_to_tsquery('spanish', $1) as wsq)
    select * from (
      select
        'policy'::text as type, p.id, p.title,
        left(p.body, 400) as snippet,
        ts_rank_cd(to_tsvector('spanish', coalesce(p.title,'') || ' ' || coalesce(p.body,'')), q.tsq) as rank
      from bot_policies p, q
      where p.enabled=true and p.draft=false
        and to_tsvector('spanish', coalesce(p.title,'') || ' ' || coalesce(p.body,'')) @@ q.tsq
      union all
      select
        'faq'::text as type, f.id, f.title,
        left(f.answer, 400) as snippet,
        ts_rank_cd(to_tsvector('spanish', coalesce(f.title,'') || ' ' || coalesce(f.answer,'')), q.tsq) as rank
      from bot_faq f, q
      where f.enabled=true and f.draft=false
        and to_tsvector('spanish', coalesce(f.title,'') || ' ' || coalesce(f.answer,'')) @@ q.tsq
    ) t
    order by t.rank desc
    limit $2;
  `;

  try {
    const r = await pool.query(sql, [q, limit]);
    if (r.rows?.length) {
      return r.rows.map((x: any) => ({
        type: x.type as 'policy' | 'faq',
        id: Number(x.id),
        title: x.title ?? null,
        snippet: String(x.snippet ?? ''),
        rank: Number(x.rank ?? 0)
      }));
    }
  } catch {
    // fallthrough to ILIKE fallback
  }

  // Fallback: ILIKE for short queries, typos, or stopword-only text
  const likeQ = `%${q}%`;
  const fallback = await pool.query(
    `select * from (
       select 'policy'::text as type, p.id, p.title, left(p.body, 400) as snippet, 0.1::float as rank
       from bot_policies p where p.enabled=true and p.draft=false
         and (p.title ilike $1 or p.body ilike $1)
       union all
       select 'faq'::text as type, f.id, f.title, left(f.answer, 400) as snippet, 0.1::float as rank
       from bot_faq f where f.enabled=true and f.draft=false
         and (f.title ilike $1 or f.answer ilike $1)
     ) t limit $2`,
    [likeQ, limit]
  );

  return (fallback.rows ?? []).map((x: any) => ({
    type: x.type as 'policy' | 'faq',
    id: Number(x.id),
    title: x.title ?? null,
    snippet: String(x.snippet ?? ''),
    rank: Number(x.rank ?? 0)
  }));
}

// ─── Matching with scored results ───────────────────────────────────────────────

export interface MatchResult {
  type: 'faq' | 'policy' | 'playbook';
  row: any;
  score: number;
}

/** Returns the BEST matching FAQ by trigger score. */
export async function matchFaq(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  let best: { row: any; score: number } | null = null;
  for (const row of cache.faqs) {
    const s = triggerScore(text, row.triggers || []);
    if (s > 0 && (!best || s > best.score)) best = { row, score: s };
  }
  return best?.row ?? null;
}

/** Returns the BEST matching Policy by trigger score. */
export async function matchPolicy(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  let best: { row: any; score: number } | null = null;
  for (const row of cache.policies) {
    const s = triggerScore(text, row.triggers || []);
    if (s > 0 && (!best || s > best.score)) best = { row, score: s };
  }
  return best?.row ?? null;
}

/** Returns the BEST matching Playbook by trigger score. */
export async function matchPlaybook(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  let best: { row: any; score: number } | null = null;
  for (const row of cache.playbooks) {
    const s = triggerScore(text, row.triggers || []);
    if (s > 0 && (!best || s > best.score)) best = { row, score: s };
  }
  return best?.row ?? null;
}

/**
 * matchBest() — single call that evaluates all knowledge sources and
 * returns the highest-scoring match across FAQs, Policies and Playbooks.
 * Playbooks win on tie (they're more specific: intent + template).
 */
export async function matchBest(text: string): Promise<MatchResult | null> {
  await refreshCacheIfNeeded();

  let best: MatchResult | null = null;

  const evaluate = (type: 'faq' | 'policy' | 'playbook', rows: any[]) => {
    for (const row of rows) {
      const s = triggerScore(text, row.triggers || []);
      if (s <= 0) continue;
      // Playbooks get a small tie-breaking bonus
      const adjusted = Math.min(1, s + titleScore(text, row.title ?? row.intent ?? null) * 0.15 + (type === 'playbook' ? 0.01 : 0));
      if (!best || adjusted > best.score) best = { type, row, score: adjusted };
    }
  };

  evaluate('policy', cache.policies);
  evaluate('faq', cache.faqs);
  evaluate('playbook', cache.playbooks);

  return best;
}


export async function matchExample(
  text: string,
  options?: { intent?: string | null; limit?: number; minScore?: number }
): Promise<Array<{ row: any; score: number }>> {
  const q = String(text || '').trim();
  if (!q) return [];

  const params: any[] = [];
  let sql = 'select * from bot_examples';
  const where: string[] = [];
  if (options?.intent) {
    params.push(String(options.intent));
    where.push(`intent = $${params.length}`);
  }
  if (where.length) sql += ' where ' + where.join(' and ');
  sql += ' order by id desc limit 300';

  const r = await pool.query(sql, params);
  const rows = r.rows ?? [];
  const minScore = options?.minScore ?? 0.6;

  const scored = rows
    .map((row: any) => {
      const overlap = tokenOverlapScore(q, String(row.user_text ?? ''));
      const fuzzy = fuzzyWordSimilarity(q, String(row.user_text ?? ''));
      const intentHint = options?.intent && String(row.intent) === String(options.intent) ? 0.05 : 0;
      const score = Math.min(1, Math.max(overlap, fuzzy * 0.8) + intentHint);
      return { row, score };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(1, Math.min(10, options?.limit ?? 3)));
}

export function getReplyGuidelines(settings: Settings | null | undefined): {
  tone: string;
  maxQuestions: number;
  askOneThingAtATime: boolean;
  humanMode: boolean;
  preferShortParagraphs: boolean;
  useExamplesAsFallback: boolean;
  knowledgeThreshold: number;
} {
  const s = (settings && typeof settings === 'object') ? settings : {};
  const human = (s.humanization && typeof s.humanization === 'object') ? s.humanization : {};
  const thresholds = (s.thresholds && typeof s.thresholds === 'object') ? s.thresholds : {};
  return {
    tone: String(human.tone ?? s.tone ?? 'vendedor_consultivo'),
    maxQuestions: Number.isFinite(Number(human.maxQuestions)) ? Math.max(1, Math.min(3, Number(human.maxQuestions))) : 1,
    askOneThingAtATime: human.askOneThingAtATime !== false,
    humanMode: human.humanMode !== false,
    preferShortParagraphs: human.preferShortParagraphs !== false,
    useExamplesAsFallback: human.useExamplesAsFallback !== false,
    knowledgeThreshold: Number.isFinite(Number(thresholds.knowledgeMatchMinScore)) ? Math.max(0.35, Math.min(0.9, Number(thresholds.knowledgeMatchMinScore))) : 0.58
  };
}

export function trimQuestions(text: string, maxQuestions = 1): string {
  const parts = String(text || '')
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let questions = 0;
  const kept: string[] = [];
  for (const part of parts) {
    const qCount = (part.match(/\?/g) || []).length;
    if (qCount > 0) {
      if (questions >= maxQuestions) continue;
      questions += qCount;
      if (questions > maxQuestions) continue;
    }
    kept.push(part);
  }
  return kept.join('\n');
}

// ─── Episodes ───────────────────────────────────────────────────────────────────
export async function logEpisode(input: {
  instance?: string;
  remoteJid?: string;
  channel?: string;
  user_text: string;
  reply_text: string;
  intent?: string;
  variant?: string;
  sources?: any[];
  extracted?: any;
  missing_fields?: string[];
}): Promise<number> {
  const r = await pool.query(
    `insert into bot_episodes (instance, remote_jid, channel, user_text, reply_text, intent, variant, sources, extracted, missing_fields)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
     returning id`,
    [
      input.instance ?? null, input.remoteJid ?? null, input.channel ?? 'whatsapp',
      String(input.user_text ?? ''), String(input.reply_text ?? ''),
      input.intent ?? null, input.variant ?? null,
      JSON.stringify(input.sources ?? []), JSON.stringify(input.extracted ?? {}),
      input.missing_fields ?? []
    ]
  );
  return Number(r.rows?.[0]?.id);
}

export async function listEpisodes(limit = 200): Promise<any[]> {
  const r = await pool.query('select * from bot_episodes order by id desc limit $1', [limit]);
  return r.rows;
}

export async function rateEpisode(id: number, rating: number | null, feedback: string | null): Promise<any> {
  const r = await pool.query('update bot_episodes set rating=$2, feedback=$3 where id=$1 returning *', [id, rating, feedback]);
  return r.rows?.[0] ?? null;
}

// ─── Audit ──────────────────────────────────────────────────────────────────────
export async function logAudit(input: { actor?: string | null; action: string; entity: string; entity_id?: string | null; diff?: any }): Promise<void> {
  await pool.query(
    'insert into bot_audit_log(actor, action, entity, entity_id, diff) values ($1,$2,$3,$4,$5::jsonb)',
    [input.actor ?? null, input.action, input.entity, input.entity_id ?? null, JSON.stringify(input.diff ?? {})]
  );
}

export async function listAudit(limit = 200): Promise<any[]> {
  const r = await pool.query('select * from bot_audit_log order by id desc limit $1', [limit]);
  return r.rows;
}

// ─── A/B Variants ───────────────────────────────────────────────────────────────
export async function listAbVariants(): Promise<any[]> {
  const r = await pool.query('select * from bot_ab_variants order by id desc');
  return r.rows;
}

export async function createAbVariant(input: {
  scope: 'intent' | 'playbook';
  scope_key: string;
  variant: string;
  weight?: number;
  template_override?: string | null;
  enabled?: boolean;
}): Promise<any> {
  const r = await pool.query(
    `insert into bot_ab_variants (scope, scope_key, variant, weight, template_override, enabled)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (scope, scope_key, variant)
     do update set weight=excluded.weight, template_override=excluded.template_override, enabled=excluded.enabled
     returning *`,
    [input.scope, input.scope_key, input.variant, input.weight ?? 0.5, input.template_override ?? null, input.enabled ?? true]
  );
  return r.rows[0];
}

export async function deleteAbVariant(id: number): Promise<void> {
  await pool.query('delete from bot_ab_variants where id=$1', [id]);
}

export async function getAbVariantsFor(scope: 'intent' | 'playbook', scopeKey: string): Promise<any[]> {
  const r = await pool.query(
    'select * from bot_ab_variants where enabled=true and scope=$1 and scope_key=$2 order by id asc',
    [scope, scopeKey]
  );
  return r.rows;
}

// ─── Template engine ─────────────────────────────────────────────────────────────
export function renderTemplate(template: string, ctx: Record<string, any>): string {
  const tpl = String(template || '');

  const getPath = (path: string): any => {
    const parts = String(path).split('.');
    let v: any = ctx;
    for (const p of parts) v = v?.[p];
    return v;
  };

  const applyFilter = (value: any, filter: string): string => {
    const v = value === undefined || value === null ? '' : String(value);
    switch (filter.trim()) {
      case 'upper': return v.toUpperCase();
      case 'lower': return v.toLowerCase();
      case 'currency': {
        const n = Number(v);
        if (!Number.isFinite(n)) return v;
        return n.toLocaleString('es-AR', { minimumFractionDigits: 0 });
      }
      case 'date': {
        try { return new Date(v).toLocaleDateString('es-AR'); } catch { return v; }
      }
      default: return v;
    }
  };

  const evalExpr = (expr: string): boolean => {
    const e = String(expr || '').trim();
    if (!e) return false;
    const m = e.match(/^([a-zA-Z0-9_.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!m) {
      const v = getPath(e);
      if (Array.isArray(v)) return v.length > 0;
      return Boolean(v);
    }
    const left = getPath(m[1]);
    const op = m[2];
    const rawRight = m[3].trim();
    const rightNum = Number(rawRight);
    const right = Number.isFinite(rightNum) && /^-?\d+(?:\.\d+)?$/.test(rawRight)
      ? rightNum
      : rawRight.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    const ln = typeof left === 'number' ? left : Number(left);
    const rn = typeof right === 'number' ? right : Number(right);
    switch (op) {
      case '==': return String(left) === String(right);
      case '!=': return String(left) !== String(right);
      case '>': return Number.isFinite(ln) && Number.isFinite(rn) ? ln > rn : false;
      case '>=': return Number.isFinite(ln) && Number.isFinite(rn) ? ln >= rn : false;
      case '<': return Number.isFinite(ln) && Number.isFinite(rn) ? ln < rn : false;
      case '<=': return Number.isFinite(ln) && Number.isFinite(rn) ? ln <= rn : false;
      default: return false;
    }
  };

  // {{#each list}}...{{/each}} with {{this}} inside
  let rendered = tpl.replace(
    /\{\{\s*#each\s+([^}]+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g,
    (_m, key, inner) => {
      const arr = getPath(key.trim());
      if (!Array.isArray(arr) || !arr.length) return '';
      return arr
        .map((item) => {
          return inner
            .replace(/\{\{\s*this\s*\}\}/g, String(item ?? ''))
            .replace(/\{\{\s*this\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_: string, prop: string) => {
              const v = typeof item === 'object' ? item?.[prop] : undefined;
              return v !== undefined && v !== null ? String(v) : '';
            });
        })
        .join('');
    }
  );

  // Conditionals
  rendered = rendered
    .replace(/\{\{\s*#if\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g, (_m, expr, inner) => evalExpr(expr) ? inner : '')
    .replace(/\{\{\s*#unless\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/unless\s*\}\}/g, (_m, expr, inner) => !evalExpr(expr) ? inner : '');

  // {{key | filter}} with optional filter
  rendered = rendered.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([a-z]+))?\s*\}\}/g, (_m, key, filter) => {
    const v = getPath(String(key));
    if (v === undefined || v === null) return '';
    return filter ? applyFilter(v, filter) : String(v);
  });

  // {key} single-brace
  rendered = rendered.replace(/\{\s*([a-zA-Z0-9_.]+)\s*\}/g, (_m, key) => {
    const v = getPath(String(key));
    if (v === undefined || v === null) return '';
    return String(v);
  });

  return rendered;
}
