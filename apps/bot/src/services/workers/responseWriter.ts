/**
 * responseWriter.ts — Worker de composición de respuesta.
 *
 * Thin wrapper sobre composeResponse que:
 * 1. Inyecta ejemplos dinámicos del exampleSelector en el prompt
 * 2. Aplica el hint de la skill activa (si hay) como contexto adicional
 * 3. Mide latencia del AI call para logging
 *
 * La lógica de composición real (GPT + RESPONSE_SYSTEM) sigue en botIntelligence.
 */

import type { RouterAction } from '../runtimeRouter.js';
import { selectExamples } from '../exampleSelector.js';
import { getSkillHint } from '../skills/index.js';

export interface ResponseWriterParams {
  action: string;
  routerAction: RouterAction;
  data: Record<string, any>;
  historyLines: string[];
  skillHint?: string;
  contextTags?: string[];
}

export interface ResponseWriterResult {
  prompt: {
    action: string;
    data: Record<string, any>;
    historyLines: string[];
    injectedExamples: string[];
    skillContext?: string;
  };
  durationMs: number;
}

/**
 * Prepara los datos enriquecidos para pasar a composeResponse.
 * Selecciona ejemplos dinámicos + hint de skill en paralelo.
 *
 * Retorna el contexto listo para inyectar en el prompt de GPT.
 * El caller (botIntelligence) hace el llamado real a composeResponse.
 */
export async function prepareResponseContext(
  params: ResponseWriterParams
): Promise<ResponseWriterResult> {
  const t0 = Date.now();

  // Ejemplos + skill hint en paralelo (no bloquean entre sí)
  const [examples, skillContext] = await Promise.all([
    selectExamples(params.routerAction, params.contextTags ?? [], 2),
    params.skillHint ? Promise.resolve(getSkillHint(params.skillHint)) : Promise.resolve(undefined),
  ]);

  return {
    prompt: {
      action: params.action,
      data: params.data,
      historyLines: params.historyLines,
      injectedExamples: examples,
      skillContext,
    },
    durationMs: Date.now() - t0,
  };
}
