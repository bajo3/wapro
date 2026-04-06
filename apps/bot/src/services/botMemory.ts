/**
 * botMemory.ts — Memoria conversacional incremental del bot (Fase 3)
 *
 * QUÉ guarda: patrones conversacionales efectivos, preguntas útiles, manejo de objeciones.
 * QUÉ NO guarda: precios, stock, disponibilidad, financiación, descuentos — datos del catálogo.
 *
 * Persistencia primaria: Postgres (tabla bot_memory, migración 017).
 * Persistencia secundaria (fallback): apps/bot/data/bot-memory.json
 *
 * NOTA Railway: El fallback JSON requiere un Railway Volume montado en /app/data.
 * Sin Volume, la memoria RAM funciona para la sesión actual pero no sobrevive restarts.
 *
 * Máximo 100 patrones por categoría en RAM (FIFO).
 * Las escrituras a DB son async y nunca bloquean la respuesta principal.
 *
 * Score de calidad post-turno:
 *  - Se evalúa cuando llega el SIGUIENTE mensaje del usuario (ResponseOutcome real)
 *  - Solo se marca safe_to_reuse=true si score >= 5 y pasa isSafeToLearn()
 *  - Anti-patrones se guardan para análisis pero nunca entran al few-shot positivo
 *
 * Guardrails de seguridad (FORBIDDEN_PATTERNS):
 *  - Regex sobre precios, stock, disponibilidad, cuotas, tasas
 *  - Cualquier texto que los contenga es rechazado con log [MEMORY_GUARDRAIL_VIOLATION]
 *
 * PRINCIPIO: La memoria solo aprende de conversación, nunca de catálogo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

// ─── Rutas ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const MEMORY_FILE = path.join(DATA_DIR, 'bot-memory.json');

const MAX_PATTERNS_PER_CATEGORY = 100;

// ─── Tipos legacy (Fase 1-2, mantenidos para compatibilidad) ─────────────────

/** Patrón conversacional que funcionó: el usuario siguió respondiendo o avanzó. */
export interface ConversationalPattern {
  trigger: string;
  effectiveResponse: string;
  successSignal: string;
  timesUsed: number;
  lastUsed: string;
}

/** Pregunta que generó datos útiles del cliente. */
export interface UsefulQuestion {
  context: string;
  question: string;
  successRate: number;
  timesUsed: number;
  lastUsed: string;
}

/** Cómo se manejó exitosamente una objeción. */
export interface ObjectionPattern {
  objection: string;
  effectiveHandling: string;
  successSignal: string;
  timesUsed: number;
  lastUsed: string;
}

/** Métricas de autoevaluación de un turno de respuesta. */
export interface TurnMetrics {
  conversationId: string;
  turnIndex: number;
  responseLength: number;
  questionsAsked: number;
  dataExtracted: number;
  followUp: boolean;
  flags: {
    tooLong: boolean;
    tooManyQuestions: boolean;
  };
  timestamp: string;
}

export interface BotMemoryStore {
  conversationalPatterns: ConversationalPattern[];
  usefulQuestions: UsefulQuestion[];
  objectionPatterns: ObjectionPattern[];
  turnMetrics: TurnMetrics[];
  lastUpdated: string;
  version: number;
}

// ─── Tipos Fase 3 ─────────────────────────────────────────────────────────────

/** Señales reales del siguiente turno del usuario para evaluar la respuesta anterior. */
export interface ResponseOutcome {
  userReplied: boolean;           // +2 — el usuario respondió (cualquier cosa)
  userGaveMoreData: boolean;      // +2 — el usuario proporcionó campos nuevos (marca, presupuesto, etc.)
  userClarified: boolean;         // +1 — el usuario aclaró algo ambiguo
  userShowedIntent: boolean;      // +3 — mencionó visita, asesor, precio, reserva
  conversationAdvanced: boolean;  // +2 — el contexto del turno N+1 tiene más datos que el N
  botAskedRedundant: boolean;     // -3 — el bot repreguntó algo ya conocido
  responseTooGeneric: boolean;    // -2 — respuesta sin datos concretos
  userRepeatedSameQuestion: boolean; // -3 — el usuario repitió la misma duda
  unnecessaryHandoff: boolean;    // -2 — se derivó sin señal real de cierre
}

/** Clasificación del patrón para decidir qué guardar y cómo. */
export interface MemoryClassification {
  shouldSave: boolean;
  safeToReuse: boolean;
  memoryType: MemoryType;
  rejectionReason?: string;
}

