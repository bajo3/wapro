/**
 * skills/index.ts — Registro de skills/playbooks enchufables.
 *
 * Cada skill define:
 * - Un fragmento de contexto para el system prompt (skillHint)
 * - Reglas específicas para el caso
 *
 * Las skills NO reemplazan el RESPONSE_SYSTEM global.
 * Se inyectan como contexto adicional cuando el router las activa.
 *
 * Para agregar una skill nueva: crear el archivo y registrarlo acá.
 */

import { PRICE_OBJECTION_HINT } from './price-objection.js';
import { FINANCING_HINT } from './financing.js';
import { TRADE_IN_HINT } from './trade-in.js';
import { INDECISION_HINT } from './indecision.js';
import { NO_MATCH_HINT } from './no-match.js';
import { HUMAN_HANDOFF_HINT } from './human-handoff.js';

const SKILL_REGISTRY: Record<string, string> = {
  'price-objection': PRICE_OBJECTION_HINT,
  'financing':       FINANCING_HINT,
  'trade-in':        TRADE_IN_HINT,
  'indecision':      INDECISION_HINT,
  'no-match':        NO_MATCH_HINT,
  'human-handoff':   HUMAN_HANDOFF_HINT,
};

/**
 * Retorna el hint de una skill por nombre.
 * Retorna undefined si la skill no existe (no hay error).
 */
export function getSkillHint(skillName: string): string | undefined {
  return SKILL_REGISTRY[skillName];
}

/** Lista de skills disponibles (para admin/debugging). */
export function listSkills(): string[] {
  return Object.keys(SKILL_REGISTRY);
}
