create table if not exists bot_lead_profiles (
  id bigserial primary key,
  instance text not null,
  remote_jid text not null,
  name text,
  phone text,
  preferred_brand text,
  preferred_model text,
  budget_max numeric,
  currency text,
  preferred_year_min int,
  preferred_year_max int,
  transmission text,
  fuel text,
  bodywork text,
  has_trade_in boolean,
  financing_interest boolean,
  lead_score int,
  lead_temperature text,
  last_agent_summary text,
  last_intent text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(instance, remote_jid)
);

create index if not exists idx_bot_lead_profiles_score on bot_lead_profiles(instance, lead_score desc);
create index if not exists idx_bot_lead_profiles_updated on bot_lead_profiles(updated_at desc);
