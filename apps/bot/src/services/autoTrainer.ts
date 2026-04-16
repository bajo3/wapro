/**
 * autoTrainer.ts — Learning loop offline/controlado.
 *
 * NO hay autoaprendizaje en caliente.
 * Sí hay aprendizaje en batch controlado por admin/operador.
 *
 * Flujo:
 * 1. El bot loggea eventos de pipeline (pipelineLogger)
 * 2. Un admin revisa y marca respuestas como buenas/malas (endpoint admin)
 * 3. autoTrainer extrae ejemplos candidatos de bot_pipeline_logs
 * 4. Admin aprueba → se guardan en bot_examples con score
 * 5. exampleSelector los inyecta en futuras composiciones
 *
 * Este archivo expone:
 * - extractCandidates() → encuentra turnos candidatos a ejemplo
 * - promoteToExample()  → aprueba un candidato y lo guarda en bot_examples
 * - markDropped()       → marca un ejemplo como malo (score=0, outcome=dropped)
 */

import { pool } from './db.js';
import { saveExample } from './exampleSelector.js';
import type { RouterAction } from './runtimeRouter.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface TrainingCandidate {
  id: string;              // ID del log en bot_pipeline_logs
  instance: string;
  remoteJid: string;
  createdAt: string;
  intent?: string;
  action?: RouterAction;
  guardPassed?: boolean;
  isHotLead?: boolean;
  leadScore?: number;
  replyLength?: number;
  eventData: Record<string, any>;
}

export interface PromoteExampleParams {
  logId: string;           // ID de bot_pipeline_logs
  userInput: string;       // Mensaje del cliente (del log o ingresado por admin)
  botOutput: string;       // Respuesta del bot (del log o editada por admin)
  outcome: 'converted' | 'continued';
  score: number;           // 0..100
  tags?: string[];
}

// ── Extractor de candidatos ───────────────────────────────────────────────────

/**
 * Encuentra turnos candidatos a convertir en ejemplos.
 *
 * Criterios de selección:
 * - guardPassed=true (respuesta validada por truthGuard)
 * - Turno de lead caliente (isHotLead=true) o con leadScore >= 50
 * - Acción clara (no SAFE_FALLBACK)
 * - No marcados como dropped aún
 */
export async function extractCandidates(limit = 20): Promise<TrainingCandidate[]> {
  try {
    const rows = await pool.query<{
      id: string;
      instance: string;
      remote_jid: string;
      intent: string | null;
      action: string | null;
      guard_passed: boolean | null;
      is_hot_lead: boolean | null;
      lead_score: number | null;
      reply_length: number | null;
      event_data: Record<string, any>;
      created_at: string;
    }>(
      `SELECT id, instance, remote_jid, intent, action, guard_passed,
              is_hot_lead, lead_score, reply_length, event_data, created_at
       FROM bot_pipeline_logs
       WHERE guard_passed = true
         AND action NOT IN ('SAFE_FALLBACK', 'GREETING', 'FAREWELL')
         AND id NOT IN (
           SELECT COALESCE((event_data->>'logId'), '') FROM bot_examples WHERE event_data IS NOT NULL
         )
       ORDER BY is_hot_lead DESC, lead_score DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [limit]
    );

    return rows.rows.map(r => ({
      id: r.id,
      instance: r.instance,
      remoteJid: r.remote_jid,
      createdAt: r.created_at,
      intent: r.intent ?? undefined,
      action: r.action as RouterAction | undefined,
      guardPassed: r.guard_passed ?? undefined,
      isHotLead: r.is_hot_lead ?? undefined,
      leadScore: r.lead_score ?? undefined,
      replyLength: r.reply_length ?? undefined,
      eventData: r.event_data ?? {},
    }));
  } catch (e) {
    console.error('[autoTrainer] extractCandidates error:', e);
    return [];
  }
}

// ── Promotor de ejemplos ──────────────────────────────────────────────────────

/**
 * Aprueba un candidato y lo guarda en bot_examples.
 * Llamado desde endpoint admin cuando el operador aprueba una respuesta.
 */
export async function promoteToExample(params: PromoteExampleParams): Promise<void> {
  const action = params.tags?.[0] ?? 'unknown';

  await saveExample({
    intent: action,
    tags: params.tags ?? [],
    input: params.userInput,
    output: params.botOutput,
    outcome: params.outcome,
    score: params.score,
  });

  console.info(`[autoTrainer] promoted logId=${params.logId} intent=${action} score=${params.score}`);
}

// ── Marker de ejemplos malos ──────────────────────────────────────────────────

/**
 * Marca un turno como malo (no usar como ejemplo).
 * Crea una entrada en bot_examples con outcome=dropped y score=0
 * para que no vuelva a aparecer en extractCandidates.
 */
export async function markDropped(logId: string, reason?: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bot_examples (intent, tags, input, output, outcome, score, event_data, created_at)
       VALUES ('dropped', '{}', '', '', 'dropped', 0, $1, now())`,
      [JSON.stringify({ logId, reason })]
    );
    console.info(`[autoTrainer] markDropped logId=${logId} reason=${reason ?? 'none'}`);
  } catch (e) {
    console.error('[autoTrainer] markDropped error:', e);
  }
}

// ── Estadísticas de entrenamiento ─────────────────────────────────────────────

export interface TrainingStats {
  totalExamples: number;
  byIntent: Record<string, number>;
  avgScore: number;
  withOutcome: number;
}

export async function getTrainingStats(): Promise<TrainingStats> {
  try {
    const res = await pool.query<{
      intent: string;
      count: string;
      avg_score: string;
      with_outcome: string;
    }>(
      `SELECT intent,
              COUNT(*)::text as count,
              AVG(score)::text as avg_score,
              SUM(CASE WHEN outcome IS NOT NULL AND outcome != 'dropped' THEN 1 ELSE 0 END)::text as with_outcome
       FROM bot_examples
       WHERE outcome != 'dropped' OR outcome IS NULL
       GROUP BY intent`
    );

    const byIntent: Record<string, number> = {};
    let totalExamples = 0;
    let totalScore = 0;
    let withOutcome = 0;

    for (const row of res.rows) {
      const count = parseInt(row.count, 10);
      byIntent[row.intent] = count;
      totalExamples += count;
      totalScore += parseFloat(row.avg_score) * count;
      withOutcome += parseInt(row.with_outcome, 10);
    }

    return {
      totalExamples,
      byIntent,
      avgScore: totalExamples > 0 ? Math.round(totalScore / totalExamples) : 0,
      withOutcome,
    };
  } catch {
    return { totalExamples: 0, byIntent: {}, avgScore: 0, withOutcome: 0 };
  }
}
