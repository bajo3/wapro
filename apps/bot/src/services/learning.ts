/**
 * learning.ts — Sistema de Aprendizaje Incremental WaPro Bot
 *
 * Responsabilidades:
 *  1. Capturar cada turno de conversación con su contexto completo
 *  2. Auto-puntuar la calidad de cada respuesta (0–1)
 *  3. Registrar feedback humano de operadores del panel
 *  4. Registrar señales de resultado comercial (avance de pipeline, cotización)
 *  5. Seleccionar los mejores ejemplos para inyección few-shot dinámica
 *  6. Promover capturas aprobadas a bot_examples (base de conocimiento)
 *
 * Diseño:
 *  - No bloquea el flujo principal: todas las escrituras son fire-and-forget
 *  - Los scores se calculan en el momento de captura y se actualizan con feedback
 *  - La selección de ejemplos es rápida: usa índices y límite estricto
 *
 * @module learning
 */

import { pool } from './db.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SourceType = 'faq' | 'playbook' | 'agent' | 'gpt' | 'fallback';
export type CaptureStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type HumanRating = -1 | 0 | 1 | 2;

export interface ConversationCapture {
  instance: string;
  remoteJid: string;
  turnIndex?: number;
  userMessage: string;
  botResponse: string;
  intent?: string;
  confidence?: number;
  sourceType: SourceType;
  extractedContext?: Record<string, any>;
  leadScore?: number;
}

export interface DynamicExample {
  intent?: string;
  userText: string;
  idealAnswer: string;
  notes?: string;
  score: number;
}

export interface FeedbackInput {
  captureId: number;
  reviewer: string;          // nombre/email del operador
  rating: HumanRating;       // -1 | 0 | 1 | 2
  correctedResponse?: string;
  errorType?: string;
  notes?: string;
}

