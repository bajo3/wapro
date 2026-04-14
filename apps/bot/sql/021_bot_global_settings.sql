-- Bot global key-value settings (persists across restarts)
create table if not exists bot_global_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Seed default: bot starts ON unless explicitly turned off
insert into bot_global_settings(key, value)
values ('bot_reply_mode', 'on')
on conflict (key) do nothing;