export type MemoryType =
  | 'successful_question'
  | 'successful_reply'
  | 'objection_pattern'
  | 'indecision_pattern'
  | 'handoff_pattern'
  | 'bad_generic_reply'
  | 'anti_pattern';

/** Autoevaluación del bot sobre su propia respuesta en el turno actual. */
export interface SelfEvaluation {
  understoodIntent: boolean;
  askedUsefully: boolean;
  advancedConversation: boolean;
  wasGeneric: boolean;
  mixedIntents: boolean;
  escalatedCorrectly: boolean;
  respectedRules: boolean;
  inventionRisk: boolean;
  selfScore: number;        // 0–10
  improvementHint?: string;
}

/** Ejemplo few-shot para inyectar al prompt. */
export interface FewShotExample {
  userMessage: string;
  botReply: string;
  memoryType: MemoryType;
  qualityScore: number;
}

/** Entrada completa de memoria para persistir en DB. */
export interface MemoryEntry {
  conversationId: string;
  instanceName: string;
  userMessage: string;
  botReply: string;
  extractedContext?: Record<string, any>;
  memoryType: MemoryType;
  qualityScore: number;
  outcomeSignals?: ResponseOutcome;
  safeToReuse: boolean;
  rejectionReason?: string;
  selfEval?: SelfEvaluation;
}

// ─── Score legacy (Fase 1-2, mantenido para compatibilidad) ──────────────────

export interface MemoryScore {
  userGaveMoreData: boolean;
  botAdvancedConversation: boolean;
  responseWasSpecific: boolean;
  noInventionDetected: boolean;
  conversationStalled: boolean;
}

export function calculateMemoryScore(metrics: MemoryScore): number {
  if (metrics.conversationStalled) return -5;
  let score = 0;
  if (metrics.userGaveMoreData) score += 2;
  if (metrics.botAdvancedConversation) score += 2;
  if (metrics.responseWasSpecific) score += 1;
  if (metrics.noInventionDetected) score += 3;
  return score;
}

export function shouldSavePattern(patternLabel: string, metrics: MemoryScore): boolean {
  const score = calculateMemoryScore(metrics);

  if (metrics.conversationStalled) {
    console.info(`[BOT_MEMORY_SKIP] pattern=${patternLabel} score=${score} reason="conversationStalled"`);
    return false;
  }

  if (score < 4) {
    console.info(`[BOT_MEMORY_SKIP] pattern=${patternLabel} score=${score} reason="score<4"`);
    return false;
  }

  const reasons: string[] = [];
  if (metrics.userGaveMoreData) reasons.push('userGaveMoreData');
  if (metrics.botAdvancedConversation) reasons.push('botAdvancedConversation');
  if (metrics.responseWasSpecific) reasons.push('responseWasSpecific');
  if (metrics.noInventionDetected) reasons.push('noInventionDetected');
  console.info(`[BOT_MEMORY_SAVE] pattern=${patternLabel} score=${score} reason="${reasons.join('+')}"`);
  return true;
}

// ─── Guardrails de seguridad ──────────────────────────────────────────────────
// Palabras prohibidas (texto exacto)
const FORBIDDEN_IN_MEMORY = [
  'precio', 'stock', 'disponible', 'disponibilidad', 'cuotas',
  'financiacion', 'financiación', 'descuento', 'promocion', 'promoción',
  'oferta', 'tasa', 'anticipo', 'cuota', 'kilometros', 'kilómetros',
  'año del auto', 'modelo disponible'
];

// Patrones regex (Fase 3 — ampliado)
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\$\s*\d+/,
  /\d+\s*(mil|millones|k)\s*(pesos|usd|ars|dólares)/i,
  /en\s+stock/i,
  /disponible/i,
  /\d+\s*cuotas/i,
  /tasa\s*(de?\s*)?\d+/i,
  /el\s+\w+\s+(vale|cuesta|sale)/i,
  /hay\s+\d+\s+(unidades|autos)/i,
  /precio\s*(final|base|lista)/i,
  /\bUSD\s*\d+/i,
  /\bARS\s*\d+/i,
];

/**
 * Verifica que un texto no contenga datos de catálogo (precios, stock, etc.).
 * Cualquier violación se loguea con [MEMORY_GUARDRAIL_VIOLATION].
 */
