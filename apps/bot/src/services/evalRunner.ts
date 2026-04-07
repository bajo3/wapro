/**
 * evalRunner.ts — Evaluaciones automáticas continuas del bot.
 *
 * Ejecuta casos de la tabla bot_test_cases con tag='evaluation',
 * puntúa cada respuesta y registra el resultado en bot_eval_runs.
 *
 * Reglas:
 *  - runEvalSuite() se llama desde index.ts cada 6h y en startup
 *  - Reutiliza runPlayground() para no enviar mensajes reales
 *  - Si pass_rate < threshold → emite alerta en bot_alerts
 *  - Nunca lanza excepciones al caller
 */

import { pool } from './db.js';
import { runPlayground } from './playground.js';
import { validateReply } from './guardrails.js';
import { emitEvalAlert } from './metricsAggregator.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface EvalCaseResult {
  caseId: number;
  caseName: string;
  userText: string;
  reply: string;
  score: number;               // 0–100
  pass: boolean;
  failReasons: string[];
  hallucinationDetected: boolean;
  guardrailIssues: string[];
}

export interface EvalRunResult {
  runAt: string;
  instanceName: string;
  triggeredBy: string;
  totalCases: number;
  passed: number;
  failed: number;
  passRate: number;
  avgScore: number;
  belowThreshold: boolean;
  caseResults: EvalCaseResult[];
}

const EVAL_PASS_THRESHOLD = 0.80;

// ─── Scorer por caso ──────────────────────────────────────────────────────────

function scoreCase(
  reply: string,
  expectedContains: string | null,
  expectedNotContains: string | null
): { score: number; pass: boolean; failReasons: string[]; hallucinationDetected: boolean; guardrailIssues: string[] } {
  const failReasons: string[] = [];
  let score = 100;

  const grResult = validateReply(reply);
  const hallucinationDetected = grResult.issues.includes('likely_hallucination') ||
    grResult.issues.includes('stock_price_invention' as any);
  const guardrailIssues = grResult.issues as string[];

  // Penalizar alucinación
  if (hallucinationDetected) {
    score -= 50;
    failReasons.push('hallucination_detected');
  }

  // Penalizar si el reply fue bloqueado/vacío
  if (!grResult.ok && !grResult.safeReply) {
    score -= 30;
    failReasons.push('guardrail_blocked_reply');
  }

  // Verificar expected_contains
  if (expectedContains) {
    const patterns = expectedContains.split('|').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const replyLower = reply.toLowerCase();
    const matched = patterns.some((p) => replyLower.includes(p));
    if (!matched) {
      score -= 25;
      failReasons.push(`missing_expected: ${patterns.slice(0, 2).join(' | ')}`);
    }
  }

  // Verificar expected_not_contains
  if (expectedNotContains) {
    const patterns = expectedNotContains.split('|').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const replyLower = reply.toLowerCase();
    const found = patterns.find((p) => replyLower.includes(p));
    if (found) {
      score -= 40;
      failReasons.push(`forbidden_content: ${found}`);
    }
  }

  score = Math.max(0, score);
  const pass = score >= 70 && failReasons.length === 0;

  return { score, pass, failReasons, hallucinationDetected, guardrailIssues };
}

// ─── Runner principal ─────────────────────────────────────────────────────────

export async function runEvalSuite(
  instanceName: string,
  triggeredBy: string = 'scheduled'
): Promise<EvalRunResult> {
  // instanceName is used for DB writes and logging only; playground is instance-agnostic
  const runAt = new Date().toISOString();

  // Cargar casos de evaluación (tag = 'evaluation')
  let testCases: any[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, name, user_text, expected_contains, expected_not_contains
       FROM bot_test_cases
       WHERE tag = 'evaluation'
       ORDER BY id ASC
       LIMIT 50`
    );
    testCases = rows;
  } catch (err) {
    console.warn('[evalRunner] No se pudo cargar test_cases:', err);
    return {
      runAt, instanceName, triggeredBy,
      totalCases: 0, passed: 0, failed: 0,
      passRate: 0, avgScore: 0, belowThreshold: false,
      caseResults: [],
    };
  }

  if (testCases.length === 0) {
    console.info('[evalRunner] No hay casos con tag=evaluation. Skipping.');
    return {
      runAt, instanceName, triggeredBy,
      totalCases: 0, passed: 0, failed: 0,
      passRate: 1, avgScore: 100, belowThreshold: false,
      caseResults: [],
    };
  }

  const caseResults: EvalCaseResult[] = [];

  for (const tc of testCases) {
    let reply = '';
    try {
      const pgResult = await runPlayground({
        text: String(tc.user_text ?? ''),
        state: {},
      });
      reply = String(pgResult?.reply ?? '');
    } catch (err) {
      reply = '';
      console.warn(`[evalRunner] Playground error on case ${tc.id}:`, err);
    }

    const scoring = scoreCase(
      reply,
      tc.expected_contains ?? null,
      tc.expected_not_contains ?? null
    );

    caseResults.push({
      caseId: Number(tc.id),
      caseName: String(tc.name ?? `case_${tc.id}`),
      userText: String(tc.user_text ?? ''),
      reply,
      ...scoring,
    });
  }

  const passed = caseResults.filter((c) => c.pass).length;
  const failed = caseResults.length - passed;
  const passRate = caseResults.length > 0 ? passed / caseResults.length : 1;
  const avgScore = caseResults.length > 0
    ? caseResults.reduce((s, c) => s + c.score, 0) / caseResults.length
    : 100;
  const belowThreshold = passRate < EVAL_PASS_THRESHOLD;

  // Persistir resultado
  try {
    await pool.query(
      `INSERT INTO bot_eval_runs (
        instance_name, triggered_by,
        total_cases, passed, failed, pass_rate, avg_score,
        threshold, below_threshold, case_results, alert_emitted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        instanceName, triggeredBy,
        caseResults.length, passed, failed,
        passRate.toFixed(3), avgScore.toFixed(2),
        EVAL_PASS_THRESHOLD, belowThreshold,
        JSON.stringify(caseResults.map((c) => ({
          caseId: c.caseId,
          caseName: c.caseName,
          score: c.score,
          pass: c.pass,
          failReasons: c.failReasons,
          hallucinationDetected: c.hallucinationDetected,
        }))),
        belowThreshold,
      ]
    );
  } catch (err) {
    console.error('[evalRunner] Error saving eval run result:', err);
  }

  // Emitir alerta si cae bajo umbral
  if (belowThreshold) {
    await emitEvalAlert(instanceName, passRate, EVAL_PASS_THRESHOLD).catch(() => {});
  }

  console.info('[EVAL_RUN]', JSON.stringify({
    instanceName,
    triggeredBy,
    totalCases: caseResults.length,
    passed,
    failed,
    passRate: passRate.toFixed(3),
    avgScore: avgScore.toFixed(1),
    belowThreshold,
  }));

  return {
    runAt, instanceName, triggeredBy,
    totalCases: caseResults.length, passed, failed,
    passRate, avgScore, belowThreshold,
    caseResults,
  };
}

/**
 * Listar los últimos runs de evaluación.
 */
export async function listEvalRuns(
  instanceName: string,
  limit: number = 10
): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT id, run_at, triggered_by, total_cases, passed, failed,
            pass_rate, avg_score, below_threshold, alert_emitted
     FROM bot_eval_runs
     WHERE instance_name = $1
     ORDER BY run_at DESC
     LIMIT $2`,
    [instanceName, Math.min(limit, 50)]
  );
  return rows;
}
