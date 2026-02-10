import { pool } from './db.js';

type Settings = Record<string, any>;

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function textMatchesTriggers(text: string, triggers: string[]): boolean {
  const t = normalize(text);
  if (!t || !triggers?.length) return false;
  return triggers.some((raw) => {
    const trig = normalize(raw);
    if (!trig) return false;
    // word boundary-ish: allow simple contains to support spanish variations
    return t.includes(trig);
  });
}

// ---- Settings ----
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

// ---- FAQ ----
export async function listFaq(): Promise<any[]> {
  const r = await pool.query('select * from bot_faq order by id desc');
  return r.rows;
}

export async function createFaq(input: { title?: string; triggers: string[]; answer: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const r = await pool.query(
    'insert into bot_faq (title, triggers, answer, enabled, draft) values ($1, $2, $3, $4, $5) returning *',
    [input.title ?? null, input.triggers ?? [], input.answer, input.enabled ?? true, input.draft ?? false]
  );
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
  return r.rows[0];
}

export async function deleteFaq(id: number): Promise<void> {
  await pool.query('delete from bot_faq where id=$1', [id]);
}

// ---- Policies ----
export async function listPolicies(): Promise<any[]> {
  const r = await pool.query('select * from bot_policies order by id desc');
  return r.rows;
}

export async function createPolicy(input: { title?: string; triggers: string[]; body: string; enabled?: boolean; draft?: boolean }): Promise<any> {
  const r = await pool.query(
    'insert into bot_policies (title, triggers, body, enabled, draft) values ($1, $2, $3, $4, $5) returning *',
    [input.title ?? null, input.triggers ?? [], input.body, input.enabled ?? true, input.draft ?? false]
  );
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
  return r.rows[0];
}

export async function deletePolicy(id: number): Promise<void> {
  await pool.query('delete from bot_policies where id=$1', [id]);
}

// ---- Playbooks ----
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
  return r.rows[0];
}

export async function deletePlaybook(id: number): Promise<void> {
  await pool.query('delete from bot_playbooks where id=$1', [id]);
}

// ---- Examples ----
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

// ---- Test cases ----
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
      input.name,
      input.user_text,
      input.expected_intent ?? null,
      input.expected_source_type ?? null,
      input.expected_source_id ?? null,
      input.expected_contains ?? [],
      input.expected_not_contains ?? [],
      input.expected_regex ?? null,
      input.expected_must_ask_fields ?? [],
      input.enabled ?? true
    ]
  );
  return r.rows[0];
}

export async function deleteTestCase(id: number): Promise<void> {
  await pool.query('delete from bot_test_cases where id=$1', [id]);
}

// ---- Decisions ----
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

// ---- Matching ----
const cache = {
  at: 0,
  ttlMs: 15_000,
  faqs: [] as any[],
  playbooks: [] as any[],
  policies: [] as any[]
};

