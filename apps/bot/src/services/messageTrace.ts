/**
 * messageTrace.ts — Trazabilidad completa por messageId.
 *
 * Escribe en bot_message_trace (migración 018) para correlacionar:
 *   messageId → intent → score → decisión → persist outcome
 *
 * Reglas:
 *  - recordTrace() siempre fire-and-forget (nunca bloquea el reply)
 *  - Sin lanzar excepciones al caller
 *  - buildTrailForMessage() agrega trace + commercial + learning captures
 */

import { createHash } from 'node:crypto';
import { pool } from './db.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface MessageTraceInput {
  messageId: string;
  instanceName: string;
  remoteJid: string;
  intent?: string;
  intentConfidence?: number;
  decision?: 'respond' | 'handoff' | 'ignore';
  hallucinationRisk?: 'low' | 'medium' | 'high';
  hallucinationBlocked?: boolean;
  guardrailIssues?: string[];
  leadScore?: number;
  leadTemperature?: string;
  commercialPriority?: number;
  rawTextHash?: string;
  replyHash?: string;
  turnIndex?: number;
}

export interface MessageTrail {
  trace: MessageTraceInput & { id: number; receivedAt: string; panelPersisted: boolean | null; deadLettered: boolean };
  commercialData: Record<string, any> | null;
  learningCaptures: any[];
  conversationState: Record<string, any> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 40);
}

// ─── Escritura (fire-and-forget) ──────────────────────────────────────────────

/**
 * Registra la traza de un mensaje. Siempre fire-and-forget.
 * El caller NO debe esperar ni manejar el Promise.
 */
export function recordTrace(input: MessageTraceInput): void {
  pool.query(
    `INSERT INTO bot_message_trace (
      message_id, instance_name, remote_jid,
      intent, intent_confidence, decision,
      hallucination_risk, hallucination_blocked, guardrail_issues,
      lead_score, lead_temperature, commercial_priority,
      raw_text_hash, reply_hash, turn_index
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15
    )
    ON CONFLICT (message_id, instance_name) DO UPDATE SET
      intent               = COALESCE(EXCLUDED.intent, bot_message_trace.intent),
      intent_confidence    = COALESCE(EXCLUDED.intent_confidence, bot_message_trace.intent_confidence),
      decision             = COALESCE(EXCLUDED.decision, bot_message_trace.decision),
      hallucination_risk   = COALESCE(EXCLUDED.hallucination_risk, bot_message_trace.hallucination_risk),
      hallucination_blocked = COALESCE(EXCLUDED.hallucination_blocked, bot_message_trace.hallucination_blocked),
      guardrail_issues     = COALESCE(EXCLUDED.guardrail_issues, bot_message_trace.guardrail_issues),
      lead_score           = COALESCE(EXCLUDED.lead_score, bot_message_trace.lead_score),
      lead_temperature     = COALESCE(EXCLUDED.lead_temperature, bot_message_trace.lead_temperature),
      commercial_priority  = COALESCE(EXCLUDED.commercial_priority, bot_message_trace.commercial_priority),
      raw_text_hash        = COALESCE(EXCLUDED.raw_text_hash, bot_message_trace.raw_text_hash),
      reply_hash           = COALESCE(EXCLUDED.reply_hash, bot_message_trace.reply_hash),
      turn_index           = COALESCE(EXCLUDED.turn_index, bot_message_trace.turn_index)`,
    [
      input.messageId, input.instanceName, input.remoteJid,
      input.intent ?? null, input.intentConfidence ?? null, input.decision ?? null,
      input.hallucinationRisk ?? null, input.hallucinationBlocked ?? false, input.guardrailIssues ?? null,
      input.leadScore ?? null, input.leadTemperature ?? null, input.commercialPriority ?? null,
      input.rawTextHash ?? null, input.replyHash ?? null, input.turnIndex ?? null,
    ]
  ).catch((err) => {
    console.warn('[messageTrace] recordTrace error (non-blocking):', err?.message ?? err);
  });
}

/**
 * Actualiza el resultado de persistencia en panel (llamado desde panelPersistence.ts).
 */
