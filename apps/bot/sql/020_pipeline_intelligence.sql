-- 020_pipeline_intelligence.sql
-- Pipeline logging, few-shot examples, conversation memory patterns.
-- Parte del sistema de inteligencia modular (runtimeRouter + truthGuard + exampleSelector).

-- ── bot_pipeline_logs ─────────────────────────────────────────────────────────
-- Loggea cada turno del pipeline del bot con trazabilidad completa.
-- Escrito por pipelineLogger.ts en background (no bloquea el turno).

create table if not exists bot_pipeline_logs (
  id          uuid primary key default gen_random_uuid(),
  instance    text not null,
  remote_jid  text not null,
  intent      text,               -- RouterAction del turno
  action      text,               -- RouterAction del turno
  guard_passed boolean,           -- resultado de truthGuard
  is_hot_lead  boolean,
  lead_score   int,
  reply_length int,               -- longitud de la respuesta en chars
  fast_path    text,              -- 'numeric_selection' | 'finance_followup' | etc.
  event_data   jsonb not null default '{}'::jsonb,  -- evento completo de pipeline
  created_at   timestamptz not null default now()
);

create index if not exists idx_bot_pipeline_logs_jid
  on bot_pipeline_logs(instance, remote_jid, created_at desc);

create index if not exists idx_bot_pipeline_logs_action
  on bot_pipeline_logs(action, guard_passed, created_at desc);

create index if not exists idx_bot_pipeline_logs_hot
  on bot_pipeline_logs(is_hot_lead, lead_score desc)
  where is_hot_lead = true;

-- TTL: los logs crudos se pueden limpiar después de 90 días
-- (los ejemplos promovidos quedan en bot_examples para siempre)
-- create index for cleanup: DELETE FROM bot_pipeline_logs WHERE created_at < now() - interval '90 days';

-- ── bot_examples ─────────────────────────────────────────────────────────────
-- Ejemplos few-shot aprobados por admin.
-- Leído por exampleSelector.ts en runtime para enriquecer los prompts.
-- Escrito por autoTrainer.promoteToExample() (solo admin, no en caliente).

create table if not exists bot_examples (
  id          uuid primary key default gen_random_uuid(),
  intent      text not null,        -- RouterAction (lower) o intent de GPT
  tags        text[] not null default '{}',
  input       text not null,        -- Mensaje del cliente
  output      text not null,        -- Respuesta ideal del bot
  outcome     text,                 -- 'converted' | 'continued' | 'dropped'
  score       int not null default 50,  -- 0..100
  event_data  jsonb,                -- datos del pipeline_log de origen (para trazabilidad)
  created_at  timestamptz not null default now()
);

-- Índice para exampleSelector (búsqueda por intent + tags + score)
create index if not exists idx_bot_examples_intent_score
  on bot_examples(intent, score desc)
  where outcome != 'dropped' or outcome is null;

create index if not exists idx_bot_examples_tags
  on bot_examples using gin(tags)
  where outcome != 'dropped' or outcome is null;

-- ── bot_conv_patterns ─────────────────────────────────────────────────────────
-- Memoria útil de patrones por conversación.
-- No guarda texto raw. Guarda señales estructuradas (objeciones, interés, sensibilidad).
-- Actualizado en cada turno relevante por botIntelligence.
-- Leído por objectionWorker y rankingWorker para contextualizar.

create table if not exists bot_conv_patterns (
  instance           text not null,
  remote_jid         text not null,
  objection_types    text[] not null default '{}',   -- ['PRICE_TOO_HIGH', 'NEEDS_TIME']
  successful_actions text[] not null default '{}',   -- ['SHOW_OPTIONS', 'FINANCING_FLOW']
  price_sensitivity  text not null default 'unknown', -- 'low' | 'medium' | 'high' | 'unknown'
  real_interest_score int not null default 0,         -- 0..100 (leadScore acumulado)
  financing_interest  boolean not null default false,
  trade_in_interest   boolean not null default false,
  visit_requested     boolean not null default false,
  last_objection_at   timestamptz,
  last_success_at     timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (instance, remote_jid)
);

create index if not exists idx_bot_conv_patterns_interest
  on bot_conv_patterns(real_interest_score desc, updated_at desc);
