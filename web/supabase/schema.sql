-- Run this in the Supabase SQL editor (or via `supabase db push`) once per
-- project. Idempotent-ish: safe to re-run on a fresh database.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_match_id uuid not null,
  opponent_name text,
  player_deck_archetype text,
  opponent_deck_archetype text,
  result text not null default 'unknown' check (result in ('win', 'loss', 'tie', 'unknown')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, client_match_id)
);

create table if not exists public.match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  sequence bigint not null,
  occurred_at timestamptz not null,
  kind text not null,
  raw_line text,
  payload jsonb,
  unique (match_id, sequence)
);

create index if not exists match_events_match_id_idx on public.match_events (match_id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security: every table is only readable/writable by its owner.
-- The watcher ingestion route uses the service-role key and authenticates
-- callers itself via api_tokens, so it bypasses these policies by design.

alter table public.profiles enable row level security;
alter table public.api_tokens enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

create policy "api_tokens: manage own" on public.api_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "matches: read own" on public.matches
  for select using (auth.uid() = user_id);

create policy "match_events: read via owned match" on public.match_events
  for select using (
    exists (
      select 1 from public.matches m
      where m.id = match_events.match_id and m.user_id = auth.uid()
    )
  );

-- Browser-based CLI login (like `gh auth login`): the watcher starts a
-- pairing, the user approves it in the web app, the watcher polls for the
-- resulting token. `token` briefly holds the raw token between approval and
-- the watcher's next poll, then the row is deleted — see
-- app/api/cli-auth/*.
create table if not exists public.cli_pairings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  poll_secret text not null unique,
  user_id uuid references public.profiles (id) on delete cascade,
  token text,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists cli_pairings_poll_secret_idx on public.cli_pairings (poll_secret);

-- No policies: only the service-role client (app/api/cli-auth/* routes) may
-- read or write this table.
alter table public.cli_pairings enable row level security;
