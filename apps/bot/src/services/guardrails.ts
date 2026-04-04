/**
 * guardrails.ts — Response quality guardrails for WaPro bot v1
 *
 * Valida respuestas del bot ANTES de enviarlas al usuario para prevenir:
 *  1. Fuga de contenido interno (JSON crudo, políticas, marcadores de prompt)
 *  2. Bloques de código o estructuras técnicas
 *  3. Respuestas vacías o trivialmente inútiles
 *  4. Datos posiblemente alucinados (tasas exactas, cuotas exactas sin asesor)
 *  5. Repetición idéntica de la última respuesta enviada
 *
 * Design principles:
 *  - Low false-positive rate: mejor dejar pasar algo dudoso que bloquear respuestas legítimas
 *  - Fast: solo regex + string ops, zero async
 *  - Non-blocking: nunca lanzar excepción, siempre devolver un resultado
 *
 * @module guardrails
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardrailIssue =
  | 'empty_reply'
  | 'internal_content'
  | 'raw_json'
  | 'code_block'
  | 'action_code_leaked'
  | 'likely_hallucination'
  | 'repeated_reply'
  | 'policy_body_too_long';

export interface GuardrailResult {
  /** True if the reply is safe to send as-is */
  ok: boolean;
  /** Issues detected. Empty when ok=true */
  issues: GuardrailIssue[];
  /**
   * Cleaned version of the reply when a minor fixable issue was found
   * (e.g. code block stripped). Null if the reply should be discarded entirely.
   */
  safeReply: string | null;
}

// ─── Detection Patterns ───────────────────────────────────────────────────────

/**
 * Patterns that strongly indicate internal/system content leaked into user reply.
 * Kept deliberately narrow — false positives are worse than false negatives here.
 */
