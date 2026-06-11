create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_credentials (
  profile_id uuid primary key references profiles(id) on delete cascade,
  password_algorithm text not null default 'scrypt',
  password_salt text not null,
  password_hash text not null,
  password_updated_at timestamptz not null default now()
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

create table if not exists demo_performance (
  account_mode_id uuid primary key references account_modes(id) on delete cascade,
  portfolio_value numeric(18, 2) not null default 50000,
  starting_balance numeric(18, 2) not null default 50000,
  unrealized_profit_loss numeric(18, 2) not null default 0,
  realized_profit_loss numeric(18, 2) not null default 0,
  today_profit_loss numeric(18, 2) not null default 0,
  today_profit_loss_pct numeric(10, 4) not null default 0,
  win_rate_pct numeric(10, 4) not null default 0,
  trades_placed integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists account_settings (
  profile_id uuid primary key references profiles(id) on delete cascade,
  default_mode text not null default 'demo',
  currency text not null default 'USD',
  risk_level text not null default 'practice',
  order_confirmation boolean not null default true,
  market_alerts boolean not null default true,
  news_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into profiles (email, display_name)
values ('ontold7@gmail.com', 'Vero Demo')
on conflict (email) do update
set display_name = excluded.display_name,
    updated_at = now();

insert into profile_credentials (profile_id, password_algorithm, password_salt, password_hash)
select id,
       'scrypt',
       'e347422aa66d3ca056c6a13fc341e4c8',
       '7809fccd8f63f1516a811717074eef89debc3a4f834b21ca822dfdf035b6f8988b2e4c221814c87faa02b5609a03a428fc5b01cba3cb22bf98cfbe572392a06e'
from profiles
where email = 'ontold7@gmail.com'
on conflict (profile_id) do update
set password_algorithm = excluded.password_algorithm,
    password_salt = excluded.password_salt,
    password_hash = excluded.password_hash,
    password_updated_at = now();

insert into account_settings (profile_id, default_mode, currency, risk_level, order_confirmation, market_alerts, news_alerts)
select id, 'demo', 'USD', 'practice', true, true, true
from profiles
where email = 'ontold7@gmail.com'
on conflict (profile_id) do update
set default_mode = excluded.default_mode,
    currency = excluded.currency,
    risk_level = excluded.risk_level,
    order_confirmation = excluded.order_confirmation,
    market_alerts = excluded.market_alerts,
    news_alerts = excluded.news_alerts,
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
select id, symbol, asset_name, asset_type, quantity, value_usd
from demo_wallet
cross join (
  values
    ('USD', 'USD Cash', 'cash', 50000::numeric, 50000::numeric),
    ('AU', 'Autody AU', 'currency', 0::numeric, 0::numeric),
    ('CRYPTO', 'Crypto', 'crypto', 0::numeric, 0::numeric),
    ('STOCKS', 'Stocks', 'stock', 0::numeric, 0::numeric)
) as seed_holdings(symbol, asset_name, asset_type, quantity, value_usd)
on conflict (wallet_id, symbol) do update
set quantity = excluded.quantity,
    value_usd = excluded.value_usd,
    updated_at = now();

with practice_profile as (
  select id from profiles where email = 'ontold7@gmail.com'
)
insert into watchlists (profile_id, symbol, asset_type)
select id, symbol, asset_type
from practice_profile
cross join (
  values
    ('BTC', 'crypto'),
    ('ETH', 'crypto'),
    ('SOL', 'crypto'),
    ('DOGE', 'crypto'),
    ('ADA', 'crypto'),
    ('AU', 'currency'),
    ('SPY', 'etf'),
    ('QQQ', 'etf'),
    ('AAPL', 'stock'),
    ('NVDA', 'stock'),
    ('TSLA', 'stock'),
    ('MSFT', 'stock')
) as seed_watchlist(symbol, asset_type)
on conflict (profile_id, symbol) do nothing;

with practice_profile as (
  select id from profiles where email = 'ontold7@gmail.com'
)
insert into research_preferences (profile_id, topic)
select id, topic
from practice_profile
cross join (
  values
    ('Crypto'),
    ('Stocks'),
    ('Gold'),
    ('Rates'),
    ('Inflation'),
    ('AU utility')
) as seed_topics(topic)
on conflict (profile_id, topic) do nothing;

with demo_mode as (
  select am.id
  from account_modes am
  join profiles p on p.id = am.profile_id
  where p.email = 'ontold7@gmail.com'
    and am.mode = 'demo'
)
insert into demo_performance (account_mode_id, portfolio_value, starting_balance)
select id, 50000, 50000 from demo_mode
on conflict (account_mode_id) do update
set portfolio_value = excluded.portfolio_value,
    starting_balance = excluded.starting_balance,
    updated_at = now();
