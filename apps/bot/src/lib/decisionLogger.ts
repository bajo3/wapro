/**
 * decisionLogger.ts — Structured decision logging for bot runtime intelligence.
 *
 * Emits one JSON line per message to stdout so Railway log drains and external
 * tools can count, filter and alert on bot decisions without a DB query.
 *
 * Rules:
 *  - Never throws (all callers are fire-and-forget)
 *  - No side effects beyond console.log
 *  - One call per message, not inside loops or retries
 */

export type BotDecisionLog = {
  /** Identifier for the lead — typically remoteJid */
  leadId?: string;
  /** Message ID from the incoming webhook event */
  messageId?: string;

  /** Primary intent resolved for this turn */
  intent?: string;
  /** Agent confidence score (0–1) */
  intentConfidence?: number;

  /**
   * Score that drove the intent match decision.
   * Maps to agent confidence for the structured agent path,
   * or 0 for pure fallback paths.
   */
  triggerScore?: number;
  /**
   * Minimum score considered an intentional match.
   * Anything below = ambiguous / fallback territory.
   */
  triggerThreshold?: number;

  /** Final action taken for this turn */
  decision?: 'respond' | 'handoff' | 'ignore';

  /**
   * Short deterministic explanation of WHY this decision was made.
   * Must be one sentence, derived from real conditions.
   * GOOD: "triggerScore below threshold"
   * BAD:  "seems good"
   */
  reason?: string;

  /** True if dynamic few-shot examples were injected into the agent prompt */
  usedExamples?: boolean;

  /** Heuristic risk of the bot inventing data it does not have */
  hallucinationRisk?: 'low' | 'medium' | 'high';

  /** ISO 8601 timestamp — always required */
  timestamp: string;
};

/**
 * Emit a structured bot_decision log line to stdout.
 * Non-blocking: catches and silently discards any serialization error.
 */
export function logBotDecision(data: BotDecisionLog): void {
  try {
    console.log(JSON.stringify({ type: 'bot_decision', ...data }));
  } catch {
    // serialization should never fail, but never throw from a logging helper
  }
}