const INTERNAL_MARKERS: Array<{ pattern: RegExp; issue: GuardrailIssue }> = [
  // Raw JSON decision objects from the agent
  { pattern: /\{\s*"intent"\s*:/,          issue: 'raw_json' },
  { pattern: /["']suggestedReply["']\s*:/, issue: 'raw_json' },
  { pattern: /["']internalReason["']\s*:/, issue: 'raw_json' },
  { pattern: /["']handoffRecommended["']/, issue: 'raw_json' },
  { pattern: /["']vehicleIds["']\s*:\s*\[/, issue: 'raw_json' },

  // Fenced code blocks
  { pattern: /```[\s\S]{0,2000}```/,       issue: 'code_block' },

  // Agent action codes that should never reach the user
  {
    pattern: /\baction\s*=\s*(?:ESCALATE_HUMAN|CAPTURE_LEAD|SHOW_RESULTS|OFFER_FINANCING|CLOSE_CONVERSATION)\b/i,
    issue: 'action_code_leaked'
  },

  // Prompt section headers that leaked through (e.g. "── REGLAS ──")
  {
    pattern: /──\s+[A-ZÁÉÍÓÚÜÑ\s]{3,40}\s+──/,
    issue: 'internal_content'
  },

  // Named intent flags from the prompt
  {
    pattern: /\b(?:MOSTRAR_DIRECTO|ORDENAR_PRECIO|EXPANDIR_RANGO|CIERRE_CONVERSACION|INTENCION_COMPRA)\b/,
    issue: 'internal_content'
  },

  // Section titles from the agent system prompt that could bleed into reply
  {
    pattern: /DATA\s+YA\s+CONOCIDA|INTENCIONES\s+DETECTADAS|CAMPOS\s+QUE\s+NO\s+DEBÉS/,
    issue: 'internal_content'
  },
];

/**
 * Patterns that indicate likely hallucinated specific numeric data.
 * We FLAG but don't BLOCK these (too risky for false positives).
 * The intent is to log them and let the operator review.
 */
const HALLUCINATION_SIGNALS: RegExp[] = [
  // Specific interest rates with many decimals (invented)
  /\btasa\s+(?:anual|nominal|efectiva)?\s+(?:de\s+)?\d+[,.]\d{2,}\s*%/i,
  // Exact cuota amount stated without asesor caveat
  /\bcuota\s+(?:es|sería|de)\s+(?:ARS\s*)?\$?\s*\d{5,}/i,
  // Specific warranty years/months (bot shouldn't promise these)
  /\bgarantía\s+de\s+\d+\s+(?:año|mes)/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip fenced code blocks (```...```) from text. Best-effort cleanup.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```(?:json|typescript|js)?\s*[\s\S]*?```/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Rough similarity check: are two strings "basically the same"?
 * Used to detect repeated replies without being too strict.
 */
function isVirtuallyIdentical(a: string, b: string): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[¡!¿?.,:;]/g, '')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // Short-circuit for very short strings
  if (na.length < 20 || nb.length < 20) return false;
  // Check if one starts with a large prefix of the other (80% overlap)
  const minLen = Math.min(na.length, nb.length);
  const overlap = Math.floor(minLen * 0.80);
  return na.slice(0, overlap) === nb.slice(0, overlap);
}

// ─── Main Guardrail ───────────────────────────────────────────────────────────

/**
 * Validate a bot reply before sending it to the user.
 *
 * @param text       - Raw reply text from agent/GPT/FAQ/etc.
 * @param opts.source       - Source type: 'agent', 'faq', 'policy', 'playbook', 'gpt', 'fallback'
 * @param opts.lastBotReply - Last reply sent to this user (for repeat detection)
 *
 * @returns GuardrailResult with ok=true if safe, or issues[] and safeReply if fixable/blocked
 */
export function validateReply(
  text: string,
  opts?: { source?: string; lastBotReply?: string }
): GuardrailResult {
  // ── Empty check ────────────────────────────────────────────────────────────
  if (!text || !text.trim()) {
    return { ok: false, issues: ['empty_reply'], safeReply: null };
  }

  let working = text;
  const issues: GuardrailIssue[] = [];

  // ── Code block strip (fixable) ─────────────────────────────────────────────
  if (/```/.test(working)) {
    working = stripCodeBlocks(working);
    if (!working) return { ok: false, issues: ['code_block'], safeReply: null };
    issues.push('code_block'); // flag it but use cleaned version
  }

  // ── Internal content markers ───────────────────────────────────────────────
  for (const { pattern, issue } of INTERNAL_MARKERS) {
    if (pattern.test(working)) {
      issues.push(issue);
      // Internal content → discard, don't send
      console.warn(`[guardrails] Blocked reply — issue: ${issue}. Preview: "${working.slice(0, 120)}"`);
      return { ok: false, issues, safeReply: null };
    }
  }

  // ── Hallucination signals (flag only, don't block) ─────────────────────────
  for (const pattern of HALLUCINATION_SIGNALS) {
    if (pattern.test(working)) {
      issues.push('likely_hallucination');
      console.warn(`[guardrails] Hallucination signal in reply. Preview: "${working.slice(0, 120)}"`);
      break; // one flag is enough
    }
  }

  // ── Policy body sanity (if source=policy, content should be user-facing) ──
  if (opts?.source === 'policy') {
    // Policies with bullet rules/caps text are internal — block
    const looksPolicyInternal =
      (working.match(/^\s*[•◆▸-]\s+[A-ZÁÉÍÓÚÜÑ]{4}/gm) ?? []).length >= 3 ||
      /NUNCA|SIEMPRE QUE|OBLIGATORIO|PROHIBIDO/i.test(working);
    if (looksPolicyInternal) {
      issues.push('policy_body_too_long');
      console.warn(`[guardrails] Policy body looks internal — blocked. Preview: "${working.slice(0, 80)}"`);
      return { ok: false, issues, safeReply: null };
    }
  }

  // ── Repeat detection ───────────────────────────────────────────────────────
  if (opts?.lastBotReply && isVirtuallyIdentical(working, opts.lastBotReply)) {
    issues.push('repeated_reply');
    // Don't block — caller decides. Just flag.
    console.warn(`[guardrails] Repeated reply detected.`);
  }

  // ── Final decision ─────────────────────────────────────────────────────────
  const blockingIssues: GuardrailIssue[] = ['internal_content', 'raw_json', 'action_code_leaked', 'policy_body_too_long'];
  const hasBlocker = issues.some(i => blockingIssues.includes(i));

  if (hasBlocker) {
    return { ok: false, issues, safeReply: null };
  }

  // Code block was stripped: return cleaned version
  if (issues.includes('code_block')) {
    return { ok: false, issues, safeReply: working };
  }

  return { ok: true, issues, safeReply: working };
}

// ─── Safe Fallback Replies ────────────────────────────────────────────────────

/**
 * Varied safe fallback replies for when the guardrail blocks the primary response.
 * These are generic enough to work in any context without inventing data.
 */
const GUARDRAIL_FALLBACKS = [
  'Contame un poco más sobre lo que buscás — marca, uso o presupuesto — y te doy una respuesta concreta.',
  'Decime qué auto tenés en mente y te ayudo a filtrar bien lo que hay disponible.',
  '¿Me podés dar más detalle? Marca, modelo o presupuesto me ayudan a darte algo útil.',
];

let _fallbackIndex = 0;

/**
 * Returns a varied safe fallback reply when guardrail blocks the primary response.
 */
export function getGuardrailFallback(): string {
  const reply = GUARDRAIL_FALLBACKS[_fallbackIndex % GUARDRAIL_FALLBACKS.length];
  _fallbackIndex = (_fallbackIndex + 1) % GUARDRAIL_FALLBACKS.length;
  return reply;
}

/**
 * Convenience: apply guardrail and return the safe reply, or a fallback if blocked.
 * Never returns empty string.
 */
export function applyGuardrail(
  text: string,
  opts?: { source?: string; lastBotReply?: string; fallback?: string }
): string {
  try {
    const result = validateReply(text, opts);
    if (result.ok) return result.safeReply ?? text;
    if (result.safeReply) return result.safeReply; // cleaned version (e.g. stripped code block)
    return opts?.fallback ?? getGuardrailFallback();
  } catch {
    return opts?.fallback ?? getGuardrailFallback();
  }
}
