-- Vehicle demand tracking + matching against public.vehicles

create table if not exists vehicle_demands (
  id bigserial primary key,
  instance text,
  remote_jid text,
  contact_name text,
  phone text,
  query text not null,
  brand text,
  model text,
  min_year int,
  max_year int,
  max_price numeric,
  currency text,
  transmission text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_demands_status on vehicle_demands(status);
create index if not exists idx_vehicle_demands_updated_at on vehicle_demands(updated_at desc);

create table if not exists vehicle_demand_matches (
  id bigserial primary key,
  demand_id bigint not null references vehicle_demands(id) on delete cascade,
  vehicle_id text not null,
  score numeric not null,
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(demand_id, vehicle_id)
);

create index if not exists idx_vehicle_demand_matches_demand on vehicle_demand_matches(demand_id, score desc);
create index if not exists idx_vehicle_demand_matches_vehicle on vehicle_demand_matches(vehicle_id);

-- updated_at maintenance
create or replace function set_updated_at_vehicle_demands() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vehicle_demands_updated_at on vehicle_demands;
create trigger trg_vehicle_demands_updated_at
before update on vehicle_demands
for each row
execute procedure set_updated_at_vehicle_demands();
