/**
 * botReplyGate.ts — Switch global de respuestas del bot.
 *
 * Modos:
 *  - 'on'     → el bot lee, procesa Y responde al cliente
 *  - 'silent' → el bot lee y procesa pero NO envía nada al cliente
 *               (puede guardar estado, detectar leads, emitir eventos internos)
 *
 * El estado vive en memoria (runtime) y cambia via admin API sin reiniciar.
 * Valor inicial: env var BOT_REPLY_MODE (default: 'on').
 *
 * Gate central: sendTextAndPersist y sendImageAndPersist chequean esto
 * antes de cualquier envío. Ningún otro path llega al cliente sin pasar por acá.
 */

type BotReplyMode = 'on' | 'silent';

let _mode: BotReplyMode = (() => {
  const raw = (process.env.BOT_REPLY_MODE ?? 'on').toLowerCase().trim();
  return raw === 'silent' ? 'silent' : 'on';
})();

export function getBotReplyMode(): BotReplyMode {
  return _mode;
}

export function setBotReplyMode(mode: BotReplyMode): void {
  const prev = _mode;
  _mode = mode;
  if (prev !== mode) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'bot_reply_mode_changed',
      from: prev,
      to: mode,
      timestamp: new Date().toISOString(),
    }));
  }
}

/** true = enviar al cliente, false = silencio */
export function isBotReplyEnabled(): boolean {
  return _mode === 'on';
}
