/**
 * botReplyGate.ts — Switch global de respuestas del bot.
 *
 * Modos:
 *  - 'on'     → el bot lee, procesa Y responde al cliente
 *  - 'silent' → el bot lee y procesa pero NO envía nada al cliente
 *
 * Source of truth: bot_global_settings table (key='bot_reply_mode').
 * Memory is used as cache after loadBotReplyMode() is called at startup.
 * BOT_REPLY_MODE env var used only as bootstrap default if no DB row exists.
 */

import { pool } from './db.js';

type BotReplyMode = 'on' | 'silent';

const SETTINGS_KEY = 'bot_reply_mode';

let _mode: BotReplyMode = (() => {
  const raw = (process.env.BOT_REPLY_MODE ?? 'on').toLowerCase().trim();
  return raw === 'silent' ? 'silent' : 'on';
})();

/** Called once at startup — loads persisted mode from DB into memory cache. */
export async function loadBotReplyMode(): Promise<void> {
  try {
    const r = await pool.query(
      'SELECT value FROM bot_global_settings WHERE key = $1',
      [SETTINGS_KEY]
    );
    if (r.rowCount && r.rowCount > 0) {
      const val = r.rows[0].value as string;
      _mode = val === 'silent' ? 'silent' : 'on';
      console.log(JSON.stringify({
        level: 'info',
        event: 'bot_reply_mode_loaded',
        source: 'db',
        value: _mode,
        timestamp: new Date().toISOString(),
      }));
    } else {
      // No row yet — persist current default so it's visible/editable
      await pool.query(
        `INSERT INTO bot_global_settings(key, value) VALUES($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [SETTINGS_KEY, _mode]
      );
      console.log(JSON.stringify({
        level: 'info',
        event: 'bot_reply_mode_loaded',
        source: 'default',
        value: _mode,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (err: any) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'bot_reply_mode_load_failed',
      error: err?.message,
      fallback: _mode,
      timestamp: new Date().toISOString(),
    }));
  }
}

export function getBotReplyMode(): BotReplyMode {
  return _mode;
}

export async function setBotReplyMode(mode: BotReplyMode): Promise<void> {
  const prev = _mode;
  _mode = mode;

  try {
    await pool.query(
      `INSERT INTO bot_global_settings(key, value, updated_at)
       VALUES($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [SETTINGS_KEY, mode]
    );
    if (prev !== mode) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'bot_reply_mode_changed',
        from: prev,
        to: mode,
        persisted: true,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (err: any) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'bot_reply_mode_persist_failed',
      error: err?.message,
      mode,
      timestamp: new Date().toISOString(),
    }));
  }
}

/** true = enviar al cliente, false = silencio */
export function isBotReplyEnabled(): boolean {
  return _mode === 'on';
}
