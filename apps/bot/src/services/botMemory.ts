/**
 * botMemory.ts — Memoria conversacional incremental del bot (Fase 2)
 *
 * QUÉ guarda: patrones conversacionales efectivos, preguntas útiles, manejo de objeciones.
 * QUÉ NO guarda: precios, stock, disponibilidad, financiación, descuentos — datos del catálogo.
 *
 * Persistencia: apps/bot/data/bot-memory.json
 * Máximo 100 patrones por categoría (FIFO).
 * Las escrituras son async y nunca bloquean la respuesta principal.
 *
 * Uso en el prompt:
 *  - Cliente indeciso → inyectar top 3 preguntas más exitosas
 *  - Objeción detectada → inyectar manejo exitoso más reciente
 *
 * PRINCIPIO: La memoria solo aprende de conversación, nunca de catálogo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Rutas ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const MEMORY_FILE = path.join(DATA_DIR, 'bot-memory.json');

const MAX_PATTERNS_PER_CATEGORY = 100;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Patrón conversacional que funcionó: el usuario siguió respondiendo o avanzó. */
export interface ConversationalPattern {
  trigger: string;            // qué tipo de mensaje disparó la respuesta
  effectiveResponse: string;  // cómo respondió el bot que generó avance
  successSignal: string;      // qué indicó que funcionó
  timesUsed: number;
  lastUsed: string;           // ISO timestamp
}

/** Pregunta que generó datos útiles del cliente. */
export interface UsefulQuestion {
  context: string;            // en qué contexto es útil (indeciso, sin presupuesto, etc.)
  question: string;           // la pregunta en sí
  successRate: number;        // 0.0–1.0 — % de veces que generó más datos
  timesUsed: number;
  lastUsed: string;
}

/** Cómo se manejó exitosamente una objeción. */
export interface ObjectionPattern {
  objection: string;          // tipo de objeción ("está caro", "lo pienso", etc.)
  effectiveHandling: string;  // cómo se resolvió
  successSignal: string;      // qué indicó éxito
  timesUsed: number;
  lastUsed: string;
}

/** Métricas de autoevaluación de un turno de respuesta. */
export interface TurnMetrics {
  conversationId: string;
  turnIndex: number;
  responseLength: number;     // chars
  questionsAsked: number;     // conteo de "?" en la respuesta
  dataExtracted: number;      // campos estructurados llenos después del turno
  followUp: boolean;          // si el usuario respondió en el siguiente turno
  flags: {
    tooLong: boolean;         // > 500 chars
    tooManyQuestions: boolean; // > 1 pregunta
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

// ─── Campos prohibidos en memoria ─────────────────────────────────────────────
// Nunca guardar datos de catálogo en la memoria conversacional.

const FORBIDDEN_IN_MEMORY = [
  'precio', 'stock', 'disponible', 'disponibilidad', 'cuotas',
  'financiacion', 'financiación', 'descuento', 'promocion', 'promoción',
  'oferta', 'tasa', 'anticipo', 'cuota', 'kilometros', 'kilómetros',
  'año del auto', 'modelo disponible'
];

export function isSafeToLearn(pattern: string): boolean {
  const lower = String(pattern || '').toLowerCase();
  return !FORBIDDEN_IN_MEMORY.some((word) => lower.includes(word));
}

// ─── Store en memoria (cargado una vez al inicio) ─────────────────────────────

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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Carga la memoria desde disco. Se llama una vez al arrancar el servicio.
 * Si el archivo no existe, crea un store vacío en memoria (sin escribir a disco todavía).
 */
export function loadBotMemory(): BotMemoryStore {
  if (_store) return _store;

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

/**
 * Persiste el store a disco de forma debounced (no bloquea el flujo principal).
 * Se ejecuta máximo cada 10 segundos cuando hay cambios.
 */
function scheduleSave(): void {
  if (_saveTimer) return; // ya hay un save pendiente
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
      console.warn('[botMemory] Error guardando memoria:', String(err));
    }
  }, 10_000);
}

// ─── Helpers de FIFO ─────────────────────────────────────────────────────────

function addWithFIFO<T>(arr: T[], item: T, max = MAX_PATTERNS_PER_CATEGORY): T[] {
  const updated = [...arr, item];
  if (updated.length > max) return updated.slice(updated.length - max);
  return updated;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Registra un patrón conversacional efectivo.
 * Solo se guarda si pasa la validación de seguridad (sin datos de catálogo).
 */
export function recordConversationalPattern(
  trigger: string,
  effectiveResponse: string,
  successSignal: string
): void {
  if (!isSafeToLearn(trigger) || !isSafeToLearn(effectiveResponse)) {
    console.info('[botMemory] Patrón rechazado por contener datos de catálogo.');
    return;
  }

  const store = loadBotMemory();
  const now = new Date().toISOString();

  // Buscar si ya existe un patrón similar (por trigger)
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

/**
 * Registra una pregunta útil (generó datos del cliente).
 */
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

/**
 * Registra cómo se manejó exitosamente una objeción.
 */
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
    // Actualizar con el manejo más reciente
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

/**
 * Registra las métricas de un turno para autoevaluación.
 */
export function recordTurnMetrics(metrics: Omit<TurnMetrics, 'flags'>): void {
  const store = loadBotMemory();

  const enriched: TurnMetrics = {
    ...metrics,
    flags: {
      tooLong: metrics.responseLength > 500,
      tooManyQuestions: metrics.questionsAsked > 1,
    },
  };

  // Log inmediato si hay flags de calidad
  if (enriched.flags.tooLong) {
    console.info(`[botMemory] Flag: respuesta larga (${metrics.responseLength} chars) en conversación ${metrics.conversationId} turno ${metrics.turnIndex}`);
  }
  if (enriched.flags.tooManyQuestions) {
    console.info(`[botMemory] Flag: múltiples preguntas (${metrics.questionsAsked}) en conversación ${metrics.conversationId} turno ${metrics.turnIndex}`);
  }

  // Mantener solo los últimos 500 turnos (rotación rápida)
  store.turnMetrics = addWithFIFO(store.turnMetrics, enriched, 500);

  _dirty = true;
  scheduleSave();
}

// ─── Consultas para el prompt ─────────────────────────────────────────────────

/**
 * Devuelve las top N preguntas más exitosas para clientes indecisos.
 * Ordenadas por successRate descendente, mínimo 2 usos para ser considerada.
 */
export function getTopUsefulQuestions(context: string, limit = 3): UsefulQuestion[] {
  const store = loadBotMemory();
  return store.usefulQuestions
    .filter((q) => q.timesUsed >= 2 && (q.context === context || q.context === 'general'))
    .sort((a, b) => b.successRate - a.successRate || b.timesUsed - a.timesUsed)
    .slice(0, limit);
}

/**
 * Devuelve el manejo más reciente y exitoso de una objeción.
 */
export function getBestObjectionHandling(objection: string): ObjectionPattern | null {
  const store = loadBotMemory();
  const matches = store.objectionPatterns
    .filter((o) => o.objection.toLowerCase().includes(objection.toLowerCase()))
    .sort((a, b) => b.timesUsed - a.timesUsed);
  return matches[0] || null;
}

/**
 * Construye un bloque de contexto para inyectar en el prompt cuando el cliente es indeciso.
 * Marca los ejemplos explícitamente como "conversación efectiva", nunca como regla de catálogo.
 */
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

/**
 * Construye un bloque de contexto para inyectar cuando se detecta una objeción.
 */
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
