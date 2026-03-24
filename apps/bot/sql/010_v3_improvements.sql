-- Migración v3: mejoras de inteligencia
-- Aplicar con: psql $DATABASE_URL -f sql/010_v3_improvements.sql

-- 1. Agregar budget_amount para distinguir monto mencionado vs techo explícito
alter table bot_lead_profiles
  add column if not exists budget_amount numeric,
  add column if not exists use_case text,
  add column if not exists city text,
  add column if not exists color text,
  add column if not exists year_exact int;

-- 2. Agregar campo budget_defined_score al panel de decisiones para debug
alter table bot_decisions
  add column if not exists lead_score_breakdown jsonb;

-- 3. Índice por ciudad para consultas del panel
create index if not exists idx_bot_lead_profiles_city on bot_lead_profiles(instance, city)
  where city is not null;

-- 4. Vista útil para el panel de operadores: leads con mayor score + contexto
create or replace view v_hot_leads as
select
  blp.instance,
  blp.remote_jid,
  blp.preferred_brand,
  blp.preferred_model,
  blp.budget_max,
  blp.budget_amount,
  blp.currency,
  blp.use_case,
  blp.city,
  blp.lead_score,
  blp.lead_temperature,
  blp.last_intent,
  blp.updated_at,
  bc.state->>'stage' as conv_stage,
  bc.state->'agent'->>'action' as last_agent_action,
  bc.state->>'user_msg_count' as msg_count
from bot_lead_profiles blp
left join bot_conversations bc
  on bc.instance = blp.instance and bc.remote_jid = blp.remote_jid
where blp.lead_score >= 40
order by blp.lead_score desc, blp.updated_at desc;

comment on view v_hot_leads is 'Leads TIBIOS y CALIENTES con contexto completo. Útil para seguimiento del panel.';
