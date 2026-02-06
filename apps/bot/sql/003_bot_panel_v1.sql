-- v1 Bot Panel additions: Policies + Test Suite

create table if not exists bot_policies (
  id bigserial primary key,
  title text,
  triggers text[] not null default '{}'::text[],
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_policies_enabled on bot_policies(enabled);

create table if not exists bot_test_cases (
  id bigserial primary key,
  name text not null,
  user_text text not null,
  expected_intent text,
  expected_source_type text,
  expected_source_id bigint,
  expected_contains text[] not null default '{}'::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_test_cases_enabled on bot_test_cases(enabled);
