/**
 * pipelineLogger.ts — Logger estructurado del pipeline del bot.
 *
 * Registra cada paso del pipeline en formato JSON por línea (Railway-compatible).
 * Opcionalmente escribe a bot_pipeline_logs si la tabla existe.
 *
 * Pasos que loggea:
 *   intent → router → examples → skill → vehicles → truth guard → ai → response
 *
 * No bloquea el pipeline: la escritura a DB es fire-and-forget.
 */

import type { RouterAction } from './runtimeRouter.js';
import type { TruthGuardIssue } from './truthGuard.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface PipelineEvent {
  ts: string;
  instance: string;
  remoteJid: string;

  // Intent detection
  intent?: string;
  intentConfidence?: string;
  leadMode?: string;
  needsClarification?: boolean;

  // Router decision
  action?: RouterAction;
  actionReason?: string;
  skillHint?: string;

  // Few-shot examples
  examplesSelected?: number;
  exampleSource?: 'db' | 'fallback';

  // Catalog / vehicles
  vehiclesRanked?: number;
  vehiclesShown?: number;
  vehicleIds?: string[];

  // Truth guard
  guardPassed?: boolean;
  guardIssues?: TruthGuardIssue[];

  // AI call
  aiModel?: string;
  aiLatencyMs?: number;

  // Handoff / lead
  handoffReason?: string;
  isHotLead?: boolean;
  leadScore?: number;

  // Response
  replyLengthChars?: number;
  fastPath?: 'numeric_selection' | 'finance_followup' | 'reset_override' | null;
}

// ── State interno ──────────────────────────────────────────────────────────────

let _dbWriteEnabled = true; // Se deshabilita si la primera escritura falla

// ── Logger principal ───────────────────────────────────────────────────────────

/**
 * Emite un evento de pipeline.
 * Siempre logea a console (JSON). Opcionalmente escribe a DB en background.
 */
export function logPipelineEvent(event: PipelineEvent): void {
  // Log a console — Railway lo captura y lo indexa
  console.info(JSON.stringify({ _type: 'pipeline', ...event }));

  // DB write en background — no bloquea el pipeline
  if (_dbWriteEnabled) {
    writeToDb(event).catch(() => {
      _dbWriteEnabled = false; // Silenciar intentos futuros si falla (tabla puede no existir)
    });
  }
}

async function writeToDb(event: PipelineEvent): Promise<void> {
  const { pool } = await import('./db.js');
  await pool.query(
    `INSERT INTO bot_pipeline_logs
       (instance, remote_jid, intent, action, guard_passed, is_hot_lead,
        lead_score, reply_length, fast_path, event_data, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
    [
      event.instance,
      event.remoteJid,
      event.intent ?? null,
      event.action ?? null,
      event.guardPassed ?? null,
      event.isHotLead ?? null,
      event.leadScore ?? null,
      event.replyLengthChars ?? null,
      event.fastPath ?? null,
      JSON.stringify(event),
    ]
  );
}

// ── Helper para construir el evento a partir de resultados parciales ───────────

/**
 * Merge partial pipeline events durante un turno.
 * Útil para acumular datos de varios pasos antes de emitir un evento final.
 */
export function mergePipelineEvents(...parts: Partial<PipelineEvent>[]): PipelineEvent {
  return Object.assign(
    { ts: new Date().toISOString(), instance: '', remoteJid: '' },
    ...parts
  ) as PipelineEvent;
}