export interface CaptureRow {
  id: number;
  instance: string;
  remote_jid: string;
  turn_index: number;
  user_message: string;
  bot_response: string;
  intent: string | null;
  confidence: number | null;
  source_type: string;
  extracted_context: Record<string, any>;
  lead_score: number | null;
  auto_score: number;
  human_rating: number | null;
  outcome_signal: string | null;
  has_error: boolean;
  error_type: string | null;
  status: CaptureStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promoted_to_example_id: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Scoring automático ───────────────────────────────────────────────────────

/**
 * Calcula el score inicial de calidad de una captura.
 *
 * Criterios:
 *  - source_type:    playbook=0.70 | faq=0.65 | agent=0.60 | gpt=0.40 | fallback=0.10
 *  - confidence:     hasta +0.20 extra (confidence * 0.2)
 *  - leadScore alto: +0.05 si lead_score > 40
 *  - intent definido:+0.05
 *  - Penalización:   -0.30 si es fallback
 *
 * Rango final: 0.0 – 1.0
 */
function computeAutoScore(capture: ConversationCapture): number {
  let score = 0.0;

  // Base por tipo de fuente
  const sourceBase: Record<SourceType, number> = {
    playbook: 0.70,
    faq:      0.65,
    agent:    0.60,
    gpt:      0.40,
    fallback: 0.10
  };
  score += sourceBase[capture.sourceType] ?? 0.40;

  // Bonus por confianza del agente
  if (capture.confidence != null && capture.confidence > 0) {
    score += capture.confidence * 0.20;
  }

  // Bonus por lead activo
  if (capture.leadScore != null && capture.leadScore > 40) {
    score += 0.05;
  }

  // Bonus por intent definido
  if (capture.intent && capture.intent !== 'fallback' && capture.intent !== 'gpt_fallback') {
    score += 0.05;
  }

  // Penalización por respuesta muy corta (menos de 30 chars = probablemente filler)
  if (capture.botResponse.trim().length < 30) {
    score -= 0.15;
  }

  // Penalización por respuestas genéricas de fallback
  const genericPatterns = [
    '¿qué auto tenés en mente?',
    'contame marca o presupuesto',
    'decime qué querés mirar'
  ];
  const respLower = capture.botResponse.toLowerCase();
  if (genericPatterns.some(p => respLower.includes(p))) {
    score -= 0.20;
  }

  return Math.max(0.0, Math.min(1.0, score));
}

// ─── Captura de conversación ──────────────────────────────────────────────────

/**
 * Guarda un turno de conversación con su score inicial.
 * Fire-and-forget: no lanzar si falla, solo loguear.
 */
export async function captureConversationTurn(input: ConversationCapture): Promise<number | null> {
  try {
    const autoScore = computeAutoScore(input);

    const result = await pool.query<{ id: number }>(
      `INSERT INTO bot_learning_captures
         (instance, remote_jid, turn_index, user_message, bot_response,
          intent, confidence, source_type, extracted_context, lead_score, auto_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       RETURNING id`,
      [
        input.instance,
        input.remoteJid,
        input.turnIndex ?? 0,
        input.userMessage.slice(0, 2000),       // límite de seguridad
        input.botResponse.slice(0, 4000),
        input.intent ?? null,
        input.confidence ?? null,
        input.sourceType,
        JSON.stringify(input.extractedContext ?? {}),
        input.leadScore ?? null,
        autoScore
      ]
    );

    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[learning] captureConversationTurn error:', err);
    return null;
  }
}

// ─── Señal de resultado comercial ────────────────────────────────────────────

/**
 * Asocia una señal de resultado comercial a las capturas recientes de una
 * conversación (último turno + los 3 anteriores).
 * Llamar cuando: lead avanzó en pipeline, envió cotización, coordinó visita.
 */
export async function linkOutcomeSignal(
  instance: string,
  remoteJid: string,
  signal: 'pipeline_advance' | 'quotation' | 'visit' | 'closed_won' | 'closed_lost'
): Promise<void> {
  try {
    // Boost de score según señal
    const scoreBoost: Record<string, number> = {
      closed_won:       0.20,
      quotation:        0.15,
      pipeline_advance: 0.12,
      visit:            0.10,
      closed_lost:      0.00
    };
    const boost = scoreBoost[signal] ?? 0;

    await pool.query(
      `UPDATE bot_learning_captures
       SET
         outcome_signal = $3,
         auto_score     = LEAST(1.0, auto_score + $4),
         status         = CASE
           WHEN $3 IN ('closed_won', 'quotation', 'pipeline_advance') AND status = 'pending'
           THEN 'approved'
           ELSE status
         END,
         updated_at     = now()
       WHERE instance = $1
         AND remote_jid = $2
         AND outcome_signal IS NULL
         AND id IN (
           SELECT id FROM bot_learning_captures
           WHERE instance = $1 AND remote_jid = $2
           ORDER BY turn_index DESC
           LIMIT 4
         )`,
      [instance, remoteJid, signal, boost]
    );
  } catch (err) {
    console.error('[learning] linkOutcomeSignal error:', err);
  }
}

// ─── Marcar error ─────────────────────────────────────────────────────────────

/**
 * Marca una captura como errónea. Rebaja su score y la pone como 'flagged'.
 */
export async function flagCaptureError(
  captureId: number,
  errorType: 'invented_price' | 'wrong_currency' | 'redundant_question' | 'hallucination' | 'generic_fallback'
): Promise<void> {
  try {
    await pool.query(
      `UPDATE bot_learning_captures
       SET has_error  = true,
           error_type = $2,
           auto_score = LEAST(auto_score, 0.15),
           status     = 'flagged',
           updated_at = now()
       WHERE id = $1`,
      [captureId, errorType]
    );
  } catch (err) {
    console.error('[learning] flagCaptureError error:', err);
  }
}

// ─── Feedback humano ──────────────────────────────────────────────────────────

/**
 * Registra el feedback de un operador sobre una captura.
 * El trigger SQL se encarga de actualizar el auto_score y status.
 */
export async function submitFeedback(input: FeedbackInput): Promise<{ ok: boolean; id?: number; error?: string }> {
  try {
    // Verificar que la captura existe
    const check = await pool.query<{ id: number }>(
      'SELECT id FROM bot_learning_captures WHERE id = $1',
      [input.captureId]
    );
    if (check.rowCount === 0) {
      return { ok: false, error: 'capture_not_found' };
    }

    const result = await pool.query<{ id: number }>(
      `INSERT INTO bot_learning_feedback
         (capture_id, reviewer, rating, corrected_response, error_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.captureId,
        input.reviewer.slice(0, 200),
        input.rating,
        input.correctedResponse?.slice(0, 4000) ?? null,
        input.errorType ?? null,
        input.notes?.slice(0, 1000) ?? null
      ]
    );

    // Si hay respuesta corregida, promover automáticamente como ejemplo
    if (input.rating >= 1 && input.correctedResponse) {
      void promoteToExample(
        input.captureId,
        input.correctedResponse,
        input.reviewer
      );
    }

    return { ok: true, id: result.rows[0]?.id };
  } catch (err: any) {
    console.error('[learning] submitFeedback error:', err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ─── Promover captura a bot_examples ─────────────────────────────────────────

/**
 * Promueve una captura aprobada al banco de ejemplos activo (bot_examples).
 * Los ejemplos promovidos son usados directamente por el sistema de knowledge.
 */
export async function promoteToExample(
  captureId: number,
  idealAnswerOverride?: string,
  promotedBy?: string
): Promise<{ ok: boolean; exampleId?: number; error?: string }> {
  try {
    const capResult = await pool.query<CaptureRow>(
      'SELECT * FROM bot_learning_captures WHERE id = $1',
      [captureId]
    );
    if (capResult.rowCount === 0) {
      return { ok: false, error: 'capture_not_found' };
    }

    const cap = capResult.rows[0];
    const idealAnswer = idealAnswerOverride ?? cap.bot_response;

    // Insertar en bot_examples
    const exResult = await pool.query<{ id: number }>(
      `INSERT INTO bot_examples
         (intent, user_text, ideal_answer, notes, source, quality_score, validated)
       VALUES ($1, $2, $3, $4, 'promoted', $5, true)
       RETURNING id`,
      [
        cap.intent ?? 'general',
        cap.user_message,
        idealAnswer,
        `Promovido desde captura #${captureId}${promotedBy ? ` por ${promotedBy}` : ''}`,
        Math.min(1.0, (cap.auto_score ?? 0.7) + 0.1)  // boost por ser promovido
      ]
    );

    const exampleId = exResult.rows[0]?.id;

    // Vincular la captura al ejemplo
    await pool.query(
      `UPDATE bot_learning_captures
       SET promoted_to_example_id = $2, status = 'approved', updated_at = now()
       WHERE id = $1`,
      [captureId, exampleId]
    );

    return { ok: true, exampleId };
  } catch (err: any) {
    console.error('[learning] promoteToExample error:', err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ─── Selección de ejemplos few-shot dinámicos ─────────────────────────────────

/**
 * Selecciona los mejores ejemplos para inyectar como few-shot en el prompt.
 *
 * Estrategia:
 *  1. Prioridad 1: capturas aprobadas con intent coincidente (si se provee)
 *  2. Prioridad 2: capturas aprobadas con auto_score >= 0.70 de cualquier intent
 *  3. Prioridad 3: ejemplos de bot_examples validados con quality_score alto
 *
 * Límite máximo: `maxExamples` (default 5)
 * No incluye ejemplos repetidos (deduplicación por user_message)
 */
export async function selectDynamicExamples(opts: {
  intent?: string;
  maxExamples?: number;
}): Promise<DynamicExample[]> {
  const max = Math.min(opts.maxExamples ?? 5, 10);
  const examples: DynamicExample[] = [];
  const seenTexts = new Set<string>();

  try {
    // ── Paso 1: capturas con intent coincidente (si aplica) ───────────────────
    if (opts.intent) {
      const intentResult = await pool.query<{
        user_message: string;
        bot_response: string;
        intent: string | null;
        effective_score: number;
      }>(
        `SELECT user_message, bot_response, intent, effective_score
         FROM bot_learning_candidates
         WHERE is_candidate = true
           AND intent = $1
         ORDER BY effective_score DESC
         LIMIT $2`,
        [opts.intent, Math.ceil(max / 2)]
      );

      for (const row of intentResult.rows) {
        const key = row.user_message.toLowerCase().trim();
        if (!seenTexts.has(key) && examples.length < max) {
          seenTexts.add(key);
          examples.push({
            intent:      row.intent ?? undefined,
            userText:    row.user_message,
            idealAnswer: row.bot_response,
            score:       Number(row.effective_score)
          });
        }
      }
    }

    // ── Paso 2: mejores capturas generales para completar el cupo ─────────────
    if (examples.length < max) {
      const remaining = max - examples.length;
      const generalResult = await pool.query<{
        user_message: string;
        bot_response: string;
        intent: string | null;
        effective_score: number;
      }>(
        `SELECT user_message, bot_response, intent, effective_score
         FROM bot_learning_candidates
         WHERE is_candidate = true
           AND ($1::text IS NULL OR intent != $1)
         ORDER BY effective_score DESC
         LIMIT $2`,
        [opts.intent ?? null, remaining * 2]  // fetch extra para filtrar duplicados
      );

      for (const row of generalResult.rows) {
        const key = row.user_message.toLowerCase().trim();
        if (!seenTexts.has(key) && examples.length < max) {
          seenTexts.add(key);
          examples.push({
            intent:      row.intent ?? undefined,
            userText:    row.user_message,
            idealAnswer: row.bot_response,
            score:       Number(row.effective_score)
          });
        }
      }
    }

    // ── Paso 3: completar con bot_examples validados si sigue corto ───────────
    if (examples.length < Math.min(3, max)) {
      const remaining = max - examples.length;
      const exResult = await pool.query<{
        user_text: string;
        ideal_answer: string;
        intent: string;
        quality_score: number;
        notes: string | null;
      }>(
        `SELECT user_text, ideal_answer, intent, quality_score, notes
         FROM bot_examples
         WHERE validated = true
           AND ($1::text IS NULL OR intent = $1)
         ORDER BY quality_score DESC
         LIMIT $2`,
        [opts.intent ?? null, remaining]
      );

      for (const row of exResult.rows) {
        const key = row.user_text.toLowerCase().trim();
        if (!seenTexts.has(key) && examples.length < max) {
          seenTexts.add(key);
          examples.push({
            intent:      row.intent,
            userText:    row.user_text,
            idealAnswer: row.ideal_answer,
            notes:       row.notes ?? undefined,
            score:       Number(row.quality_score)
          });
        }
      }
    }

    // Registrar uso en bot_examples (analytics, async)
    void incrementExamplesUsageCount(examples);

  } catch (err) {
    console.error('[learning] selectDynamicExamples error:', err);
  }

  return examples;
}

// Helper: incrementar contador de uso en bot_examples
async function incrementExamplesUsageCount(examples: DynamicExample[]): Promise<void> {
  // Solo para ejemplos que vienen de bot_examples (tienen notes con "Promovido" o no tienen notes)
  // No es crítico, ignorar errores
  try {
    if (examples.length === 0) return;
    // Incremento global de uso
    await pool.query(
      `UPDATE bot_examples
       SET usage_count = usage_count + 1
       WHERE validated = true
       AND user_text = ANY($1::text[])`,
      [examples.map(e => e.userText)]
    );
  } catch {}
}

// ─── Formateo de ejemplos para el prompt ─────────────────────────────────────

/**
 * Convierte una lista de DynamicExample al formato de bloque few-shot
 * que se inyecta en el system prompt del agente.
 */
export function formatExamplesForPrompt(examples: DynamicExample[]): string {
  if (examples.length === 0) return '';

  const lines: string[] = ['── EJEMPLOS DINÁMICOS (aprendidos de conversaciones reales) ──', ''];

  for (const ex of examples) {
    lines.push(`ENTRADA: "${ex.userText}"`);
    lines.push('SALIDA CORRECTA (suggestedReply):');
    // Indentar cada línea de la respuesta
    const responseLines = ex.idealAnswer.split('\n').map(l => `  ${l}`);
    lines.push(...responseLines);
    if (ex.notes) {
      lines.push(`[Nota: ${ex.notes}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Consultas de administración ─────────────────────────────────────────────

/**
 * Listar capturas recientes para revisión en el panel.
 */
export async function listCaptures(opts: {
  status?: CaptureStatus | 'all';
  limit?: number;
  offset?: number;
  intent?: string;
}): Promise<{ rows: CaptureRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const filters: string[] = [];
  const params: any[] = [];
  let pi = 1;

  if (opts.status && opts.status !== 'all') {
    filters.push(`status = $${pi++}`);
    params.push(opts.status);
  }
  if (opts.intent) {
    filters.push(`intent = $${pi++}`);
    params.push(opts.intent);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const [rowsResult, countResult] = await Promise.all([
    pool.query<CaptureRow>(
      `SELECT * FROM bot_learning_captures
       ${where}
       ORDER BY created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_learning_captures ${where}`,
      params
    )
  ]);

  return {
    rows:  rowsResult.rows,
    total: parseInt(countResult.rows[0]?.count ?? '0', 10)
  };
}

/**
 * Resumen de estadísticas del sistema de aprendizaje.
 */
export async function getLearningStats(): Promise<Record<string, any>> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                           AS total_captures,
        COUNT(*) FILTER (WHERE status = 'approved')       AS approved,
        COUNT(*) FILTER (WHERE status = 'pending')        AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected')       AS rejected,
        COUNT(*) FILTER (WHERE status = 'flagged')        AS flagged,
        COUNT(*) FILTER (WHERE human_rating IS NOT NULL)  AS has_human_feedback,
        COUNT(*) FILTER (WHERE outcome_signal IS NOT NULL) AS has_outcome,
        ROUND(AVG(auto_score)::numeric, 3)                AS avg_auto_score,
        COUNT(*) FILTER (WHERE promoted_to_example_id IS NOT NULL) AS promoted,
        COUNT(*) FILTER (WHERE has_error = true)          AS errors
      FROM bot_learning_captures
    `);

    const intentResult = await pool.query(`
      SELECT intent, COUNT(*) AS cnt
      FROM bot_learning_captures
      WHERE intent IS NOT NULL
      GROUP BY intent
      ORDER BY cnt DESC
      LIMIT 10
    `);

    return {
      ...result.rows[0],
      top_intents: intentResult.rows
    };
  } catch (err) {
    console.error('[learning] getLearningStats error:', err);
    return {};
  }
}

/**
 * Obtener una captura individual por ID.
 */
export async function getCaptureById(id: number): Promise<CaptureRow | null> {
  try {
    const result = await pool.query<CaptureRow>(
      'SELECT * FROM bot_learning_captures WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Listar feedback de una captura específica.
 */
export async function listCaptureFeedback(captureId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM bot_learning_feedback
       WHERE capture_id = $1
       ORDER BY created_at DESC`,
      [captureId]
    );
    return result.rows;
  } catch {
    return [];
  }
}