async function refreshCacheIfNeeded() {
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

// ---- Knowledge search (RAG-lite: Postgres full-text search) ----
export async function searchKnowledge(query: string, limit = 5): Promise<Array<{ type: 'policy' | 'faq'; id: number; title: string | null; snippet: string; rank: number }>> {
  const q = String(query || '').trim();
  if (!q) return [];
  const sql = `
    with q as (select plainto_tsquery('spanish', $1) as tsq)
    select * from (
      select
        'policy'::text as type,
        p.id,
        p.title,
        left(p.body, 300) as snippet,
        ts_rank_cd(to_tsvector('spanish', coalesce(p.title,'') || ' ' || coalesce(p.body,'')), q.tsq) as rank
      from bot_policies p, q
      where p.enabled=true and p.draft=false
        and to_tsvector('spanish', coalesce(p.title,'') || ' ' || coalesce(p.body,'')) @@ q.tsq
      union all
      select
        'faq'::text as type,
        f.id,
        f.title,
        left(f.answer, 300) as snippet,
        ts_rank_cd(to_tsvector('spanish', coalesce(f.title,'') || ' ' || coalesce(f.answer,'')), q.tsq) as rank
      from bot_faq f, q
      where f.enabled=true and f.draft=false
        and to_tsvector('spanish', coalesce(f.title,'') || ' ' || coalesce(f.answer,'')) @@ q.tsq
    ) t
    order by t.rank desc
    limit $2;
  `;
  const r = await pool.query(sql, [q, limit]);
  return (r.rows ?? []).map((x: any) => ({
    type: x.type,
    id: Number(x.id),
    title: x.title ?? null,
    snippet: String(x.snippet ?? ''),
    rank: Number(x.rank ?? 0)
  }));
}

// ---- Episodes (training / replay) ----
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
      input.instance ?? null,
      input.remoteJid ?? null,
      input.channel ?? 'whatsapp',
      String(input.user_text ?? ''),
      String(input.reply_text ?? ''),
      input.intent ?? null,
      input.variant ?? null,
      JSON.stringify(input.sources ?? []),
      JSON.stringify(input.extracted ?? {}),
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

// ---- Audit ----
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

// ---- A/B Variants ----
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

export async function matchPolicy(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  for (const row of cache.policies) {
    if (textMatchesTriggers(text, row.triggers || [])) return row;
  }
  return null;
}

export async function matchFaq(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  for (const row of cache.faqs) {
    if (textMatchesTriggers(text, row.triggers || [])) return row;
  }
  return null;
}

export async function matchPlaybook(text: string): Promise<any | null> {
  await refreshCacheIfNeeded();
  for (const row of cache.playbooks) {
    if (textMatchesTriggers(text, row.triggers || [])) return row;
  }
  return null;
}

export function renderTemplate(template: string, ctx: Record<string, any>): string {
  const tpl = String(template || '');

  const getPath = (path: string): any => {
    const parts = String(path).split('.');
    let v: any = ctx;
    for (const p of parts) v = v?.[p];
    return v;
  };

  const evalExpr = (expr: string): boolean => {
    const e = String(expr || '').trim();
    if (!e) return false;
    // Supported: path, path==value, path!=value, path>n, path>=n, path<n, path<=n
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
    const right = Number.isFinite(rightNum) && /^-?\d+(?:\.\d+)?$/.test(rawRight) ? rightNum : rawRight.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    const ln = typeof left === 'number' ? left : Number(left);
    const rn = typeof right === 'number' ? right : Number(right);
    switch (op) {
      case '==':
        return String(left) === String(right);
      case '!=':
        return String(left) !== String(right);
      case '>':
        return Number.isFinite(ln) && Number.isFinite(rn) ? ln > rn : false;
      case '>=':
        return Number.isFinite(ln) && Number.isFinite(rn) ? ln >= rn : false;
      case '<':
        return Number.isFinite(ln) && Number.isFinite(rn) ? ln < rn : false;
      case '<=':
        return Number.isFinite(ln) && Number.isFinite(rn) ? ln <= rn : false;
      default:
        return false;
    }
  };

  // Conditionals: {{#if expr}}...{{/if}} and {{#unless expr}}...{{/unless}}
  const withIf = tpl
    .replace(/\{\{\s*#if\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g, (_m, expr, inner) => (evalExpr(expr) ? inner : ''))
    .replace(/\{\{\s*#unless\s+([^}]+)\}\}([\s\S]*?)\{\{\s*\/unless\s*\}\}/g, (_m, expr, inner) => (!evalExpr(expr) ? inner : ''));

  // Replacements: {path} and {{path}}
  return withIf
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
      const v = getPath(String(key));
      if (v === undefined || v === null) return '';
      return String(v);
    })
    .replace(/\{\s*([a-zA-Z0-9_.-]+)\s*\}/g, (_m, key) => {
      const v = getPath(String(key));
      if (v === undefined || v === null) return '';
      return String(v);
    });
}
