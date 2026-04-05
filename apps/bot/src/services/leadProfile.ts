import { pool } from './db.js';
import type { AgentDecision } from './agent.js';

// Re-export lead memory functions for convenience
export {
  loadLeadMemory,
  mergeMemoryIntoExtracted,
  buildMemorySummaryBlock,
  isRecontact,
  extractShownVehicleIdsFromHistory,
  mergeShownVehicleIds,
  extractCtaFromReply,
  detectVisitInterest,
} from './leadMemory.js';
export type { LeadMemory } from './leadMemory.js';

// Re-export topic change + brand-model validator from extract.ts
export { detectTopicChange, clearVehicleContext, sanitizeBrandModel } from './extract.js';

export async function upsertLeadProfile(input: {
  instance: string;
  remoteJid: string;
  extracted?: Record<string, any>;
  leadScore?: number;
  leadLabel?: string;
  decision?: AgentDecision | null;
  lastSummary?: string | null;
  // v016: memoria comercial extendida
  funnelStage?: string | null;
  mainObjection?: string | null;
  lastCtaOffered?: string | null;
  visitInterest?: boolean | null;
  shownVehicleIds?: string[] | null;
  incrementRecontact?: boolean;
}) {
  try {
    const e = input.extracted || {};
    // v016: columnas de memoria comercial (add column if not exists en migración)
    await pool.query(
      `insert into bot_lead_profiles (
        instance, remote_jid, preferred_brand, preferred_model,
        budget_max, budget_amount, currency, preferred_year_min, preferred_year_max, year_exact,
        transmission, fuel, bodywork, has_trade_in,
        financing_interest, lead_score, lead_temperature,
        last_agent_summary, last_intent, use_case, city, color,
        funnel_stage, main_objection, last_cta_offered, visit_interest, shown_vehicle_ids,
        updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
        $23,$24,$25,$26,$27,
        now()
      )
      on conflict (instance, remote_jid)
      do update set
        preferred_brand     = coalesce(excluded.preferred_brand,     bot_lead_profiles.preferred_brand),
        preferred_model     = coalesce(excluded.preferred_model,     bot_lead_profiles.preferred_model),
        budget_max          = coalesce(excluded.budget_max,          bot_lead_profiles.budget_max),
        budget_amount       = coalesce(excluded.budget_amount,       bot_lead_profiles.budget_amount),
        currency            = coalesce(excluded.currency,            bot_lead_profiles.currency),
        preferred_year_min  = coalesce(excluded.preferred_year_min,  bot_lead_profiles.preferred_year_min),
        preferred_year_max  = coalesce(excluded.preferred_year_max,  bot_lead_profiles.preferred_year_max),
        year_exact          = coalesce(excluded.year_exact,          bot_lead_profiles.year_exact),
        transmission        = coalesce(excluded.transmission,        bot_lead_profiles.transmission),
        fuel                = coalesce(excluded.fuel,                bot_lead_profiles.fuel),
        bodywork            = coalesce(excluded.bodywork,            bot_lead_profiles.bodywork),
        has_trade_in        = coalesce(excluded.has_trade_in,        bot_lead_profiles.has_trade_in),
        financing_interest  = coalesce(excluded.financing_interest,  bot_lead_profiles.financing_interest),
        lead_score          = coalesce(excluded.lead_score,          bot_lead_profiles.lead_score),
        lead_temperature    = coalesce(excluded.lead_temperature,    bot_lead_profiles.lead_temperature),
        last_agent_summary  = coalesce(excluded.last_agent_summary,  bot_lead_profiles.last_agent_summary),
        last_intent         = coalesce(excluded.last_intent,         bot_lead_profiles.last_intent),
        use_case            = coalesce(excluded.use_case,            bot_lead_profiles.use_case),
        city                = coalesce(excluded.city,                bot_lead_profiles.city),
        color               = coalesce(excluded.color,               bot_lead_profiles.color),
        funnel_stage        = coalesce(excluded.funnel_stage,        bot_lead_profiles.funnel_stage),
        main_objection      = coalesce(excluded.main_objection,      bot_lead_profiles.main_objection),
        last_cta_offered    = coalesce(excluded.last_cta_offered,    bot_lead_profiles.last_cta_offered),
        visit_interest      = coalesce(excluded.visit_interest,      bot_lead_profiles.visit_interest),
        shown_vehicle_ids   = case
          when excluded.shown_vehicle_ids is not null
          then (
            select array(
              select distinct unnest(
                coalesce(bot_lead_profiles.shown_vehicle_ids, '{}') ||
                coalesce(excluded.shown_vehicle_ids, '{}')
              )
            )
          )
          else bot_lead_profiles.shown_vehicle_ids
        end,
        recontact_count     = case
          when $28 then coalesce(bot_lead_profiles.recontact_count, 0) + 1
          else bot_lead_profiles.recontact_count
        end,
        updated_at          = now()`,
      [
        input.instance,
        input.remoteJid,
        e.brand ?? null,
        e.model ?? null,
        e.maxPrice ?? null,
        e.amount ?? null,
        e.currency ?? null,
        e.minYear ?? null,
        e.maxYear ?? null,
        e.year ?? null,
        e.transmission ?? null,
        e.fuel ?? null,
        e.bodywork ?? null,
        typeof e.hasTradeIn === 'boolean' ? e.hasTradeIn : null,
        Boolean(e.cuotas || e.percent || e.wantsFinancing),
        Number.isFinite(Number(input.leadScore)) ? Number(input.leadScore) : null,
        input.leadLabel ?? null,
        input.lastSummary ?? input.decision?.suggestedReply ?? null,
        input.decision?.intent ?? null,
        e.useCase ?? null,
        e.city ?? null,
        e.color ?? null,
        // v016 commercial memory fields
        input.funnelStage ?? null,
        input.mainObjection ?? null,
        input.lastCtaOffered ?? null,
        input.visitInterest ?? null,
        input.shownVehicleIds?.length ? input.shownVehicleIds : null,
        // recontact increment flag ($28)
        Boolean(input.incrementRecontact),
      ]
    );
  } catch (err) {
    console.error('[leadProfile] upsert failed:', err);
  }
}