export function isSafeToLearn(pattern: string): boolean {
  const lower = String(pattern || '').toLowerCase();

  // Check forbidden words
  for (const word of FORBIDDEN_IN_MEMORY) {
    if (lower.includes(word)) {
      console.info(`[MEMORY_GUARDRAIL_VIOLATION] pattern="${word}" → NOT saved`);
      return false;
    }
  }

  // Check forbidden regex patterns
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(pattern)) {
      console.info(`[MEMORY_GUARDRAIL_VIOLATION] pattern="${re.source}" → NOT saved`);
      return false;
    }
  }

  return true;
}

// ─── Evaluación de outcome post-turno ────────────────────────────────────────

/**
 * Evalúa el resultado de la respuesta anterior cuando llega el siguiente mensaje.
 * La clave del autoaprendizaje real: el comportamiento del usuario en el turno N+1
 * revela si la respuesta del turno N fue útil.
 */
export function evaluateResponseOutcome(
  previousBotReply: string,
  nextUserMessage: string,
  previousContext: Record<string, any>,
  currentContext: Record<string, any>
): ResponseOutcome {
  const prevLower = String(previousBotReply || '').toLowerCase();
  const nextLower = String(nextUserMessage || '').toLowerCase();

  // ── Señales positivas ────────────────────────────────────────────────────────
  const userReplied = nextUserMessage.trim().length > 3;

  // El usuario dio más datos si el contexto actual tiene más campos no vacíos
  const prevFieldCount = Object.values(previousContext || {}).filter(v => v !== null && v !== undefined && v !== '').length;
  const currFieldCount = Object.values(currentContext || {}).filter(v => v !== null && v !== undefined && v !== '').length;
  const userGaveMoreData = currFieldCount > prevFieldCount;

  // Aclaración: el usuario respondió una pregunta con información específica
  const userClarified = (
    /\b(es|son|tengo|quiero|busco|necesito|para)\b/i.test(nextUserMessage) &&
    nextUserMessage.length > 10
  );

  // Mostró intención real
  const userShowedIntent = /\b(visita|asesor|precio|reserv|señ|quiero\s+ese|me\s+interesa|cuándo\s+puedo|puedo\s+ir|lo\s+tomo|coordin)/i.test(nextUserMessage);

  // La conversación avanzó si hay más datos O el usuario mostró intención
  const conversationAdvanced = userGaveMoreData || userShowedIntent;

  // ── Señales negativas ────────────────────────────────────────────────────────

  // El bot preguntó algo redundante: la pregunta del bot (?) sobre algo ya conocido
  const botQuestionsAboutKnown = (previousBotReply.includes('?')) && (
    (previousContext.brand && /\bmarca\b/i.test(previousBotReply)) ||
    (previousContext.maxPrice && /\bpresupuesto\b/i.test(previousBotReply)) ||
    (previousContext.model && /\bmodelo\b/i.test(previousBotReply))
  );
  const botAskedRedundant = botQuestionsAboutKnown;

  // Respuesta demasiado genérica: sin datos específicos ni preguntas útiles
  const responseTooGeneric = (
    (prevLower.includes('tenemos muchas opciones') ||
      prevLower.includes('podemos ayudarte') ||
      prevLower.includes('cualquier duda') ||
      (prevLower.length < 80 && !previousBotReply.includes('?') && !previousBotReply.includes('*')))
  );

  // El usuario repitió la misma pregunta (señal de que la respuesta no sirvió)
  const userRepeatedSameQuestion = (() => {
    // Detectar repetición de intención: misma pregunta semántica
    const prevCtxBrand = String(previousContext.brand || '').toLowerCase();
    const currBrand = String(currentContext.brand || '').toLowerCase();
    // Si la búsqueda es idéntica y el bot ya respondió sobre eso, es redundante
    return (
      prevCtxBrand === currBrand && currBrand !== '' &&
      prevFieldCount === currFieldCount &&
      /\b(tenés|tienen|hay|buscas|mostrá)\b/i.test(nextUserMessage)
    );
  })();

  // Handoff innecesario: se derivó pero el usuario no mostró ninguna señal de cierre
  const unnecessaryHandoff = (
    /\b(asesor|te\s+paso\s+con|te\s+contacta)\b/i.test(prevLower) &&
    !userShowedIntent &&
    !/(reserv|señ|pago|comprar|lo\s+tomo)/i.test(String(previousBotReply || ''))
  );

  return {
    userReplied,
    userGaveMoreData,
    userClarified,
    userShowedIntent,
    conversationAdvanced,
    botAskedRedundant,
    responseTooGeneric,
    userRepeatedSameQuestion,
    unnecessaryHandoff,
  };
}

