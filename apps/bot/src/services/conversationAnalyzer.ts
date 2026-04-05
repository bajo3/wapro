/**
 * conversationAnalyzer.ts — Pre-response brain for WaPro bot
 *
 * Provides deterministic, fast analysis of conversation state BEFORE
 * each agent call. Zero GPT cost. Used to:
 *  - Classify user intent from the latest message + history
 *  - Detect conversation friction (loops, repeated questions, stalls)
 *  - Decide the next best action before calling the agent
 *  - Build rich context for agent.ts and decision logs
 *
 * Functions exported:
 *  - analyzeIntent()            → what the user wants RIGHT NOW
 *  - detectConversationFriction() → friction / loop detection
 *  - buildConversationContext() → full pre-response context object
 *
 * @module conversationAnalyzer
 */

import type { ConvState } from './state.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentType =
  | 'stock_search'
  | 'price_inquiry'
  | 'closing'
  | 'objection'
  | 'financing_inquiry'
  | 'trade_in'
  | 'comparison'
  | 'indecision'
  | 'greeting'
  | 'farewell'
  | 'general_inquiry'
  | 'test_drive'
  | 'location_inquiry'
  | 'warranty_inquiry';

export type NextAction =
  | 'SHOW_STOCK'
  | 'ASK_BUDGET'
  | 'ASK_USE_CASE'
  | 'ASK_VEHICLE'
  | 'ESCALATE_HUMAN'
  | 'HANDLE_OBJECTION'
  | 'OFFER_FINANCING'
  | 'ASK_TRADE_IN_DETAILS'
  | 'COMPARE_VEHICLES'
  | 'RECOMMEND_WITH_CONTEXT'
  | 'CAPTURE_INTENT'
  | 'CLOSE_WARM'
  | 'CONTINUE_AGENT';

export interface IntentAnalysis {
  /** Primary detected intent */
  primaryIntent: IntentType;
  /** More specific sub-intent when applicable */
  subIntent: string | null;
  /** 0–1 confidence in the detected intent */
  confidence: number;
  /** Human-readable signals that fired */
  signals: string[];
  /** Recommended next action for the agent */
  nextBestAction: NextAction;
  /** Whether this conversation needs a human right now */
  requiresHuman: boolean;
}

export interface FrictionAnalysis {
  /** True if the conversation is going in circles or stalled */
  isStalled: boolean;
  /** Bot questions asked 2+ times without user answering */
  repeatedQuestions: string[];
  /** True if bot repeated the same question at least twice */
  loopDetected: boolean;
  /** Fields bot asked for that user never provided */
  pendingAnswers: string[];
  /** How many turns have passed without extracting new data */
  stalledTurns: number;
  /** Suggested action to break the stall */
  suggestedBreakout: string;
}

