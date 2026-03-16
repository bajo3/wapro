-- v2 Bot Panel upgrades: drafts, richer playbooks, episodes, audit, A/B variants, stronger tests

-- Draft support (safe changes before publishing)
alter table if exists bot_policies add column if not exists draft boolean not null default false;
alter table if exists bot_faq add column if not exists draft boolean not null default false;
alter table if exists bot_playbooks add column if not exists draft boolean not null default false;

-- Playbook config (required fields, variants, actions, etc.)
alter table if exists bot_playbooks add column if not exists config jsonb not null default '{}'::jsonb;

-- A/B variants table (optional overrides per intent/playbook)
create table if not exists bot_ab_variants (
  id bigserial primary key,
  scope text not null, -- 'intent' | 'playbook'
  scope_key text not null, -- intent name or playbook id
  variant text not null,
  weight numeric not null default 0.5,
  template_override text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(scope, scope_key, variant)
);

create index if not exists idx_bot_ab_variants_scope on bot_ab_variants(scope, scope_key);
create index if not exists idx_bot_ab_variants_enabled on bot_ab_variants(enabled);

-- Episodes: store simulations + real replies, ratings and feedback for iterative improvement
create table if not exists bot_episodes (
  id bigserial primary key,
  instance text,
  remote_jid text,
  channel text not null default 'whatsapp',
  user_text text not null,
  reply_text text not null,
  intent text,
  variant text,
  sources jsonb not null default '[]'::jsonb,
  extracted jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  rating int,
  feedback text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_episodes_created_at on bot_episodes(created_at desc);
create index if not exists idx_bot_episodes_intent on bot_episodes(intent);

-- Audit log for admin changes (who changed what and when)
create table if not exists bot_audit_log (
  id bigserial primary key,
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_audit_log_created_at on bot_audit_log(created_at desc);

-- Stronger tests
alter table if exists bot_test_cases add column if not exists expected_not_contains text[] not null default '{}'::text[];
alter table if exists bot_test_cases add column if not exists expected_regex text;
alter table if exists bot_test_cases add column if not exists expected_must_ask_fields text[] not null default '{}'::text[];

create index if not exists idx_bot_test_cases_created_at on bot_test_cases(created_at desc);
