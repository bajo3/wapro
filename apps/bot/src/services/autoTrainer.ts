/**
 * autoTrainer.ts — Auto-aprendizaje post-conversación para WaPro bot
 *
 * Responsabilidades:
 *  1. Detectar conversaciones terminadas (idle 1–6h) no analizadas aún
 *  2. Resumir la conversación y pedirle a GPT que la evalúe
 *  3. Generar automáticamente nuevas entradas de FAQ para gaps detectados
 *  4. Promover capturas de alta calidad a bot_examples
 *  5. Registrar patrones de objeciones, cierres y gaps de stock
 *
 * Diseño:
 *  - Fire-and-forget: no bloquea ningún flujo principal
 *  - Idempotente: usa flag last_autotrainer_at en state para no re-analizar
 *  - Seguro: nunca crea precios, stock ni datos de catálogo inventados
 *  - Máximo 1 análisis cada 4h por conversación
 *
 * @module autoTrainer
 */

import { pool } from './db.js';
import { askGPTJson } from './gpt.js';
import { createFaq, invalidateCache } from './intelligence.js';
import {
  autoExtractPatterns,
  upsertLearningPattern,
  promoteToExample,
  listCaptures,
  getLearningStats,
  type LearningPatternInput,
} from './learning.js';
import { setState, getState } from './state.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrainerResult {
  instance: string;
  remoteJid: string;
  /** Number of FAQ entries auto-created */
  faqsCreated: number;
  /** Number of captures promoted to examples */
  promoted: number;
  /** Number of patterns logged */
  patternsLogged: number;
  /** GPT quality score 0–1 */
  qualityScore: number | null;
  /** What the user actually wanted */
  userWanted: string | null;
  /** Whether the conversation resolved the user's need */
  wasAnswered: boolean | null;
  /** Objections detected in this conversation */
  objectionsDetected: string[];
  /** Lead outcome */
  leadOutcome: string | null;
  /** Skipped (already analyzed or not enough data) */
  skipped: boolean;
  skippedReason?: string;
}