export interface ConversationContext {
  /** Total turns in history */
  turnCount: number;
  /** User turns only */
  userTurnCount: number;
  /** Whether we have at least one useful filter */
  hasUsefulData: boolean;
  /** 0–1: how many relevant fields are known */
  dataCompleteness: number;
  /** Lead temperature from score */
  leadTemperature: 'FRIO' | 'TIBIO' | 'CALIENTE';
  /** Numeric lead score (0–100) */
  leadScore: number;
  /** Friction analysis result */
  friction: FrictionAnalysis;
  /** Intent analysis result */
  intent: IntentAnalysis;
  /** True if the lead is ready to be closed / escalated */
  readyToClose: boolean;
  /** True if we need to ask more qualifying questions */
  needsProfileBuilding: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── Intent Classification ────────────────────────────────────────────────────

const INTENT_RULES: Array<{
  intent: IntentType;
  subIntent?: string;
  patterns: RegExp[];
  confidence: number;
  nextAction: NextAction;
  requiresHuman?: boolean;
}> = [
  // High-priority: closing signals
  {
    intent: 'closing',
    patterns: [
      /\b(reserv|seña|señal|lo\s+tomo|lo\s+quiero|me\s+lo\s+llevo|cierro|cerramos|hago\s+el\s+trato|quiero\s+comprarlo?|cuando\s+puedo\s+ir|cuando\s+vengo|lo\s+aparto|quiero\s+avanzar)\b/i,
    ],
    confidence: 0.92,
    nextAction: 'ESCALATE_HUMAN',
    requiresHuman: true,
  },
  // Financing
  {
    intent: 'financing_inquiry',
    patterns: [
      /\b(cuotas?|financio|financiacion|credito|anticipo|banco|a\s+cuantos?\s+meses|con\s+credito|pago\s+en\s+cuotas?|prestamo|pgp|plan\s+de\s+pago)\b/i,
    ],
    confidence: 0.85,
    nextAction: 'OFFER_FINANCING',
  },
  // Trade-in
  {
    intent: 'trade_in',
    patterns: [
      /\b(permuta|canje|te\s+doy\s+el\s+mio|mi\s+auto\s+como|parte\s+de\s+pago|lo\s+cambio|tomo\s+el\s+mio|entrego\s+el\s+mio|auto\s+usado\s+como\s+parte)\b/i,
    ],
    confidence: 0.88,
    nextAction: 'ASK_TRADE_IN_DETAILS',
  },
  // Price objection
  {
    intent: 'objection',
    subIntent: 'price_objection',
    patterns: [
      /\b(muy\s+caro|esta\s+caro|no\s+tengo\s+tanto|me\s+parece\s+mucho|no\s+me\s+llega|es\s+mucho\s+precio|no\s+me\s+convence\s+el\s+precio|se\s+me\s+va)\b/i,
    ],
    confidence: 0.80,
    nextAction: 'HANDLE_OBJECTION',
  },
  // General objection / hesitation
  {
    intent: 'objection',
    subIntent: 'hesitation',
    patterns: [
      /\b(lo\s+pienso|lo\s+veo|te\s+aviso\s+despues|no\s+me\s+convence|despues\s+lo\s+veo|no\s+es\s+lo\s+que\s+busco|voy\s+a\s+seguir\s+mirando)\b/i,
    ],
    confidence: 0.72,
    nextAction: 'HANDLE_OBJECTION',
  },
  // Show intent / explicit request to see stock
  {
    intent: 'stock_search',
    subIntent: 'explicit_show',
    patterns: [
      /\b(mostrame|que\s+tenes|que\s+hay|pasame|manda|mira|quer[oé]\s+ver|hay\s+algo|listame|tenes\s+algo|show\s+me)\b/i,
    ],
    confidence: 0.88,
    nextAction: 'SHOW_STOCK',
  },
  // Stock search by vehicle type
  {
    intent: 'stock_search',
    subIntent: 'by_filter',
    patterns: [
      /\b(busco\s+(un|una)|quiero\s+(un|una)|ando\s+buscando|necesito\s+(un|una))\b/i,
    ],
    confidence: 0.78,
    nextAction: 'SHOW_STOCK',
  },
  // Price inquiry
  {
    intent: 'price_inquiry',
    patterns: [
      /\b(cuanto\s+sale|cuanto\s+cuesta|precio|vale\s+cuanto|cuanto\s+es|costo|cuanto\s+piden|a\s+como\s+esta)\b/i,
    ],
    confidence: 0.82,
    nextAction: 'SHOW_STOCK',
  },
  // Comparison
  {
    intent: 'comparison',
    patterns: [
      /\b(cual\s+es\s+mejor|diferencia\s+entre|comparo|vs\.?|versus|me\s+conviene\s+mas|cual\s+me\s+recomendas\s+entre)\b/i,
    ],
    confidence: 0.78,
    nextAction: 'COMPARE_VEHICLES',
  },
  // Indecision / recommendation request
  {
    intent: 'indecision',
    patterns: [
      /\b(no\s+se\s+que\s+elegir|que\s+me\s+recomendas|ayudame\s+a\s+elegir|no\s+se\s+cual|sugerime|que\s+me\s+conviene)\b/i,
    ],
    confidence: 0.80,
    nextAction: 'RECOMMEND_WITH_CONTEXT',
  },
  // Test drive
  {
    intent: 'test_drive',
    patterns: [
      /\b(test\s+drive|puedo\s+probar|probarlo|manejar(lo)?|vuelta\s+de\s+prueba)\b/i,
    ],
    confidence: 0.85,
    nextAction: 'ESCALATE_HUMAN',
    requiresHuman: true,
  },
  // Location
  {
    intent: 'location_inquiry',
    patterns: [
      /\b(donde\s+estan|donde\s+quedan|direccion|ubicacion|como\s+llego|local|sucursal|tienen\s+local)\b/i,
    ],
    confidence: 0.80,
    nextAction: 'ESCALATE_HUMAN',
  },
  // Warranty
  {
    intent: 'warranty_inquiry',
    patterns: [
      /\b(garantia|tiene\s+garantia|cuanta\s+garantia|con\s+garantia)\b/i,
    ],
    confidence: 0.78,
    nextAction: 'CONTINUE_AGENT',
  },
  // Farewell
  {
    intent: 'farewell',
    patterns: [
      /\b(gracias|chau|hasta\s+luego|bye|hasta\s+pronto|nos\s+vemos|listo\s+ya|ya\s+listo|ok\s+gracias)\b/i,
    ],
    confidence: 0.75,
    nextAction: 'CLOSE_WARM',
  },
  // Greeting (only if very short message)
  {
    intent: 'greeting',
    patterns: [
      /^(hola|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|buen\s+dia|saludos)[\s!.]*$/i,
    ],
    confidence: 0.70,
    nextAction: 'CAPTURE_INTENT',
  },
];

/**
 * Analyze the user's intent from the latest message and extracted context.
 * Fast, deterministic — no GPT needed.
 */
export function analyzeIntent(
  userMessage: string,
  extracted: Record<string, any>
): IntentAnalysis {
  const t = norm(userMessage);
  const signals: string[] = [];

  let best: (typeof INTENT_RULES)[0] | null = null;
  let bestConf = 0;

  for (const rule of INTENT_RULES) {
    if (matchesAny(userMessage, rule.patterns) || matchesAny(t, rule.patterns)) {
      if (rule.confidence > bestConf) {
        best = rule;
        bestConf = rule.confidence;
      }
    }
  }

  // Default if no rule matched
  if (!best) {
    // Fallback: if there's a useful filter in extracted, suggest show stock
    const hasFilter = !!(
      extracted?.brand || extracted?.model || extracted?.maxPrice ||
      extracted?.bodywork || extracted?.fuel || extracted?.transmission
    );
    return {
      primaryIntent: hasFilter ? 'stock_search' : 'general_inquiry',
      subIntent: null,
      confidence: hasFilter ? 0.55 : 0.40,
      signals: hasFilter ? ['has_extracted_filter'] : ['no_clear_intent'],
      nextBestAction: hasFilter ? 'SHOW_STOCK' : 'CAPTURE_INTENT',
      requiresHuman: false,
    };
  }

  // Enrich signals with extracted context
  if (extracted?.brand)        signals.push(`brand:${extracted.brand}`);
  if (extracted?.maxPrice)     signals.push(`budget:${extracted.currency ?? 'ARS'}${extracted.maxPrice}`);
  if (extracted?.hasTradeIn)   signals.push('has_trade_in');
  if (extracted?.wantsFinancing) signals.push('wants_financing');

  // Adjust next action based on what we already know
  let nextAction = best.nextAction;
  if (best.intent === 'indecision' && extracted?.maxPrice) {
    nextAction = 'RECOMMEND_WITH_CONTEXT';
  }
  if (best.intent === 'trade_in' && extracted?.tradeInModel) {
    // Already have trade-in details → show stock
    nextAction = 'SHOW_STOCK';
  }

  signals.push(`matched:${best.intent}`);

  return {
    primaryIntent: best.intent,
    subIntent: best.subIntent ?? null,
    confidence: best.confidence,
    signals,
    nextBestAction: nextAction,
    requiresHuman: best.requiresHuman ?? false,
  };
}

// ─── Friction Detection ───────────────────────────────────────────────────────

/**
 * Detect conversation friction: repeated questions, loops, stalled progress.
 * Uses conversation history and state data.
 */
export function detectConversationFriction(
  history: Array<{ role: string; content: string }>,
  state: ConvState,
  extracted: Record<string, any>
): FrictionAnalysis {
  const botMessages = history.filter((h) => h.role === 'assistant').map((h) => h.content);

  // Extract questions the bot asked (crude: sentences ending in ?)
  const botQuestions: string[] = [];
  for (const msg of botMessages) {
    const sentences = msg.match(/[^.!?]*\?/g) ?? [];
    for (const s of sentences) {
      const clean = norm(s).trim();
      if (clean.length > 8) botQuestions.push(clean);
    }
  }

  // Count question occurrences
  const qCount = new Map<string, number>();
  for (const q of botQuestions) {
    qCount.set(q, (qCount.get(q) ?? 0) + 1);
  }
  const repeatedQuestions = [...qCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([q]) => q);

  const loopDetected = repeatedQuestions.length > 0;

  // Fields repeatedly asked but not provided
  const repeatedMissing: string[] = Array.isArray((state as any).repeated_missing_fields)
    ? (state as any).repeated_missing_fields
    : [];
  const pendingAnswers = repeatedMissing.slice(0, 5);

  // Stalled turns: turns since the last new useful piece of data was extracted
  const msgCount = Number((state as any).user_msg_count ?? 0);
  const stalledTurns = pendingAnswers.length >= 2 && msgCount >= 4 ? pendingAnswers.length : 0;
  const isStalled = loopDetected || stalledTurns >= 3;

  let suggestedBreakout = 'CONTINUE_NORMALLY';
  if (isStalled && loopDetected) {
    suggestedBreakout = 'SKIP_MISSING_DATA_SHOW_OPTIONS';
  } else if (stalledTurns >= 4) {
    suggestedBreakout = 'ESCALATE_TO_HUMAN';
  } else if (repeatedMissing.length >= 2) {
    suggestedBreakout = 'PROCEED_WITH_PARTIAL_DATA';
  }

  return {
    isStalled,
    repeatedQuestions,
    loopDetected,
    pendingAnswers,
    stalledTurns,
    suggestedBreakout,
  };
}

// ─── Full Context Builder ─────────────────────────────────────────────────────

/**
 * Build the full ConversationContext before calling the agent.
 * Assembles intent, friction, lead state, and data completeness.
 */
export function buildConversationContext(params: {
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  state: ConvState;
  extracted: Record<string, any>;
  leadScore: number;
}): ConversationContext {
  const { userMessage, history, state, extracted, leadScore } = params;

  const intent = analyzeIntent(userMessage, extracted);
  const friction = detectConversationFriction(history, state, extracted);

  const userTurnCount = history.filter((h) => h.role === 'user').length;
  const turnCount = history.length;

  // Data completeness: how many relevant fields we have vs. how many we'd want
  const relevantFields = [
    extracted?.brand,
    extracted?.model,
    extracted?.maxPrice ?? extracted?.amount,
    extracted?.transmission,
    extracted?.fuel,
    extracted?.bodywork,
    extracted?.condition,
    extracted?.useCase,
  ];
  const filledFields = relevantFields.filter(
    (v) => v !== undefined && v !== null && String(v).trim() !== ''
  ).length;
  const dataCompleteness = Math.min(1, filledFields / 4); // 4 = reasonable minimum

  const hasUsefulData = filledFields >= 1;

  const leadTemperature: ConversationContext['leadTemperature'] =
    leadScore >= 70 ? 'CALIENTE' : leadScore >= 40 ? 'TIBIO' : 'FRIO';

  const readyToClose =
    intent.requiresHuman ||
    intent.primaryIntent === 'closing' ||
    leadScore >= 70;

  const needsProfileBuilding =
    !hasUsefulData && intent.primaryIntent !== 'farewell' && intent.primaryIntent !== 'greeting';

  return {
    turnCount,
    userTurnCount,
    hasUsefulData,
    dataCompleteness,
    leadTemperature,
    leadScore,
    friction,
    intent,
    readyToClose,
    needsProfileBuilding,
  };
}

// ─── Stagnation Detector ─────────────────────────────────────────────────────

export interface StagnationResult {
  /** True if the conversation has stalled without meaningful progress */
  isStagnant: boolean;
  /** How many consecutive turns had no new useful data extracted */
  stagnantTurns: number;
  /** True if the extracted context has not changed across the last N user turns */
  extractedUnchanged: boolean;
  /** True if the same intent appeared 3+ times without action */
  intentLoop: boolean;
  /** Reason string for logging / agent context */
  reason: string;
}

/**
 * detectStagnation — detects conversations where the bot and client are going
 * in circles without progressing toward a sale.
 *
 * Triggers escalation when:
 *  - The extracted context has not changed across 3+ consecutive user turns, OR
 *  - The same intent was repeated 3+ times, OR
 *  - There have been 9+ total turns without a closing action.
 *
 * Used by the webhook handler to force handoffRecommended=true and log a
 * stagnation event visible to operators in the panel.
 */
export function detectStagnation(params: {
  history: Array<{ role: string; content: string }>;
  extracted: Record<string, any>;
  /** Snapshot of extracted from N turns ago — used to detect unchanged context */
  prevExtracted?: Record<string, any>;
  intent: IntentAnalysis;
  leadScore: number;
  userTurnCount: number;
}): StagnationResult {
  const { history, extracted, prevExtracted, intent, leadScore, userTurnCount } = params;

  const base: StagnationResult = {
    isStagnant: false,
    stagnantTurns: 0,
    extractedUnchanged: false,
    intentLoop: false,
    reason: '',
  };

  // Don't flag stagnation if lead is hot or already escalating
  if (leadScore >= 60 || intent.requiresHuman || intent.primaryIntent === 'closing') {
    return base;
  }

  // ── Check 1: Extracted context unchanged for 3+ turns ────────────────────
  // Compare current extracted against snapshot from 3 turns ago.
  // If the key vehicle-search fields are identical → no progress.
  const trackFields = ['brand', 'model', 'maxPrice', 'bodywork', 'fuel', 'transmission', 'condition', 'useCase'];
  let extractedUnchanged = false;
  if (prevExtracted && userTurnCount >= 3) {
    const current = trackFields.map((f) => String(extracted?.[f] ?? '')).join('|');
    const prev = trackFields.map((f) => String(prevExtracted?.[f] ?? '')).join('|');
    extractedUnchanged = current === prev && current !== '||||||';
  }

  // ── Check 2: Intent loop — same intent 3+ consecutive user turns ─────────
  const userMessages = history.filter((h) => h.role === 'user').slice(-4);
  const intentLoop = userMessages.length >= 3 &&
    ['greeting', 'general_inquiry'].includes(intent.primaryIntent) &&
    userTurnCount >= 4;

  // ── Check 3: Total turns threshold — long conv without close ─────────────
  const tooManyTurns = userTurnCount >= 9 && leadScore < 50;

  const isStagnant = extractedUnchanged || intentLoop || tooManyTurns;

  let reason = '';
  if (tooManyTurns) reason = `${userTurnCount} turnos sin cierre (score=${leadScore})`;
  else if (intentLoop) reason = `intent loop: ${intent.primaryIntent} repetido sin avance`;
  else if (extractedUnchanged) reason = 'contexto de búsqueda sin cambios en últimos 3 turnos';

  return {
    isStagnant,
    stagnantTurns: extractedUnchanged ? 3 : 0,
    extractedUnchanged,
    intentLoop,
    reason,
  };
}

// ─── Decision Logger Helper ───────────────────────────────────────────────────

/**
 * Format a ConversationContext into a compact log string.
 * Used for debug logging and decision audit trails.
 */
export function formatContextLog(ctx: ConversationContext): string {
  const { intent, friction, leadTemperature, leadScore, dataCompleteness } = ctx;
  return [
    `[analyzer] intent=${intent.primaryIntent}${intent.subIntent ? `/${intent.subIntent}` : ''} conf=${intent.confidence.toFixed(2)}`,
    `  next=${intent.nextBestAction} human=${intent.requiresHuman}`,
    `  lead=${leadTemperature}(${leadScore}) data=${Math.round(dataCompleteness * 100)}%`,
    friction.isStalled
      ? `  ⚠ STALLED turns=${friction.stalledTurns} loop=${friction.loopDetected} → ${friction.suggestedBreakout}`
      : `  ok friction=none`,
  ].join('\n');
}