/**
 * Calcula el score numérico del outcome real.
 * Rango aproximado: -10 a +10.
 */
export function calculateOutcomeScore(outcome: ResponseOutcome): number {
  let score = 0;
  if (outcome.userReplied) score += 2;
  if (outcome.userGaveMoreData) score += 2;
  if (outcome.userClarified) score += 1;
  if (outcome.userShowedIntent) score += 3;
  if (outcome.conversationAdvanced) score += 2;
  if (outcome.botAskedRedundant) score -= 3;
  if (outcome.responseTooGeneric) score -= 2;
  if (outcome.userRepeatedSameQuestion) score -= 3;
  if (outcome.unnecessaryHandoff) score -= 2;
  return score;
}

// ─── Clasificación de entradas ────────────────────────────────────────────────

/**
 * Decide qué tipo de patrón es y si vale la pena guardarlo.
 * La clasificación determina si entra al few-shot o queda solo como análisis.
 */
export function classifyMemoryEntry(
  botReply: string,
  score: number,
  outcome: ResponseOutcome,
  context: Record<string, any>
): MemoryClassification {
  // Anti-patrón explícito: usuario repitió o conversación estancada
  if (outcome.userRepeatedSameQuestion || score <= -3) {
    console.info(`[BOT_MEMORY_ANTIPATTERN] type=anti_pattern score=${score} reason="${outcome.userRepeatedSameQuestion ? 'userRepeatedSameQuestion' : 'score_negative'}"`);
    return {
      shouldSave: true,
      safeToReuse: false,
      memoryType: 'anti_pattern',
      rejectionReason: outcome.userRepeatedSameQuestion ? 'userRepeatedSameQuestion' : 'negative_score',
    };
  }

  // Respuesta genérica sin valor
  if (outcome.responseTooGeneric && score < 3) {
    return {
      shouldSave: true,
      safeToReuse: false,
      memoryType: 'bad_generic_reply',
      rejectionReason: 'responseTooGeneric',
    };
  }

  // Score insuficiente para guardar
  if (score < 4) {
    console.info(`[BOT_MEMORY_SKIP] score=${score} reason="score<4"`);
    return {
      shouldSave: false,
      safeToReuse: false,
      memoryType: 'anti_pattern',
      rejectionReason: `score<4 (${score})`,
    };
  }

  // Determinar tipo positivo según contexto
  let memoryType: MemoryType;

  if (outcome.userShowedIntent && /\b(asesor|te\s+paso\s+con|coordin|visita)/i.test(botReply)) {
    memoryType = 'handoff_pattern';
  } else if (context?.isIndecisive && outcome.conversationAdvanced) {
    memoryType = 'indecision_pattern';
  } else if (/\b(est[áa]\s+caro|muy\s+caro|lo\s+pienso|no\s+me\s+convence)/i.test(String(context?._lastUserMessage || '')) && outcome.conversationAdvanced) {
    memoryType = 'objection_pattern';
  } else if (botReply.includes('?') && outcome.userGaveMoreData) {
    memoryType = 'successful_question';
  } else {
    memoryType = 'successful_reply';
  }

  // safe_to_reuse solo si score >= 5 y pasa guardrail
  const passesGuardrail = isSafeToLearn(botReply);
  const safeToReuse = score >= 5 && passesGuardrail;

  if (!passesGuardrail) {
    return {
      shouldSave: true,
      safeToReuse: false,
      memoryType,
      rejectionReason: 'guardrail_violation',
    };
  }

  console.info(`[BOT_MEMORY_SAVE] type=${memoryType} score=${score} safeToReuse=${safeToReuse}`);
  return { shouldSave: true, safeToReuse, memoryType };
}

// ─── Autoevaluación del bot ───────────────────────────────────────────────────

/**
 * El bot evalúa su propia respuesta en el momento de generarla.
 * No espera feedback del usuario — es una evaluación predictiva.
 * Sirve para loguear y como señal adicional de calidad.
 */
