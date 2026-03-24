import type { ConvState } from './state.js';

/**
 * Simple, deterministic lead temperature scoring (offline).
 * Returns an integer score in [0, 100].
 */
export type LeadScoreBreakdown = {
  total: number;
  label: 'CALIENTE' | 'TIBIO' | 'FRIO';
  factors: {
    profileDepth: number;
    urgency: number;
    buyingIntent: number;
    responsiveness: number;
    financingIntent: number;
    tradeInIntent: number;
    repeatInterest: number;
    budgetDefined: number;
  };
};

export function computeLeadScoreBreakdown(state: ConvState, extracted: Record<string, any>, nowMs: number): LeadScoreBreakdown { 
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

  const text = String(state.last_query || '').toLowerCase();
  const hasFinancing = !!extracted?.cuotas || !!extracted?.percent;
  const hasTradeIn = extracted?.hasTradeIn === true || !!extracted?.tradeInModel;
  const hasBudget = !!(extracted?.maxPrice || extracted?.amount);
  const hasUrgencyWords = /(reserv|seña|transfer|hoy|ya|visita|test drive|probar|cierro|cerramos|contado)/i.test(text);
  const hasBuyingIntentWords = /(precio|cuanto|vale|disponible|mostrame|busco|quiero|financio|permuta|usado|0km)/i.test(text);

  const factors = {
    profileDepth: Math.min(35, depth * 4),
    urgency: hasUrgencyWords ? 16 : 0,
    buyingIntent: hasBuyingIntentWords ? 16 : Math.min(12, msgCount * 2),
    responsiveness: 0,
    financingIntent: hasFinancing ? 12 : 0,
    tradeInIntent: hasTradeIn ? 10 : 0,
    repeatInterest: Math.min(11, Math.max(0, msgCount - 1) * 2),
    budgetDefined: hasBudget ? 8 : 0  // tener presupuesto definido = señal de compra real
  };

  if (!Number.isNaN(lastUserAt)) {
    const delta = Math.max(0, nowMs - lastUserAt);
    if (delta <= 2 * 60 * 1000) factors.responsiveness = 13;
    else if (delta <= 10 * 60 * 1000) factors.responsiveness = 8;
    else if (delta <= 30 * 60 * 1000) factors.responsiveness = 4;
  }

  let score = Object.values(factors).reduce((a, b) => a + b, 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { total: score, label: leadLabel(score), factors };
}

export function computeLeadScore(state: ConvState, extracted: Record<string, any>, nowMs: number): number {
  return computeLeadScoreBreakdown(state, extracted, nowMs).total;
}

export function leadLabel(score: number): 'CALIENTE' | 'TIBIO' | 'FRIO' {
  if (score >= 70) return 'CALIENTE';
  if (score >= 40) return 'TIBIO';
  return 'FRIO';
}
