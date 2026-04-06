/**
 * commercialPipeline.ts — Orquesta el pipeline comercial completo (Fase 4)
 *
 * Punto de entrada único que llama en orden:
 *   1. intentClassifier → IntentClassification
 *   2. commercialScoring → LeadScore
 *   3. nextBestAction → NextBestAction
 *   4. conversationPriority → ConversationPriority
 *   5. salesSuggestions → SalesSuggestion
 *   6. Persiste en lead_commercial_data (async, no bloquea)
 *
 * REGLAS:
 * - Nunca bloquear la respuesta principal del bot.
 * - Los errores de persistencia se logean pero no se propagan.
 * - Todos los módulos son deterministas y síncronos excepto la DB.
 */

import { classifyIntent, type IntentClassification } from './intentClassifier.js';
import { computeCommercialScore, type LeadScore } from './commercialScoring.js';
import { determineNextBestAction, type NextBestAction } from './nextBestAction.js';
import { calculateConversationPriority, type ConversationPriority } from './conversationPriority.js';
import { generateSalesSuggestions, type SalesSuggestion } from './salesSuggestions.js';
import { pool } from './db.js';

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface CommercialPipelineResult {
  intent: IntentClassification;
  leadScore: LeadScore;
  nextAction: NextBestAction;
  priority: ConversationPriority;
  suggestion: SalesSuggestion;
}

// ─── Score history helpers ────────────────────────────────────────────────────

interface ScoreHistoryEntry {
  ts: string;
  score: number;
  temperature: string;
  intent: string;
}

function buildHistoryEntry(score: LeadScore, intent: IntentClassification): ScoreHistoryEntry {
  return {
    ts: new Date().toISOString(),
    score: score.score,
    temperature: score.temperature,
    intent: intent.primary,
  };
}

// ─── Persistencia async ──────────────────────────────────────────────────────

async function persistCommercialData(
  conversationId: string,
  instanceName: string,
  remoteJid: string,
  result: CommercialPipelineResult,
  prevScoreHistory: ScoreHistoryEntry[] = []
): Promise<void> {
  const { intent, leadScore, nextAction, priority, suggestion } = result;

  // Mantener últimas 20 entradas de historial
  const newEntry = buildHistoryEntry(leadScore, intent);
  const scoreHistory = [...prevScoreHistory.slice(-19), newEntry];

  const signalsJson = JSON.stringify(
    leadScore.signals.filter((s) => s.detected).map((s) => ({
      type: s.type,
      weight: s.weight,
      evidence: s.evidence,
    }))
  );

  await pool.query(
    `INSERT INTO lead_commercial_data (
      conversation_id, instance_name, remote_jid,
      lead_score, lead_temperature, score_reason, score_confidence,
      primary_intent, secondary_intent, intent_confidence, intent_evidence,
      sales_signals,
      next_best_action, next_action_reason, next_action_priority,
      next_action_for_human, next_action_for_bot, next_suggested_message,
      commercial_priority, priority_label, priority_reason,
      should_notify_human, estimated_value_signal,
      suggested_action, suggested_reply_strategy,
      human_handoff_reason, suggestion_urgency, script_hint,
      score_history, last_scored_at
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12::jsonb,
      $13, $14, $15,
      $16, $17, $18,
      $19, $20, $21,
      $22, $23,
      $24, $25,
      $26, $27, $28,
      $29::jsonb, NOW()
    )
    ON CONFLICT (conversation_id) DO UPDATE SET
      instance_name          = EXCLUDED.instance_name,
      remote_jid             = EXCLUDED.remote_jid,
      lead_score             = EXCLUDED.lead_score,
      lead_temperature       = EXCLUDED.lead_temperature,
      score_reason           = EXCLUDED.score_reason,
      score_confidence       = EXCLUDED.score_confidence,
      primary_intent         = EXCLUDED.primary_intent,
      secondary_intent       = EXCLUDED.secondary_intent,
      intent_confidence      = EXCLUDED.intent_confidence,
      intent_evidence        = EXCLUDED.intent_evidence,
      sales_signals          = EXCLUDED.sales_signals,
      next_best_action       = EXCLUDED.next_best_action,
      next_action_reason     = EXCLUDED.next_action_reason,
      next_action_priority   = EXCLUDED.next_action_priority,
      next_action_for_human  = EXCLUDED.next_action_for_human,
      next_action_for_bot    = EXCLUDED.next_action_for_bot,
      next_suggested_message = EXCLUDED.next_suggested_message,
      commercial_priority    = EXCLUDED.commercial_priority,
      priority_label         = EXCLUDED.priority_label,
      priority_reason        = EXCLUDED.priority_reason,
      should_notify_human    = EXCLUDED.should_notify_human,
      estimated_value_signal = EXCLUDED.estimated_value_signal,
      suggested_action       = EXCLUDED.suggested_action,
      suggested_reply_strategy = EXCLUDED.suggested_reply_strategy,
      human_handoff_reason   = EXCLUDED.human_handoff_reason,
      suggestion_urgency     = EXCLUDED.suggestion_urgency,
      script_hint            = EXCLUDED.script_hint,
      score_history          = EXCLUDED.score_history,
      last_scored_at         = EXCLUDED.last_scored_at`,
    [
      conversationId, instanceName, remoteJid,
      leadScore.score, leadScore.temperature, leadScore.reason, leadScore.confidence,
      intent.primary, intent.secondary ?? null, intent.confidence, intent.evidence,
      signalsJson,
      nextAction.action, nextAction.reason, nextAction.priority,
      nextAction.forHuman, nextAction.forBot, nextAction.suggestedMessage ?? null,
      priority.priority, priority.label, priority.reason,
      priority.shouldNotifyHuman, priority.estimatedValueSignal,
      suggestion.suggestedAction, suggestion.suggestedReplyStrategy,
      suggestion.humanHandoffReason ?? null, suggestion.urgency, suggestion.scriptHint ?? null,
      JSON.stringify(scoreHistory),
    ]
  );
}

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * runCommercialPipeline — ejecuta el pipeline completo.
 *
 * Síncrono en todos los módulos de análisis.
 * La persistencia en DB se lanza async sin bloquear.
 *
 * @param text - mensaje actual del usuario
 * @param extracted - contexto extraído acumulado
 * @param conversationId - ID único de la conversación (remoteJid u otro)
 * @param instanceName - nombre de la instancia de Evolution
 * @param remoteJid - JID de WhatsApp
 * @param prevScore - score previo del lead (para acumulación entre turnos)
 */