interface GptConversationAnalysis {
  quality_score: number;
  what_user_wanted: string;
  was_answered: boolean;
  friction_detected: string[];
  missing_knowledge: string[];
  suggested_faqs: Array<{
    question: string;
    answer: string;
    triggers: string[];
  }>;
  best_response: string | null;
  worst_response: string | null;
  objections_detected: string[];
  lead_outcome:
    | 'closed_interest'
    | 'closed_lost'
    | 'no_advance'
    | 'escalated'
    | 'needs_followup';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_TURNS_TO_ANALYZE = 3;      // need at least 3 user turns
const MIN_IDLE_MS = 60 * 60 * 1000;  // 1h idle before analyzing
const MAX_IDLE_MS = 8 * 60 * 60 * 1000; // skip if idle > 8h (probably abandoned)
const REANALYZE_AFTER_MS = 4 * 60 * 60 * 1000; // don't re-analyze within 4h
const MAX_FAQ_PER_CONVERSATION = 3;  // max FAQs to auto-generate per conversation
const MAX_CONVERSATIONS_PER_RUN = 10; // max conversations analyzed per scan

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildAnalysisPrompt(
  conversationText: string,
  instance: string
): string {
  return `Sos supervisor de calidad de un bot de ventas de autos.
Analizá esta conversación de WhatsApp y devolvé SOLO JSON válido (sin markdown ni texto extra).

CONVERSACIÓN:
${conversationText}

Responde con este JSON exacto:
{
  "quality_score": <número 0.0 a 1.0>,
  "what_user_wanted": "<descripción corta de la intención real del usuario>",
  "was_answered": <true o false>,
  "friction_detected": ["<fricción detectada 1>", ...],
  "missing_knowledge": ["<pregunta que el bot no supo responder bien>", ...],
  "suggested_faqs": [
    {
      "question": "<pregunta frecuente detectada>",
      "answer": "<respuesta ideal, concisa, en español argentino, vendedora>",
      "triggers": ["<palabra clave 1>", "<palabra clave 2>"]
    }
  ],
  "best_response": "<la mejor respuesta del bot, o null si ninguna fue buena>",
  "worst_response": "<la peor respuesta del bot, o null>",
  "objections_detected": ["<objeción detectada>", ...],
  "lead_outcome": "<una de: closed_interest | closed_lost | no_advance | escalated | needs_followup>"
}

Reglas:
- Máximo ${MAX_FAQ_PER_CONVERSATION} FAQs sugeridas por conversación
- Las respuestas en suggested_faqs deben ser cortas (2-4 líneas), en argentino, vendedoras pero honestas
- NO inventar precios, stock, versiones ni datos de catálogo
- Si el bot inventó datos o repitió preguntas, bajar quality_score drásticamente
- Si el lead tuvo señal de compra pero el bot no derivó a humano, friction_detected debe mencionarlo`;
}

// ─── Conversation Summarizer ─────────────────────────────────────────────────

async function buildConversationText(
  instance: string,
  remoteJid: string,
  maxTurns = 20
): Promise<string | null> {
  try {
    // Load recent captures for this conversation
    const result = await pool.query(
      `SELECT user_message, bot_response, intent, auto_score, created_at
       FROM bot_learning_captures
       WHERE instance = $1 AND remote_jid = $2
       ORDER BY turn_index ASC
       LIMIT $3`,
      [instance, remoteJid, maxTurns]
    );

    if (!result.rows || result.rows.length < MIN_TURNS_TO_ANALYZE) {
      return null;
    }

    const lines: string[] = [];
    for (const row of result.rows) {
      const ts = new Date(row.created_at).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(`[${ts}] USUARIO: ${String(row.user_message ?? '').slice(0, 300)}`);
      lines.push(`[${ts}] BOT: ${String(row.bot_response ?? '').slice(0, 400)}`);
      lines.push('');
    }

    return lines.join('\n').slice(0, 4000); // keep within token budget
  } catch (err) {
    console.error('[autoTrainer] buildConversationText error:', err);
    return null;
  }
}

// ─── Main Trainer Function ────────────────────────────────────────────────────

/**
 * Analyze a single conversation, generate FAQs, promote examples, log patterns.
 * Safe to call multiple times — idempotent via last_autotrainer_at flag.
 */
export async function learnFromConversation(
  instance: string,
  remoteJid: string
): Promise<TrainerResult> {
  const base: TrainerResult = {
    instance,
    remoteJid,
    faqsCreated: 0,
    promoted: 0,
    patternsLogged: 0,
    qualityScore: null,
    userWanted: null,
    wasAnswered: null,
    objectionsDetected: [],
    leadOutcome: null,
    skipped: false,
  };

  try {
    // ── 1. Check if already analyzed recently ───────────────────────────────
    const state = await getState(instance, remoteJid);
    const lastAnalyzed = (state as any)?.last_autotrainer_at;
    if (lastAnalyzed) {
      const lastAnalyzedMs = Date.parse(String(lastAnalyzed));
      if (!Number.isNaN(lastAnalyzedMs) && Date.now() - lastAnalyzedMs < REANALYZE_AFTER_MS) {
        return { ...base, skipped: true, skippedReason: 'recently_analyzed' };
      }
    }

    // ── 2. Build conversation text ──────────────────────────────────────────
    const conversationText = await buildConversationText(instance, remoteJid);
    if (!conversationText) {
      return { ...base, skipped: true, skippedReason: 'not_enough_turns' };
    }

    // ── 3. Call GPT for self-reflection ────────────────────────────────────
    console.log(`[autoTrainer] analyzing conversation ${remoteJid.split('@')[0]} on ${instance}`);
    const prompt = buildAnalysisPrompt(conversationText, instance);

    const analysis = await askGPTJson<GptConversationAnalysis>({
      systemPrompt: 'Sos un supervisor de calidad de un bot de ventas. Respondés SOLO JSON válido, sin explicaciones.',
      userMessage: prompt,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      maxTokens: 800,
      temperature: 0.2,
    });

    if (!analysis || typeof analysis !== 'object') {
      // Even without GPT analysis, extract patterns deterministically
      await autoExtractPatterns({ lookbackHours: 6 });
      return { ...base, skipped: true, skippedReason: 'gpt_no_response' };
    }

    base.qualityScore = Number(analysis.quality_score ?? 0) || null;
    base.userWanted = String(analysis.what_user_wanted ?? '').slice(0, 200) || null;
    base.wasAnswered = Boolean(analysis.was_answered);
    base.objectionsDetected = Array.isArray(analysis.objections_detected)
      ? analysis.objections_detected.slice(0, 5).map((o) => String(o).slice(0, 200))
      : [];
    base.leadOutcome = String(analysis.lead_outcome ?? '').slice(0, 50) || null;

    // ── 4. Auto-generate FAQs from suggested_faqs ──────────────────────────
    if (Array.isArray(analysis.suggested_faqs) && analysis.suggested_faqs.length > 0) {
      for (const faq of analysis.suggested_faqs.slice(0, MAX_FAQ_PER_CONVERSATION)) {
        const question = String(faq.question ?? '').trim();
        const answer = String(faq.answer ?? '').trim();
        const triggers = Array.isArray(faq.triggers)
          ? faq.triggers.filter((t) => typeof t === 'string' && t.trim()).map((t) => String(t).trim().toLowerCase())
          : [];

        if (!question || !answer || answer.length < 15) continue;
        if (triggers.length < 1) continue;

        // Don't create FAQs with SPECIFIC prices/rates (inventados) but allow general price context.
        // Allows: "hasta ARS 30 millones", "financiamos hasta el 50%"
        // Blocks: "la cuota es ARS 45.000", "$12.500.000", exact decimal rates
        const forbiddenPatterns = /\$\s*\d{4,}|\d{4,}[.,]\d{3}|\bARS\s+\d{4,}|\bUSD\s+\d{3,}|tasa\s+(?:del\s+)?\d+[,.]\d{2}/i;
        if (forbiddenPatterns.test(answer)) {
          console.log(`[autoTrainer] skipping FAQ with specific price/rate data: "${question}"`);
          continue;
        }

        try {
          await createFaq({
            title: question.slice(0, 200),
            triggers,
            answer,
            enabled: true,
            draft: true, // operator must review before activation
          });
          base.faqsCreated++;
          console.log(`[autoTrainer] created draft FAQ: "${question}"`);
        } catch (err) {
          console.error('[autoTrainer] createFaq error:', err);
        }
      }
    }

    // ── 5. Log objection patterns ──────────────────────────────────────────
    for (const objection of base.objectionsDetected) {
      const pat: LearningPatternInput = {
        patternType: 'objection',
        patternKey: objection.toLowerCase().slice(0, 200),
        sampleMessage: objection.slice(0, 300),
        confidence: 0.7,
      };
      await upsertLearningPattern(pat);
      base.patternsLogged++;
    }

    // ── 6. Log friction patterns ──────────────────────────────────────────
    if (Array.isArray(analysis.friction_detected)) {
      for (const friction of analysis.friction_detected.slice(0, 3)) {
        const key = String(friction).toLowerCase().trim().slice(0, 200);
        if (key) {
          await upsertLearningPattern({
            patternType: 'failure_pattern',
            patternKey: key,
            patternValue: String(friction).slice(0, 500),
            confidence: 0.6,
          });
          base.patternsLogged++;
        }
      }
    }

    // ── 7. Log successful outcome patterns ────────────────────────────────
    if (
      analysis.lead_outcome === 'closed_interest' ||
      analysis.lead_outcome === 'escalated'
    ) {
      await upsertLearningPattern({
        patternType: 'visit_pattern',
        patternKey: `outcome:${analysis.lead_outcome}`,
        patternValue: base.userWanted ?? 'unknown',
        confidence: 0.8,
      });
      base.patternsLogged++;
    }

    // ── 8. Promote high-quality captures to examples ───────────────────────
    // Quality gate (multi-criteria) — all must pass before promoting:
    //   a) GPT quality score >= 0.72 (raised from 0.70 to reduce noise)
    //   b) GPT judged the conversation as answered (was_answered=true)
    //   c) Lead outcome shows real intent (not 'no_advance' or 'closed_lost')
    //   d) No hallucination signals (best_response must not contain specific prices)
    const PROMOTE_SCORE_THRESHOLD = 0.72;
    const PROMOTE_FORBIDDEN_OUTCOME = new Set(['no_advance', 'closed_lost']);
    const hallucPriceRe = /\$\s*\d{5,}|\d{5,}[.,]\d{3}|\bARS\s+\d{5,}|\bUSD\s+\d{3,}/i;
    const canPromote =
      base.qualityScore !== null &&
      base.qualityScore >= PROMOTE_SCORE_THRESHOLD &&
      analysis.was_answered === true &&
      !PROMOTE_FORBIDDEN_OUTCOME.has(String(analysis.lead_outcome ?? '')) &&
      analysis.best_response &&
      !hallucPriceRe.test(String(analysis.best_response ?? ''));

    if (!canPromote && base.qualityScore !== null) {
      console.log(
        `[autoTrainer] skipping promotion for ${remoteJid.split('@')[0]}: ` +
        `score=${base.qualityScore?.toFixed(2)} answered=${analysis.was_answered} outcome=${analysis.lead_outcome}`
      );
    }

    if (canPromote && analysis.best_response && typeof analysis.best_response === 'string') {
      try {
        // Find the capture whose bot_response most closely matches the best_response
        const matchResult = await pool.query(
          `SELECT id, bot_response FROM bot_learning_captures
           WHERE instance = $1 AND remote_jid = $2
             AND status = 'pending'
             AND auto_score >= 0.65
           ORDER BY auto_score DESC
           LIMIT 3`,
          [instance, remoteJid]
        );

        for (const row of matchResult.rows) {
          if (
            row.bot_response &&
            analysis.best_response &&
            String(row.bot_response).includes(String(analysis.best_response).slice(0, 50))
          ) {
            const promoteResult = await promoteToExample(row.id, undefined, 'autoTrainer');
            if (promoteResult.ok) {
              base.promoted++;
              console.log(`[autoTrainer] promoted capture #${row.id} to example (score=${base.qualityScore?.toFixed(2)})`);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[autoTrainer] promote error:', err);
      }
    }

    // ── 9. Mark conversation as analyzed ──────────────────────────────────
    try {
      const currentState = await getState(instance, remoteJid);
      await setState(instance, remoteJid, {
        ...(currentState as any),
        last_autotrainer_at: new Date().toISOString(),
        last_autotrainer_quality: base.qualityScore,
        last_autotrainer_outcome: base.leadOutcome,
      } as any);
    } catch (err) {
      console.error('[autoTrainer] setState error:', err);
    }

    console.log(
      `[autoTrainer] done ${remoteJid.split('@')[0]}: quality=${base.qualityScore?.toFixed(2)} faqs=${base.faqsCreated} promoted=${base.promoted} patterns=${base.patternsLogged}`
    );

    return base;
  } catch (err) {
    console.error('[autoTrainer] learnFromConversation error:', err);
    return { ...base, skipped: true, skippedReason: 'internal_error' };
  }
}

// ─── Batch Scan ───────────────────────────────────────────────────────────────

export interface AutoTrainerScanResult {
  analyzed: number;
  skipped: number;
  faqsCreated: number;
  promoted: number;
  patternsLogged: number;
  errors: number;
  patternsExtracted: number;
}

/**
 * Scan recent idle conversations and run learnFromConversation on each.
 * Also runs autoExtractPatterns for the last 6h.
 *
 * Called periodically from index.ts (every 3–4h).
 */
export async function runAutoTrainerScan(opts?: {
  maxConversations?: number;
  minIdleMs?: number;
  maxIdleMs?: number;
}): Promise<AutoTrainerScanResult> {
  const maxConversations = opts?.maxConversations ?? MAX_CONVERSATIONS_PER_RUN;
  const minIdle = opts?.minIdleMs ?? MIN_IDLE_MS;
  const maxIdle = opts?.maxIdleMs ?? MAX_IDLE_MS;

  const summary: AutoTrainerScanResult = {
    analyzed: 0,
    skipped: 0,
    faqsCreated: 0,
    promoted: 0,
    patternsLogged: 0,
    errors: 0,
    patternsExtracted: 0,
  };

  try {
    // ── A. Run deterministic pattern extraction first (cheap) ─────────────
    const extractResult = await autoExtractPatterns({ lookbackHours: 6 });
    summary.patternsExtracted = extractResult.extracted;

    // ── B. Find idle conversations eligible for GPT analysis ──────────────
    // A conversation is eligible if:
    //  1. last_user_at is between minIdle and maxIdle ago
    //  2. has at least MIN_TURNS_TO_ANALYZE user messages
    //  3. last_autotrainer_at is NULL or older than REANALYZE_AFTER_MS
    const cutoffMax = new Date(Date.now() - minIdle);
    const cutoffMin = new Date(Date.now() - maxIdle);

    const candidates = await pool.query(
      `SELECT instance, remote_jid,
         coalesce((state->>'user_msg_count')::int, 0) AS msg_count,
         (state->>'last_user_at') AS last_user_at,
         (state->>'last_autotrainer_at') AS last_autotrainer_at
       FROM bot_conversations
       WHERE
         (state->>'last_user_at') IS NOT NULL
         AND (state->>'last_user_at')::timestamptz BETWEEN $1 AND $2
         AND coalesce((state->>'user_msg_count')::int, 0) >= $3
         AND (
           (state->>'last_autotrainer_at') IS NULL
           OR (state->>'last_autotrainer_at')::timestamptz < now() - INTERVAL '4 hours'
         )
       ORDER BY (state->>'last_user_at')::timestamptz DESC
       LIMIT $4`,
      [cutoffMin, cutoffMax, MIN_TURNS_TO_ANALYZE, maxConversations]
    );

    if (!candidates.rows || candidates.rows.length === 0) {
      console.log('[autoTrainer] no eligible conversations found');
      return summary;
    }

    console.log(`[autoTrainer] found ${candidates.rows.length} conversations to analyze`);

    // ── C. Analyze each conversation ──────────────────────────────────────
    for (const row of candidates.rows) {
      try {
        const result = await learnFromConversation(row.instance, row.remote_jid);
        if (result.skipped) {
          summary.skipped++;
        } else {
          summary.analyzed++;
          summary.faqsCreated += result.faqsCreated;
          summary.promoted += result.promoted;
          summary.patternsLogged += result.patternsLogged;
        }
      } catch (err) {
        console.error(`[autoTrainer] error on ${row.remote_jid}:`, err);
        summary.errors++;
      }
    }

    console.log(
      `[autoTrainer] scan complete: analyzed=${summary.analyzed} skipped=${summary.skipped} ` +
      `faqs=${summary.faqsCreated} promoted=${summary.promoted} patterns=${summary.patternsLogged} extracted=${summary.patternsExtracted}`
    );

    return summary;
  } catch (err) {
    console.error('[autoTrainer] runAutoTrainerScan error:', err);
    return { ...summary, errors: (summary.errors ?? 0) + 1 };
  }
}

// ─── Manual Trigger ───────────────────────────────────────────────────────────

/**
 * Force-analyze a specific conversation (for admin panel use).
 * Bypasses the idle/recency checks.
 */
export async function forceLearnFromConversation(
  instance: string,
  remoteJid: string
): Promise<TrainerResult> {
  // Clear last_autotrainer_at to bypass the recent-analysis guard
  try {
    const currentState = await getState(instance, remoteJid);
    await setState(instance, remoteJid, {
      ...(currentState as any),
      last_autotrainer_at: null,
    } as any);
  } catch {
    // best-effort
  }
  return learnFromConversation(instance, remoteJid);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Get overall stats for the auto-trainer system.
 */
export async function getAutoTrainerStats(): Promise<Record<string, any>> {
  try {
    const [learningStats, faqStats, exampleStats] = await Promise.all([
      getLearningStats(),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE draft = true) AS draft_faqs,
          COUNT(*) FILTER (WHERE draft = false AND enabled = true) AS active_faqs,
          COUNT(*) AS total_faqs
        FROM bot_faq
      `),
      pool.query(`
        SELECT COUNT(*) AS total_examples, COUNT(*) FILTER (WHERE validated = true) AS validated
        FROM bot_examples
      `),
    ]);

    return {
      learning: learningStats,
      faqs: faqStats.rows[0] ?? {},
      examples: exampleStats.rows[0] ?? {},
    };
  } catch (err) {
    console.error('[autoTrainer] getAutoTrainerStats error:', err);
    return {};
  }
}