export function selfEvaluateResponse(
  userMessage: string,
  botReply: string,
  context: Record<string, any>
): SelfEvaluation {
  const replyLower = String(botReply || '').toLowerCase();
  const userLower = String(userMessage || '').toLowerCase();

  // ¿Entendió la intención?
  const understoodIntent = (
    (context?.brand && replyLower.includes(String(context.brand).toLowerCase())) ||
    (context?.isIndecisive && botReply.includes('?')) ||
    (context?.showIntent && (botReply.includes('*') || replyLower.includes('opciones'))) ||
    botReply.length > 50
  );

  // ¿Hizo una pregunta útil (si correspondía)?
  const askedUsefully = (
    botReply.includes('?') &&
    !( // No preguntó lo que ya sabía
      (context?.brand && /\bmarca\b/i.test(botReply)) ||
      (context?.maxPrice && /\bpresupuesto\b/i.test(botReply)) ||
      (context?.model && /\bmodelo\b/i.test(botReply))
    )
  );

  // ¿Avanzó la conversación?
  const advancedConversation = (
    botReply.includes('*') || // tiene datos formateados
    /\b(opciones|alternativas|te\s+muestro|te\s+paso)\b/i.test(botReply) ||
    (context?.closingIntent && /\b(asesor|coordin|reserv)\b/i.test(botReply))
  );

  // ¿Fue genérica?
  const wasGeneric = (
    replyLower.includes('tenemos muchas opciones') ||
    replyLower.includes('podemos ayudarte') ||
    (botReply.length < 60 && !botReply.includes('?') && !botReply.includes('*'))
  );

  // ¿Mezcló intenciones?
  const mixedIntents = (botReply.match(/\?/g) || []).length > 2;

  // ¿Escaló correctamente?
  const escalatedCorrectly = (
    context?.closingIntent
      ? /\b(asesor|contacto|coordin)\b/i.test(botReply)
      : true
  );

  // ¿Respetó las reglas?
  const respectedRules = isSafeToLearn(botReply);

  // ¿Riesgo de invención?
  const inventionRisk = (
    /\b(tenemos\s+\w+\s+en\s+stock|hay\s+\d+\s+unidades|el\s+\w+\s+cuesta)/i.test(botReply)
  );

  // Score 0-10
  let selfScore = 5;
  if (understoodIntent) selfScore += 1;
  if (askedUsefully) selfScore += 1;
  if (advancedConversation) selfScore += 1;
  if (wasGeneric) selfScore -= 2;
  if (mixedIntents) selfScore -= 1;
  if (!respectedRules) selfScore -= 3;
  if (inventionRisk) selfScore -= 2;
  selfScore = Math.max(0, Math.min(10, selfScore));

  let improvementHint: string | undefined;
  if (wasGeneric) improvementHint = 'Respuesta demasiado genérica — incluir opciones concretas o pregunta específica';
  else if (mixedIntents) improvementHint = 'Demasiadas preguntas — elegir la más valiosa';
  else if (!respectedRules) improvementHint = 'Texto contiene datos de catálogo — nunca incluir precios/stock en la respuesta aprendida';
  else if (inventionRisk) improvementHint = 'Riesgo de invención — verificar contra catálogo real';

  console.info(`[SELF_EVAL] wasGeneric=${wasGeneric} askedUsefully=${askedUsefully} selfScore=${selfScore}` +
    (improvementHint ? ` hint="${improvementHint}"` : ''));

  return {
    understoodIntent,
    askedUsefully,
    advancedConversation,
    wasGeneric,
    mixedIntents,
    escalatedCorrectly,
    respectedRules,
    inventionRisk,
    selfScore,
    improvementHint,
  };
}

// ─── Persistencia en DB ───────────────────────────────────────────────────────

/**
 * Guarda una entrada de memoria en Postgres (async, no bloquea).
 * Si la DB no está disponible, loguea y continúa — el fallback RAM sigue funcionando.
 */
export async function saveMemoryToDB(entry: MemoryEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bot_memory (
        conversation_id, instance_name, user_message, bot_reply,
        extracted_context, memory_type, quality_score, outcome_signals,
        safe_to_reuse, rejection_reason, self_eval
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.conversationId,
        entry.instanceName,
        entry.userMessage,
        entry.botReply,
        entry.extractedContext ? JSON.stringify(entry.extractedContext) : null,
        entry.memoryType,
        entry.qualityScore,
        entry.outcomeSignals ? JSON.stringify(entry.outcomeSignals) : null,
        entry.safeToReuse,
        entry.rejectionReason ?? null,
        entry.selfEval ? JSON.stringify(entry.selfEval) : null,
      ]
    );
  } catch (err) {
    // Nunca crashear por fallo de memoria
    console.warn('[botMemory] saveMemoryToDB failed (non-blocking):', String(err).slice(0, 200));
  }
}