export function runCommercialPipeline(
  text: string,
  extracted: Record<string, any>,
  conversationId: string,
  instanceName: string,
  remoteJid: string,
  prevScore?: number
): CommercialPipelineResult {
  // 1. Clasificar intención
  const intent = classifyIntent(text, extracted);

  // 2. Calcular score comercial
  const leadScore = computeCommercialScore(text, extracted, intent, prevScore);

  // 3. Determinar próximo mejor paso
  const nextAction = determineNextBestAction(leadScore, intent, extracted);

  // 4. Calcular prioridad de conversación
  const priority = calculateConversationPriority(leadScore, intent, nextAction, extracted);

  // 5. Generar sugerencias al vendedor
  const suggestion = generateSalesSuggestions(leadScore, intent, nextAction, extracted);

  const result: CommercialPipelineResult = { intent, leadScore, nextAction, priority, suggestion };

  // 6. Persistir en DB de forma async (no bloquea)
  void (async () => {
    try {
      // Cargar historial previo
      let prevHistory: ScoreHistoryEntry[] = [];
      try {
        const { rows } = await pool.query(
          'SELECT score_history FROM lead_commercial_data WHERE conversation_id = $1',
          [conversationId]
        );
        if (rows[0]?.score_history) {
          prevHistory = Array.isArray(rows[0].score_history)
            ? rows[0].score_history
            : JSON.parse(rows[0].score_history);
        }
      } catch {
        // primer insert — no hay historial
      }

      await persistCommercialData(conversationId, instanceName, remoteJid, result, prevHistory);
    } catch (err) {
      console.error('[COMMERCIAL_PIPELINE] error persisting commercial data:', err instanceof Error ? err.message : String(err));
    }
  })();

  // 7. Logs estructurados
  console.info('[LEAD_SCORE]', JSON.stringify({
    conversationId: conversationId.slice(0, 20),
    score: leadScore.score,
    temperature: leadScore.temperature,
    signals: leadScore.signals.filter((s) => s.detected).map((s) => s.type),
    confidence: leadScore.confidence,
  }));

  console.info('[INTENT_CLASSIFIED]', JSON.stringify({
    conversationId: conversationId.slice(0, 20),
    primary: intent.primary,
    secondary: intent.secondary ?? null,
    confidence: intent.confidence,
    evidence: intent.evidence.slice(0, 60),
  }));

  console.info('[NEXT_BEST_ACTION]', JSON.stringify({
    conversationId: conversationId.slice(0, 20),
    action: nextAction.action,
    priority: nextAction.priority,
    forHuman: nextAction.forHuman,
    forBot: nextAction.forBot,
  }));

  console.info('[COMMERCIAL_PRIORITY]', JSON.stringify({
    conversationId: conversationId.slice(0, 20),
    priority: priority.priority,
    label: priority.label,
    shouldNotifyHuman: priority.shouldNotifyHuman,
    valueSignal: priority.estimatedValueSignal,
  }));

  console.info('[SALES_SUGGESTION]', JSON.stringify({
    conversationId: conversationId.slice(0, 20),
    action: suggestion.suggestedAction.slice(0, 80),
    urgency: suggestion.urgency,
    hasHandoffReason: Boolean(suggestion.humanHandoffReason),
  }));

  return result;
}
