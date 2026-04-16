/**
 * exampleSelector.ts — Selector dinámico de ejemplos few-shot.
 *
 * Lee de bot_examples (DB) y devuelve los mejores 2-3 ejemplos
 * según intención, tags y score de outcome.
 *
 * Si la tabla está vacía o falla → retorna ejemplos hardcoded de fallback.
 * Los ejemplos se inyectan en composeResponse() para mejorar la calidad
 * sin necesidad de reentrenar el modelo base.
 */

import { pool } from './db.js';
import type { RouterAction } from './runtimeRouter.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface BotExample {
  id: string;
  intent: string;
  tags: string[];
  input: string;    // Mensaje del cliente
  output: string;   // Respuesta ideal del bot
  outcome?: 'converted' | 'continued' | 'dropped' | null;
  score?: number;   // 0..100 — ejemplos con score alto se muestran primero
}

// ── Fallbacks hardcodeados (cuando bot_examples vacía) ────────────────────────
// Solo lo mínimo para cada acción crítica. Sirven como baseline.

const FALLBACK_EXAMPLES: Partial<Record<RouterAction, BotExample[]>> = {
  SHOW_OPTIONS: [
    {
      id: 'fb-show-1',
      intent: 'search',
      tags: ['lista', 'filtros'],
      input: 'busco una SUV automática hasta 25 millones',
      output: 'Bien, hoy tengo estas opciones:\n1. [Auto A] — ARS [precio] (año · km · transmisión)\n2. [Auto B] — ARS [precio] (año · km · transmisión)\n¿Cuál te interesa? Te paso fotos y detalle.',
      outcome: 'continued',
      score: 80,
    },
    {
      id: 'fb-show-2',
      intent: 'refine',
      tags: ['refinamiento', 'mas-barato'],
      input: 'algo más barato que ese',
      output: 'Dale, te muestro opciones dentro de ese presupuesto:\n1. [Auto A] — ARS [precio]\n2. [Auto B] — ARS [precio]\n¿Alguno te cierra?',
      outcome: 'continued',
      score: 75,
    },
  ],
  SHOW_SINGLE: [
    {
      id: 'fb-single-1',
      intent: 'specific',
      tags: ['detalle', 'auto-puntual'],
      input: 'ese me interesa, el segundo',
      output: 'Ese lo tengo así: [nombre], [año], [km], [motor]. Precio: [precio]. Te mando las fotos. ¿Querés calcular cuotas o coordinar una visita?',
      outcome: 'converted',
      score: 90,
    },
  ],
  FINANCING_FLOW: [
    {
      id: 'fb-fin-1',
      intent: 'credit_quote',
      tags: ['cuotas', 'anticipo'],
      input: 'y si lo financio?',
      output: 'Para [auto] a [precio], ¿cuánto ponés de entrega? Con eso te calculo los planes.',
      outcome: 'continued',
      score: 85,
    },
    {
      id: 'fb-fin-2',
      intent: 'credit_quote',
      tags: ['cuotas', 'mínimo'],
      input: 'lo mínimo de entrada?',
      output: 'La entrega mínima la confirma el banco y varía por plan. Te paso con el equipo para que te den el número real.',
      outcome: 'continued',
      score: 80,
    },
  ],
  TRADE_IN_FLOW: [
    {
      id: 'fb-tradein-1',
      intent: 'trade_in',
      tags: ['permuta', 'usado'],
      input: 'tengo un Gol 2018 para entregar como parte de pago',
      output: '¿Qué km tiene aproximadamente? El equipo lo evalúa y te da el valor como parte de pago.',
      outcome: 'continued',
      score: 80,
    },
  ],
  HANDLE_OBJECTION: [
    {
      id: 'fb-obj-1',
      intent: 'search',
      tags: ['precio', 'caro', 'objecion'],
      input: 'me parece caro, ¿no tienen algo más barato?',
      output: 'Entendido. ¿Cuánto tenés pensado gastar? Con eso te filtro las opciones que sí te cierran.',
      outcome: 'continued',
      score: 82,
    },
  ],
  ASK_ONE_QUESTION: [
    {
      id: 'fb-ask-1',
      intent: 'unsure',
      tags: ['exploratorio', 'indecision'],
      input: 'ando viendo opciones',
      output: 'Dale, sin apuro. ¿Tenés algún tipo de auto en mente o un presupuesto aproximado?',
      outcome: 'continued',
      score: 78,
    },
  ],
  ESCALATE_HUMAN: [
    {
      id: 'fb-handoff-1',
      intent: 'advisor',
      tags: ['handoff', 'asesor'],
      input: 'quiero hablar con alguien del equipo',
      output: 'Dale, te paso con alguien del equipo que te atiende directo.',
      outcome: 'converted',
      score: 95,
    },
  ],
};

// ── Selector principal ────────────────────────────────────────────────────────

/**
 * Selecciona ejemplos few-shot para la acción y contexto dados.
 * Retorna strings listos para inyectar en el system prompt.
 *
 * @param action   RouterAction del turno actual
 * @param tags     Tags de contexto extra (ej: ['precio', 'suv'])
 * @param limit    Máximo de ejemplos a retornar (default: 2)
 */
export async function selectExamples(
  action: RouterAction,
  tags: string[] = [],
  limit: number = 2
): Promise<string[]> {
  try {
    const rows = await pool.query<{ input: string; output: string; score: number }>(
      `SELECT input, output, COALESCE(score, 50) AS score
       FROM bot_examples
       WHERE intent = $1
         AND ($2::text[] = '{}' OR tags && $2::text[])
         AND (outcome IS NULL OR outcome != 'dropped')
       ORDER BY score DESC, created_at DESC
       LIMIT $3`,
      [action.toLowerCase(), tags, limit]
    );

    if (rows.rowCount && rows.rowCount > 0) {
      return rows.rows.map(r =>
        `EJEMPLO:\nCliente: ${r.input}\nBot: ${r.output}`
      );
    }
  } catch {
    // DB no disponible o tabla sin existir → fallback silencioso
  }

  // Fallback hardcoded
  const fallbacks = FALLBACK_EXAMPLES[action] ?? [];
  return fallbacks.slice(0, limit).map(e =>
    `EJEMPLO:\nCliente: ${e.input}\nBot: ${e.output}`
  );
}

// ── Guardar nuevo ejemplo exitoso (para futuro learning loop) ─────────────────

export interface SaveExampleParams {
  intent: string;
  tags?: string[];
  input: string;
  output: string;
  outcome?: 'converted' | 'continued' | 'dropped';
  score?: number;
}

/**
 * Guarda un ejemplo en bot_examples. Llamado desde el learning loop offline/admin.
 * No se llama en runtime de producción.
 */
export async function saveExample(params: SaveExampleParams): Promise<void> {
  await pool.query(
    `INSERT INTO bot_examples (intent, tags, input, output, outcome, score, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [
      params.intent,
      params.tags ?? [],
      params.input,
      params.output,
      params.outcome ?? null,
      params.score ?? 50,
    ]
  );
}