export function updateTracePersistStatus(
  messageId: string,
  instanceName: string,
  persisted: boolean,
  attempts: number = 1,
  deadLettered: boolean = false
): void {
  pool.query(
    `UPDATE bot_message_trace
     SET panel_persisted = $1, persist_attempts = $2, dead_lettered = $3
     WHERE message_id = $4 AND instance_name = $5`,
    [persisted, attempts, deadLettered, messageId, instanceName]
  ).catch((err) => {
    console.warn('[messageTrace] updateTracePersistStatus error:', err?.message ?? err);
  });
}

// ─── Lectura (para endpoint admin) ────────────────────────────────────────────

export async function buildTrailForMessage(
  messageId: string,
  instanceName: string
): Promise<MessageTrail | null> {
  const { rows: traceRows } = await pool.query(
    `SELECT * FROM bot_message_trace WHERE message_id = $1 AND instance_name = $2 LIMIT 1`,
    [messageId, instanceName]
  );
  if (!traceRows[0]) return null;

  const trace = traceRows[0];
  const remoteJid = trace.remote_jid;
  const receivedAt = trace.received_at;

  // Datos comerciales del mismo remoteJid (comerciales más recientes)
  const { rows: commRows } = await pool.query(
    `SELECT * FROM lead_commercial_data
     WHERE remote_jid = $1 AND instance_name = $2
     ORDER BY last_scored_at DESC LIMIT 1`,
    [remoteJid, instanceName]
  ).catch(() => ({ rows: [] }));

  // Capturas de aprendizaje alrededor de ese momento (±5 min)
  const { rows: captureRows } = await pool.query(
    `SELECT id, user_message, bot_response, agent_action, quality_score, outcome, created_at
     FROM bot_learning_captures
     WHERE contact_jid = $1 AND instance_name = $2
       AND created_at BETWEEN $3::timestamptz - interval '5 minutes'
                          AND $3::timestamptz + interval '5 minutes'
     ORDER BY created_at ASC`,
    [remoteJid, instanceName, receivedAt]
  ).catch(() => ({ rows: [] }));

  // Estado de conversación actual
  const { rows: convRows } = await pool.query(
    `SELECT state FROM bot_conversations WHERE instance = $1 AND remote_jid = $2 LIMIT 1`,
    [instanceName, remoteJid]
  ).catch(() => ({ rows: [] }));

  return {
    trace: {
      id: trace.id,
      receivedAt: trace.received_at,
      messageId: trace.message_id,
      instanceName: trace.instance_name,
      remoteJid: trace.remote_jid,
      intent: trace.intent,
      intentConfidence: trace.intent_confidence,
      decision: trace.decision,
      hallucinationRisk: trace.hallucination_risk,
      hallucinationBlocked: trace.hallucination_blocked,
      guardrailIssues: trace.guardrail_issues,
      leadScore: trace.lead_score,
      leadTemperature: trace.lead_temperature,
      commercialPriority: trace.commercial_priority,
      rawTextHash: trace.raw_text_hash,
      replyHash: trace.reply_hash,
      turnIndex: trace.turn_index,
      panelPersisted: trace.panel_persisted,
      deadLettered: trace.dead_lettered,
    },
    commercialData: commRows[0] ?? null,
    learningCaptures: captureRows,
    conversationState: convRows[0]?.state ?? null,
  };
}

/**
 * Listar trazas recientes para un remoteJid o instancia.
 */
export async function listRecentTraces(
  instanceName: string,
  opts?: { remoteJid?: string; limit?: number; onlyBlocked?: boolean }
): Promise<any[]> {
  const conditions: string[] = ['instance_name = $1'];
  const params: any[] = [instanceName];
  let p = 2;

  if (opts?.remoteJid) {
    conditions.push(`remote_jid = $${p++}`);
    params.push(opts.remoteJid);
  }
  if (opts?.onlyBlocked) {
    conditions.push(`hallucination_blocked = TRUE`);
  }

  const limit = Math.min(Number(opts?.limit ?? 50), 200);
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, message_id, remote_jid, received_at, intent, decision,
            hallucination_risk, hallucination_blocked, lead_score, lead_temperature,
            panel_persisted, dead_lettered
     FROM bot_message_trace
     WHERE ${conditions.join(' AND ')}
     ORDER BY received_at DESC
     LIMIT $${p}`,
    params
  );
  return rows;
}
