import { pool } from './db.js';
import type { BotMode } from './contacts.js';

/**
 * Retrieve the bot_mode for a specific conversation (instance + remoteJid).
 * Returns null if no rule is defined.
 */
export async function getConversationRule(instance: string, remoteJid: string): Promise<BotMode | null> {
  const r = await pool.query(
    'select bot_mode from bot_conversation_rules where instance=$1 and remote_jid=$2',
    [instance, remoteJid]
  );
  if ((r.rowCount ?? 0) === 0) return null;
  return (r.rows[0].bot_mode as BotMode) ?? null;
}

/**
 * Create or update a rule for a conversation. If a rule exists it will be updated.
 */
export async function setConversationRule(instance: string, remoteJid: string, botMode: BotMode, notes?: string) {
  await pool.query(
    `insert into bot_conversation_rules(instance, remote_jid, bot_mode, notes, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (instance, remote_jid)
     do update set bot_mode=excluded.bot_mode, notes=excluded.notes, updated_at=excluded.updated_at`,
    [instance, remoteJid, botMode, notes ?? null]
  );
}

/**
 * Remove a conversation rule so that it falls back to the default behaviour or contact rule.
 */
export async function deleteConversationRule(instance: string, remoteJid: string) {
  await pool.query('delete from bot_conversation_rules where instance=$1 and remote_jid=$2', [instance, remoteJid]);
}

/**
 * List all conversation rules ordered by most recent updates.
 */
export async function listConversationRules() {
  const r = await pool.query(
    'select instance, remote_jid, bot_mode, notes, updated_at from bot_conversation_rules order by updated_at desc'
  );
  return r.rows;
}

