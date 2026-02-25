-- Vehicle demands v2: notify + recontact fields, anti-spam helpers, and recontact history

-- Extend vehicle_demands
alter table if exists vehicle_demands
  add column if not exists notify_on_match boolean not null default true;

alter table if exists vehicle_demands
  add column if not exists notify_min_score numeric not null default 0.72;

alter table if exists vehicle_demands
  add column if not exists notify_cooldown_min int not null default 240;

alter table if exists vehicle_demands
  add column if not exists last_notified_at timestamptz;

alter table if exists vehicle_demands
  add column if not exists match_template text;

alter table if exists vehicle_demands
  add column if not exists recontact_enabled boolean not null default false;

alter table if exists vehicle_demands
  add column if not exists recontact_every_days int not null default 7;

alter table if exists vehicle_demands
  add column if not exists recontact_next_at timestamptz;

alter table if exists vehicle_demands
  add column if not exists recontact_count int not null default 0;

-- Default max recontacts is now 3 (can be overridden per demand)
alter table if exists vehicle_demands
  add column if not exists recontact_max int not null default 3;

alter table if exists vehicle_demands
  add column if not exists recontact_template text;

-- Extend vehicle_demand_matches
alter table if exists vehicle_demand_matches
  add column if not exists reasons jsonb not null default '{}'::jsonb;

-- Backward-compat: if the old column name exists, copy into reasons once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_demand_matches' AND column_name = 'reason'
  ) THEN
    -- NOTE: do NOT use nested $$ dollar-quoting inside this DO block.
    EXECUTE 'update vehicle_demand_matches '
      || 'set reasons = coalesce(reasons, ''{}''::jsonb) || coalesce(reason, ''{}''::jsonb) '
      || 'where reason is not null';
  END IF;
END $$;

alter table if exists vehicle_demand_matches
  add column if not exists notified_at timestamptz;

alter table if exists vehicle_demand_matches
  add column if not exists last_shared_at timestamptz;

create index if not exists idx_vehicle_demand_matches_notified on vehicle_demand_matches(demand_id, notified_at);

-- Recontact history for UI + metrics
create table if not exists vehicle_demand_recontacts (
  id bigserial primary key,
  demand_id bigint not null references vehicle_demands(id) on delete cascade,
  attempt int not null,
  message text not null,
  match_vehicle_ids jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists idx_vehicle_demand_recontacts_demand on vehicle_demand_recontacts(demand_id, sent_at desc);
