-- Migración 016: Memoria comercial persistente del lead
-- Aplicar con: psql $DATABASE_URL -f sql/016_commercial_memory.sql
--
-- Extiende bot_lead_profiles con campos comerciales que el bot debe recordar
-- entre conversaciones: etapa del funnel, objeción principal, CTA ofrecido,
-- interés en visita, vehículos ya mostrados y contador de recontactos.

-- 1. Nuevas columnas en bot_lead_profiles
alter table bot_lead_profiles
  add column if not exists funnel_stage      varchar(30),
  add column if not exists main_objection    varchar(60),
  add column if not exists last_cta_offered  text,
  add column if not exists visit_interest    boolean,
  add column if not exists shown_vehicle_ids text[],
  add column if not exists recontact_count   int default 0;

-- 2. Índice para recontactos rápidos (buscar leads tibios/calientes por fecha)
create index if not exists idx_blp_recontact
  on bot_lead_profiles(instance, lead_score, updated_at desc)
  where lead_score >= 30;

-- 3. Índice por etapa de funnel (para panel de seguimiento)
create index if not exists idx_blp_funnel_stage
  on bot_lead_profiles(instance, funnel_stage)
  where funnel_stage is not null;

-- 4. Actualizar vista hot_leads para incluir nuevos campos
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
  blp.funnel_stage,
  blp.main_objection,
  blp.last_cta_offered,
  blp.visit_interest,
  blp.shown_vehicle_ids,
  blp.recontact_count,
  blp.updated_at,
  bc.state->>'stage'                  as conv_stage,
  bc.state->'agent'->>'action'        as last_agent_action,
  bc.state->>'user_msg_count'         as msg_count
from bot_lead_profiles blp
left join bot_conversations bc
  on bc.instance = blp.instance and bc.remote_jid = blp.remote_jid
where blp.lead_score >= 30
order by blp.lead_score desc, blp.updated_at desc;

comment on view v_hot_leads is 'Leads con score >= 30, con etapa de funnel, objeción y último CTA.';

-- 5. Comentarios en columnas
comment on column bot_lead_profiles.funnel_stage     is 'Última etapa del funnel: discovery/qualification/presentation/objection/closing';
comment on column bot_lead_profiles.main_objection   is 'Principal objeción planteada por el lead (precio_alto, lo_pienso, etc.)';
comment on column bot_lead_profiles.last_cta_offered is 'Último CTA ofrecido por el bot (texto del llamado a la acción)';
comment on column bot_lead_profiles.visit_interest   is 'True si el lead mostró interés en visitar la agencia';
comment on column bot_lead_profiles.shown_vehicle_ids is 'Array de IDs de vehículos ya mostrados al lead (para no repetirlos)';
comment on column bot_lead_profiles.recontact_count  is 'Cantidad de veces que el lead volvió a escribir después de inactividad';
