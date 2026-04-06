-- Migración 017: Datos comerciales calculados por turno (Fase 4 — Capa Comercial Inteligente)
-- Aplicada automáticamente por migrate() al iniciar el bot.
--
-- Guarda el resultado del pipeline comercial por conversación:
-- score, temperatura, intención, próximo paso, prioridad y sugerencias.
-- Los registros se actualizan en cada turno (UPSERT por conversation_id).
-- score_history guarda la evolución para análisis de progresión.

create table if not exists lead_commercial_data (
  id                     serial primary key,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Identificación de conversación
  conversation_id        varchar(255) not null,
  instance_name          varchar(255),
  remote_jid             varchar(255),

  -- Scoring
  lead_score             integer not null default 0,
  lead_temperature       varchar(10) not null default 'cold',
  score_reason           text,
  score_confidence       decimal(3,2),

  -- Intención clasificada
  primary_intent         varchar(50),
  secondary_intent       varchar(50),
  intent_confidence      decimal(3,2),
  intent_evidence        text,

  -- Señales detectadas (array de SignalType)
  sales_signals          jsonb,

  -- Próximo mejor paso
  next_best_action       varchar(50),
  next_action_reason     text,
  next_action_priority   integer,
  next_action_for_human  boolean not null default false,
  next_action_for_bot    boolean not null default true,
  next_suggested_message text,

  -- Prioridad de conversación
  commercial_priority    integer not null default 1,
  priority_label         varchar(20),
  priority_reason        text,
  should_notify_human    boolean not null default false,
  estimated_value_signal varchar(10),

  -- Sugerencias al vendedor
  suggested_action       text,
  suggested_reply_strategy text,
  human_handoff_reason   text,
  suggestion_urgency     varchar(20),
  script_hint            text,

  -- Historial de scores (últimos N turnos)
  score_history          jsonb default '[]'::jsonb,
  last_scored_at         timestamptz
);

-- Restricción única: una fila por conversación (UPSERT por conversation_id)
create unique index if not exists idx_lcd_conversation_unique
  on lead_commercial_data(conversation_id);

-- Índices operativos
create index if not exists idx_lcd_temperature
  on lead_commercial_data(lead_temperature);

create index if not exists idx_lcd_priority
  on lead_commercial_data(commercial_priority desc);

create index if not exists idx_lcd_notify
  on lead_commercial_data(should_notify_human)
  where should_notify_human = true;

create index if not exists idx_lcd_instance
  on lead_commercial_data(instance_name);

create index if not exists idx_lcd_updated
  on lead_commercial_data(updated_at desc);

-- Trigger para updated_at automático
create or replace function update_lcd_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lcd_updated_at on lead_commercial_data;

create trigger trg_lcd_updated_at
  before update on lead_commercial_data
  for each row execute function update_lcd_updated_at();