// ─── Selección de few-shot ────────────────────────────────────────────────────

/**
 * Recupera ejemplos de few-shot desde Postgres para inyectar al prompt.
 *
 * Filtros:
 *  - safe_to_reuse = true
 *  - quality_score >= 5
 *  - memory_type priorizado según contexto (isIndecisive → indecision_pattern, etc.)
 *  - Ordenado por quality_score DESC, last_used_at ASC (diversidad)
 *  - Máximo 3 ejemplos
 *
 * Fallback: si la DB no está disponible, retorna [].
 */
export async function selectFewShotExamples(
  context: Record<string, any>,
  maxExamples = 3
): Promise<FewShotExample[]> {
  try {
    // Determinar tipo preferido según contexto
    let preferredType: MemoryType | null = null;
    if (context?.isIndecisive) preferredType = 'indecision_pattern';
    else if (context?.multipleVehicleTypes) preferredType = 'indecision_pattern';
    else if (context?.closingIntent) preferredType = 'handoff_pattern';

    let rows: Array<{ user_message: string; bot_reply: string; memory_type: string; quality_score: number }>;

    if (preferredType) {
      // Intentar primero con el tipo preferido
      const preferredResult = await pool.query(
        `SELECT user_message, bot_reply, memory_type, quality_score
         FROM bot_memory
         WHERE safe_to_reuse = TRUE
           AND quality_score >= 5
           AND memory_type = $1
         ORDER BY quality_score DESC, last_used_at ASC NULLS LAST
         LIMIT $2`,
        [preferredType, maxExamples]
      );

      rows = preferredResult.rows;

      // Si no hay suficientes del tipo preferido, completar con otros tipos positivos
      if (rows.length < maxExamples) {
        const remaining = maxExamples - rows.length;
        const fillResult = await pool.query(
          `SELECT user_message, bot_reply, memory_type, quality_score
           FROM bot_memory
           WHERE safe_to_reuse = TRUE
             AND quality_score >= 5
             AND memory_type != $1
             AND memory_type NOT IN ('anti_pattern', 'bad_generic_reply')
           ORDER BY quality_score DESC, last_used_at ASC NULLS LAST
           LIMIT $2`,
          [preferredType, remaining]
        );
        rows = [...rows, ...fillResult.rows];
      }
    } else {
      // Sin preferencia: mezcla de tipos positivos ordenados por score
      const result = await pool.query(
        `SELECT user_message, bot_reply, memory_type, quality_score
         FROM bot_memory
         WHERE safe_to_reuse = TRUE
           AND quality_score >= 5
           AND memory_type NOT IN ('anti_pattern', 'bad_generic_reply')
         ORDER BY quality_score DESC, last_used_at ASC NULLS LAST
         LIMIT $1`,
        [maxExamples]
      );
      rows = result.rows;
    }

    // Actualizar last_used_at en background para los ejemplos seleccionados (diversidad)
    if (rows.length > 0) {
      const messages = rows.map(r => r.user_message);
      pool.query(
        `UPDATE bot_memory SET last_used_at = NOW(), reuse_count = reuse_count + 1
         WHERE user_message = ANY($1) AND safe_to_reuse = TRUE`,
        [messages]
      ).catch(() => {});
    }

    return rows.map(r => ({
      userMessage: r.user_message,
      botReply: r.bot_reply,
      memoryType: r.memory_type as MemoryType,
      qualityScore: r.quality_score,
    }));
  } catch (err) {
    // DB no disponible — fallback silencioso
    console.warn('[botMemory] selectFewShotExamples failed (non-blocking):', String(err).slice(0, 120));
    return [];
  }
}

/**
 * Formatea ejemplos few-shot para inyectar en el prompt.
 * Etiqueta explícita: "estilo de referencia, no datos de catálogo".
 */
export function formatFewShotBlock(examples: FewShotExample[]): string {
  if (!examples.length) return '';

  const lines = [
    'CONVERSACIONES ANTERIORES EFECTIVAS (estilo de referencia, no datos de catálogo):',
    ...examples.map(e => `[user: "${e.userMessage}" → bot: "${e.botReply}"]`),
  ];

  return lines.join('\n');
}

