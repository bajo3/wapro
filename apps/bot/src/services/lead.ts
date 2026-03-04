import type { ConvState } from './state.js';

/**
 * Simple, deterministic lead temperature scoring (offline).
 * Returns an integer score in [0, 100].
 */
export function computeLeadScore(state: ConvState, extracted: Record<string, any>, nowMs: number): number {
  const msgCount = Math.max(0, Number(state.user_msg_count ?? 0));
  const lastUserAt = state.last_user_at ? Date.parse(state.last_user_at) : NaN;

  // Depth: how much structured info we have.
  const fields = [
    extracted?.brand,
    extracted?.model,
    extracted?.minYear,
    extracted?.maxYear,
    extracted?.year,
    extracted?.amount,
    extracted?.currency,
    extracted?.transmission,
    extracted?.fuel,
    extracted?.bodywork,
    extracted?.city,
    extracted?.hasTradeIn,
    extracted?.cuotas,
    extracted?.percent
  ];
  const depth = fields.filter((v) => v !== undefined && v !== null && String(v).trim() !== '').length;

  let score = 0;

  // Message volume (max 20 points)
  score += Math.min(20, msgCount * 2);

  // Structured depth (max 45 points)
  score += Math.min(45, depth * 5);

  // Intent signals
  const hasFinancing = !!extracted?.cuotas || !!extracted?.percent;
  const hasTradeIn = extracted?.hasTradeIn === true || !!extracted?.tradeInModel;
  if (hasFinancing) score += 12;
  if (hasTradeIn) score += 10;

  // Recency: if user replied quickly recently, add up to 13 points.
  if (!Number.isNaN(lastUserAt)) {
    const delta = Math.max(0, nowMs - lastUserAt);
    if (delta <= 2 * 60 * 1000) score += 13;
    else if (delta <= 10 * 60 * 1000) score += 8;
    else if (delta <= 30 * 60 * 1000) score += 4;
  }

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));
  return score;
}

export function leadLabel(score: number): 'CALIENTE' | 'TIBIO' | 'FRIO' {
  if (score >= 70) return 'CALIENTE';
  if (score >= 40) return 'TIBIO';
  return 'FRIO';
}
