import { pool } from './db.js';
import { runPlayground } from './playground.js';

export type TestRunResult = {
  id: number;
  name: string;
  user_text: string;
  expected_intent?: string | null;
  expected_source_type?: string | null;
  expected_source_id?: number | null;
  expected_contains: string[];
  actual_intent: string;
  actual_sources: any[];
  reply: string;
  pass: boolean;
  reasons: string[];
};

function containsAll(text: string, needles: string[]): string[] {
  const missing: string[] = [];
  const hay = String(text || '').toLowerCase();
  for (const n of needles || []) {
    const nn = String(n || '').toLowerCase().trim();
    if (!nn) continue;
    if (!hay.includes(nn)) missing.push(n);
  }
  return missing;
}

export async function runTestSuite(limit = 200): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: TestRunResult[];
}> {
  const r = await pool.query(
    'select * from bot_test_cases where enabled=true order by id desc limit $1',
    [limit]
  );
  const cases = r.rows ?? [];

  const results: TestRunResult[] = [];

  for (const tc of cases) {
    const sim = await runPlayground({ text: tc.user_text });
    const reasons: string[] = [];

    if (tc.expected_intent) {
      const exp = String(tc.expected_intent);
      if (String(sim.intent) !== exp) reasons.push(`intent esperado=${exp} actual=${sim.intent}`);
    }

    if (tc.expected_source_type) {
      const expType = String(tc.expected_source_type);
      const ok = (sim.sources || []).some((s: any) => String(s.type) === expType);
      if (!ok) reasons.push(`source_type esperado=${expType} no encontrado`);
    }

    if (tc.expected_source_id) {
      const expId = Number(tc.expected_source_id);
      const ok = (sim.sources || []).some((s: any) => Number(s.id) === expId);
      if (!ok) reasons.push(`source_id esperado=${expId} no encontrado`);
    }

    const expContains: string[] = Array.isArray(tc.expected_contains) ? tc.expected_contains : [];
    const missing = containsAll(sim.reply, expContains);
    if (missing.length) reasons.push(`faltan textos: ${missing.join(' | ')}`);

    const pass = reasons.length === 0;
    results.push({
      id: tc.id,
      name: tc.name,
      user_text: tc.user_text,
      expected_intent: tc.expected_intent,
      expected_source_type: tc.expected_source_type,
      expected_source_id: tc.expected_source_id,
      expected_contains: expContains,
      actual_intent: sim.intent,
      actual_sources: sim.sources,
      reply: sim.reply,
      pass,
      reasons
    });
  }

  const total = results.length;
  const passed = results.filter((x) => x.pass).length;
  const failed = total - passed;
  return { total, passed, failed, results };
}