// ─── Store en RAM (cargado una vez al inicio, fallback si DB no disponible) ───

let _store: BotMemoryStore | null = null;
let _dirty = false;
let _saveTimer: NodeJS.Timeout | null = null;

function emptyStore(): BotMemoryStore {
  return {
    conversationalPatterns: [],
    usefulQuestions: [],
    objectionPatterns: [],
    turnMetrics: [],
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('[botMemory] No se pudo crear el directorio de datos:', String(err));
    console.warn('[botMemory] La memoria no se persistirá a disco en este deploy.');
    console.warn('[botMemory] Para persistencia en Railway: configurar Volume en /app/data.');
  }
}

function checkMemoryEnabled(): boolean {
  const enabled = process.env.MEMORY_ENABLED;
  if (!enabled) {
    if (!(checkMemoryEnabled as any)._warned) {
      console.warn('[botMemory] MEMORY_ENABLED no está definida en env. La memoria funcionará pero no está explícitamente habilitada en producción.');
      console.warn('[botMemory] Agregar MEMORY_ENABLED=true en Railway env vars para suprimir este aviso.');
      (checkMemoryEnabled as any)._warned = true;
    }
  }
  return true;
}

export function loadBotMemory(): BotMemoryStore {
  if (_store) return _store;

  checkMemoryEnabled();

  try {
    ensureDataDir();
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
      _store = JSON.parse(raw) as BotMemoryStore;
      console.info(`[botMemory] Memoria cargada: ${_store.conversationalPatterns.length} patrones, ${_store.usefulQuestions.length} preguntas, ${_store.objectionPatterns.length} objeciones.`);
    } else {
      _store = emptyStore();
      console.info('[botMemory] Memoria inicializada vacía (primer arranque).');
    }
  } catch (err) {
    console.warn('[botMemory] Error leyendo memoria, iniciando vacía:', String(err));
    _store = emptyStore();
  }

  return _store;
}

function scheduleSave(): void {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!_dirty || !_store) return;
    try {
      ensureDataDir();
      _store.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(_store, null, 2), 'utf-8');
      _dirty = false;
      console.info('[botMemory] Memoria persistida a disco.');
    } catch (err) {
      const errMsg = String(err);
      if (errMsg.includes('ENOENT') || errMsg.includes('EACCES') || errMsg.includes('EROFS')) {
        console.warn('[botMemory] No se pudo escribir a disco (probable Railway sin Volume):', errMsg.slice(0, 120));
        console.warn('[botMemory] Operando en modo RAM. Configurar Railway Volume en /app/data para persistencia.');
      } else {
        console.warn('[botMemory] Error guardando memoria:', errMsg.slice(0, 120));
      }
    }
  }, 10_000);
}

function addWithFIFO<T>(arr: T[], item: T, max = MAX_PATTERNS_PER_CATEGORY): T[] {
  const updated = [...arr, item];
  if (updated.length > max) return updated.slice(updated.length - max);
  return updated;
}

// ─── API pública (legacy Fase 1-2, mantenida para compatibilidad) ─────────────

export function recordConversationalPattern(
  trigger: string,
  effectiveResponse: string,
  successSignal: string,
  metrics?: MemoryScore
): void {
  if (!isSafeToLearn(trigger) || !isSafeToLearn(effectiveResponse)) {
    console.info('[BOT_MEMORY_SKIP] pattern=conversational_pattern score=0 reason="forbidden_word_in_pattern"');
    return;
  }

  if (metrics && !shouldSavePattern('conversational_pattern', metrics)) {
    return;
  }

  const store = loadBotMemory();
  const now = new Date().toISOString();

  const existing = store.conversationalPatterns.find(
    (p) => p.trigger.toLowerCase() === trigger.toLowerCase()
  );
  if (existing) {
    existing.timesUsed++;
    existing.lastUsed = now;
  } else {
    store.conversationalPatterns = addWithFIFO(store.conversationalPatterns, {
      trigger,
      effectiveResponse,
      successSignal,
      timesUsed: 1,
      lastUsed: now,
    });
  }

  _dirty = true;
  scheduleSave();
}

