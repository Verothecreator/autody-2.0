create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists account_modes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  mode text not null check (mode in ('live', 'demo')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (profile_id, mode)
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  account_mode_id uuid not null references account_modes(id) on delete cascade,
  currency text not null default 'USD',
  cash_balance numeric(18, 2) not null default 0,
  reserved_cash numeric(18, 2) not null default 0,
  starting_balance numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_mode_id)
);

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id) on delete cascade,
  symbol text not null,
  asset_name text not null,
  asset_type text not null check (asset_type in ('cash', 'currency', 'crypto', 'stock', 'etf', 'commodity')),
  quantity numeric(28, 10) not null default 0,
  average_cost numeric(18, 6),
  last_price numeric(18, 6),
  value_usd numeric(18, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (wallet_id, symbol)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  account_mode_id uuid not null references account_modes(id) on delete cascade,
  symbol text not null,
  asset_type text not null,
  side text not null check (side in ('buy', 'sell', 'swap')),
  order_type text not null default 'market',
  status text not null default 'draft',
  quantity numeric(28, 10),
  notional_usd numeric(18, 2),
  limit_price numeric(18, 6),
  filled_price numeric(18, 6),
  created_at timestamptz not null default now(),
  filled_at timestamptz
);

create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  symbol text not null,
  asset_type text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, symbol)
);

create table if not exists research_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, topic)
);

create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  symbol text not null,
  asset_name text not null,
  asset_type text not null,
  price_usd numeric(18, 6),
  change_pct numeric(10, 4),
  market_cap_usd numeric(24, 2),
  captured_at timestamptz not null default now()
);

create index if not exists market_snapshots_symbol_time_idx
  on market_snapshots (symbol, captured_at desc);

create table if not exists news_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source text not null,
  subject text not null,
  title text not null,
  image_url text,
  article_url text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  unique (title, source)
);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

insert into profiles (email, display_name)
values ('ontold7@gmail.com', 'Vero Demo')
on conflict (email) do update
set display_name = excluded.display_name,
    updated_at = now();

with practice_profile as (
  select id from profiles where email = 'ontold7@gmail.com'
),
demo_mode as (
  insert into account_modes (profile_id, mode)
  select id, 'demo' from practice_profile
  on conflict (profile_id, mode) do update set status = 'active'
  returning id
),
live_mode as (
  insert into account_modes (profile_id, mode)
  select id, 'live' from practice_profile
  on conflict (profile_id, mode) do update set status = 'active'
  returning id
),
demo_wallet as (
  insert into wallets (account_mode_id, currency, cash_balance, reserved_cash, starting_balance)
  select id, 'USD', 50000, 0, 50000 from demo_mode
  on conflict (account_mode_id) do update
  set cash_balance = excluded.cash_balance,
      reserved_cash = excluded.reserved_cash,
      starting_balance = excluded.starting_balance,
      updated_at = now()
  returning id
)
insert into holdings (wallet_id, symbol, asset_name, asset_type, quantity, value_usd)
select id, 'USD', 'USD Cash', 'cash', 50000, 50000 from demo_wallet
on conflict (wallet_id, symbol) do update
set quantity = excluded.quantity,
    value_usd = excluded.value_usd,
    updated_at = now();
