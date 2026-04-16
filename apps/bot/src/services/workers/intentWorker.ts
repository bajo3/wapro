/**
 * intentWorker.ts — Worker de detección de intención.
 *
 * Extrae intención + entidades del mensaje del cliente usando GPT.
 * Agrega timing y contexto de logging estructurado.
 * La lógica de extracción real vive en botIntelligence.extractIntent.
 */

import type { Extracted } from '../botIntelligence.js';

export type { Extracted };

export interface IntentResult {
  extracted: Extracted;
  durationMs: number;
  fromCache: boolean;  // futuro: caché de intenciones recientes
}

/**
 * Ejecuta la extracción de intención y mide tiempo.
 * Recibe la fn extractIntent como inyección para no crear dependencia circular.
 */
export async function runIntentWorker(
  extractFn: (message: string, historyLines: string[]) => Promise<Extracted>,
  message: string,
  historyLines: string[]
): Promise<IntentResult> {
  const t0 = Date.now();
  const extracted = await extractFn(message, historyLines);
  return {
    extracted,
    durationMs: Date.now() - t0,
    fromCache: false,
  };
}