export function recordUsefulQuestion(
  context: string,
  question: string,
  wasSuccessful: boolean
): void {
  if (!isSafeToLearn(question)) return;

  const store = loadBotMemory();
  const now = new Date().toISOString();

  const existing = store.usefulQuestions.find(
    (q) => q.question.toLowerCase() === question.toLowerCase()
  );
  if (existing) {
    const total = existing.timesUsed + 1;
    const successes = Math.round(existing.successRate * existing.timesUsed) + (wasSuccessful ? 1 : 0);
    existing.successRate = successes / total;
    existing.timesUsed = total;
    existing.lastUsed = now;
  } else {
    store.usefulQuestions = addWithFIFO(store.usefulQuestions, {
      context,
      question,
      successRate: wasSuccessful ? 1.0 : 0.0,
      timesUsed: 1,
      lastUsed: now,
    });
  }

  _dirty = true;
  scheduleSave();
}

export function recordObjectionHandling(
  objection: string,
  effectiveHandling: string,
  successSignal: string
): void {
  if (!isSafeToLearn(effectiveHandling)) return;

  const store = loadBotMemory();
  const now = new Date().toISOString();

  const existing = store.objectionPatterns.find(
    (o) => o.objection.toLowerCase() === objection.toLowerCase()
  );
  if (existing) {
    existing.timesUsed++;
    existing.lastUsed = now;
    existing.effectiveHandling = effectiveHandling;
  } else {
    store.objectionPatterns = addWithFIFO(store.objectionPatterns, {
      objection,
      effectiveHandling,
      successSignal,
      timesUsed: 1,
      lastUsed: now,
    });
  }

  _dirty = true;
  scheduleSave();
}

export function recordTurnMetrics(metrics: Omit<TurnMetrics, 'flags'>): void {
  const store = loadBotMemory();

  const enriched: TurnMetrics = {
    ...metrics,
    flags: {
      tooLong: metrics.responseLength > 500,
      tooManyQuestions: metrics.questionsAsked > 1,
    },
  };

  if (enriched.flags.tooLong) {
    console.info(`[botMemory] Flag: respuesta larga (${metrics.responseLength} chars) en conversación ${metrics.conversationId} turno ${metrics.turnIndex}`);
  }
  if (enriched.flags.tooManyQuestions) {
    console.info(`[botMemory] Flag: múltiples preguntas (${metrics.questionsAsked}) en conversación ${metrics.conversationId} turno ${metrics.turnIndex}`);
  }

  store.turnMetrics = addWithFIFO(store.turnMetrics, enriched, 500);

  _dirty = true;
  scheduleSave();
}

// ─── Consultas para el prompt (legacy Fase 2, mantenidas) ─────────────────────

export function getTopUsefulQuestions(context: string, limit = 3): UsefulQuestion[] {
  const store = loadBotMemory();
  return store.usefulQuestions
    .filter((q) => q.timesUsed >= 2 && (q.context === context || q.context === 'general'))
    .sort((a, b) => b.successRate - a.successRate || b.timesUsed - a.timesUsed)
    .slice(0, limit);
}

export function getBestObjectionHandling(objection: string): ObjectionPattern | null {
  const store = loadBotMemory();
  const matches = store.objectionPatterns
    .filter((o) => o.objection.toLowerCase().includes(objection.toLowerCase()))
    .sort((a, b) => b.timesUsed - a.timesUsed);
  return matches[0] || null;
}

export function buildIndecisiveContextBlock(): string {
  const questions = getTopUsefulQuestions('indecisive');
  if (!questions.length) return '';

  const lines = [
    '── PREGUNTAS EFECTIVAS PARA CLIENTES INDECISOS (ejemplos de conversaciones reales) ──',
    'Las siguientes preguntas generaron datos útiles en conversaciones anteriores.',
    'Son ejemplos — no reglas. Usalas si aplican al contexto actual:',
    ...questions.map((q, i) => `${i + 1}. "${q.question}" (éxito: ${Math.round(q.successRate * 100)}%)`),
  ];

  return lines.join('\n');
}

export function buildObjectionContextBlock(objectionType: string): string {
  const best = getBestObjectionHandling(objectionType);
  if (!best) return '';

  return [
    `── MANEJO EFECTIVO DE OBJECIÓN "${best.objection}" (ejemplo de conversación real) ──`,
    `Respuesta que funcionó antes: "${best.effectiveHandling}"`,
    `Señal de éxito: ${best.successSignal}`,
    'Este es un ejemplo — adaptalo al contexto y tono del cliente actual.',
  ].join('\n');
}
