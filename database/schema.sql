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

create table if not exists profile_verifications (
  profile_id uuid primary key references profiles(id) on delete cascade,
  first_name text,
  last_name text,
  legal_name text not null,
  phone text not null,
  country text not null,
  date_of_birth date not null,
  account_type text not null default 'personal',
  email_status text not null default 'pending',
  phone_status text not null default 'pending',
  identity_status text not null default 'pending',
  risk_status text not null default 'pending',
  terms_version text not null default '2026-06-17',
  terms_accepted_at timestamptz,
  information_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists profile_verifications
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists terms_version text not null default '2026-06-17',
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists information_confirmed_at timestamptz;

create index if not exists profile_verifications_phone_idx
  on profile_verifications (phone);

create table if not exists verification_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'phone')),
  destination text not null,
  purpose text not null default 'sign_up',
  code_salt text not null,
  code_hash text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz
);

create index if not exists verification_codes_profile_status_idx
  on verification_codes (profile_id, channel, status, created_at desc);

create index if not exists verification_codes_profile_purpose_status_idx
  on verification_codes (profile_id, channel, purpose, status, created_at desc);

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
  mode text not null default 'demo' check (mode in ('demo', 'live')),
  created_at timestamptz not null default now(),
  unique (profile_id, symbol, mode)
);

alter table watchlists
add column if not exists mode text not null default 'demo';

alter table watchlists
drop constraint if exists watchlists_profile_id_symbol_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'watchlists_mode_check'
      and conrelid = 'watchlists'::regclass
  ) then
    alter table watchlists
    add constraint watchlists_mode_check check (mode in ('demo', 'live'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'watchlists_profile_id_symbol_mode_key'
      and conrelid = 'watchlists'::regclass
  ) then
    alter table watchlists
    add constraint watchlists_profile_id_symbol_mode_key unique (profile_id, symbol, mode);
  end if;
end $$;

create table if not exists research_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, topic)
);

drop table if exists market_snapshots;

create table if not exists market_latest_snapshots (
  symbol text primary key,
  provider text not null,
  asset_name text not null,
  asset_type text not null,
  provider_symbol text,
  market text,
  price_usd numeric(24, 10),
  change_pct numeric(12, 6),
  market_cap_usd numeric(24, 2),
  fdv_usd numeric(24, 2),
  liquidity_usd numeric(24, 2),
  total_volume_usd numeric(24, 2),
  high_24h numeric(24, 10),
  low_24h numeric(24, 10),
  ath numeric(24, 10),
  atl numeric(24, 10),
  circulating_supply numeric(32, 8),
  total_supply numeric(32, 8),
  max_supply numeric(32, 8),
  currency text not null default 'USD',
  logo_url text,
  deposit_networks jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists market_latest_snapshots_type_time_idx
  on market_latest_snapshots (asset_type, captured_at desc);

drop table if exists market_chart_snapshots;

create table if not exists market_latest_chart_snapshots (
  symbol text not null,
  range_key text not null check (range_key in ('1d', '1w', '1m', '3m', '1y', 'all')),
  provider text not null,
  asset_type text not null,
  provider_symbol text,
  currency text not null default 'USD',
  points jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  primary key (symbol, range_key)
);

create table if not exists asset_catalog (
  symbol text primary key,
  asset_name text not null,
  asset_type text not null,
  provider_symbol text,
  coingecko_id text,
  market text not null default 'Global',
  region text not null default 'Global',
  currency text not null default 'USD',
  deposit_networks jsonb not null default '[]'::jsonb,
  display_rank integer not null,
  tags text[] not null default '{}',
  is_tradeable boolean not null default true,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table if exists asset_catalog
  add column if not exists market text not null default 'Global',
  add column if not exists region text not null default 'Global',
  add column if not exists currency text not null default 'USD',
  add column if not exists deposit_networks jsonb not null default '[]'::jsonb;

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

insert into profile_verifications (
  profile_id, first_name, last_name, legal_name, phone, country, date_of_birth, account_type,
  email_status, phone_status, identity_status, risk_status, terms_version, terms_accepted_at,
  information_confirmed_at
)
select id,
       'Adrian',
       'Cole',
       'Adrian Cole',
       '+15550190777',
       'United States',
       '1994-08-16',
       'personal',
       'verified',
       'not_required',
       'pending',
       'standard',
       '2026-06-17',
       now(),
       now()
from profiles
where email = 'ontold7@gmail.com'
on conflict (profile_id) do update
set first_name = excluded.first_name,
    last_name = excluded.last_name,
    legal_name = excluded.legal_name,
    phone = excluded.phone,
    country = excluded.country,
    date_of_birth = excluded.date_of_birth,
    account_type = excluded.account_type,
    email_status = 'verified',
    phone_status = excluded.phone_status,
    identity_status = excluded.identity_status,
    risk_status = excluded.risk_status,
    terms_version = excluded.terms_version,
    terms_accepted_at = coalesce(profile_verifications.terms_accepted_at, excluded.terms_accepted_at),
    information_confirmed_at = coalesce(profile_verifications.information_confirmed_at, excluded.information_confirmed_at),
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

insert into asset_catalog (symbol, asset_name, asset_type, provider_symbol, coingecko_id, market, region, currency, deposit_networks, display_rank, tags, is_tradeable, is_active)
values
  ('BTC', 'Bitcoin', 'crypto', 'BTC-USD', 'bitcoin', 'Crypto', 'Global', 'USD', to_jsonb(array['Bitcoin']), 1, array['Blue chip','Store of value'], true, true),
  ('ETH', 'Ethereum', 'crypto', 'ETH-USD', 'ethereum', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum']), 2, array['Smart contracts','DeFi'], true, true),
  ('USDT', 'Tether USDt', 'crypto', 'USDT-USD', 'tether', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Tron TRC-20','BNB Smart Chain BEP-20','Polygon PoS','Solana SPL','Arbitrum One','Optimism','Avalanche C-Chain']), 3, array['Stablecoin','Payments'], true, true),
  ('USDC', 'USD Coin', 'crypto', 'USDC-USD', 'usd-coin', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Base','Solana SPL','Polygon PoS','Arbitrum One','Optimism','Avalanche C-Chain','Stellar']), 4, array['Stablecoin','Payments'], true, true),
  ('SOL', 'Solana', 'crypto', 'SOL-USD', 'solana', 'Crypto', 'Global', 'USD', to_jsonb(array['Solana']), 5, array['High demand','Apps'], true, true),
  ('XRP', 'XRP', 'crypto', 'XRP-USD', 'ripple', 'Crypto', 'Global', 'USD', to_jsonb(array['XRP Ledger']), 6, array['Payments'], true, true),
  ('BNB', 'BNB', 'crypto', 'BNB-USD', 'binancecoin', 'Crypto', 'Global', 'USD', to_jsonb(array['BNB Smart Chain BEP-20','BNB Beacon Chain']), 7, array['Large cap'], true, true),
  ('DOGE', 'Dogecoin', 'crypto', 'DOGE-USD', 'dogecoin', 'Crypto', 'Global', 'USD', to_jsonb(array['Dogecoin']), 8, array['Popular'], true, true),
  ('ADA', 'Cardano', 'crypto', 'ADA-USD', 'cardano', 'Crypto', 'Global', 'USD', to_jsonb(array['Cardano']), 9, array['Smart contracts'], true, true),
  ('AVAX', 'Avalanche', 'crypto', 'AVAX-USD', 'avalanche-2', 'Crypto', 'Global', 'USD', to_jsonb(array['Avalanche C-Chain']), 10, array['Layer 1'], true, true),
  ('LINK', 'Chainlink', 'crypto', 'LINK-USD', 'chainlink', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Polygon PoS','Arbitrum One']), 11, array['Data oracles'], true, true),
  ('LTC', 'Litecoin', 'crypto', 'LTC-USD', 'litecoin', 'Crypto', 'Global', 'USD', to_jsonb(array['Litecoin']), 12, array['Payments'], true, true),
  ('DOT', 'Polkadot', 'crypto', 'DOT-USD', 'polkadot', 'Crypto', 'Global', 'USD', to_jsonb(array['Polkadot']), 13, array['Interoperability'], true, true),
  ('BCH', 'Bitcoin Cash', 'crypto', 'BCH-USD', 'bitcoin-cash', 'Crypto', 'Global', 'USD', to_jsonb(array['Bitcoin Cash']), 14, array['Payments'], true, true),
  ('XLM', 'Stellar', 'crypto', 'XLM-USD', 'stellar', 'Crypto', 'Global', 'USD', to_jsonb(array['Stellar']), 15, array['Payments'], true, true),
  ('TRX', 'TRON', 'crypto', 'TRX-USD', 'tron', 'Crypto', 'Global', 'USD', to_jsonb(array['Tron TRC-20']), 16, array['Payments'], true, true),
  ('TON', 'Toncoin', 'crypto', 'TON11419-USD', 'the-open-network', 'Crypto', 'Global', 'USD', to_jsonb(array['TON']), 17, array['Messaging','Layer 1'], true, true),
  ('SUI', 'Sui', 'crypto', 'SUI-USD', 'sui', 'Crypto', 'Global', 'USD', to_jsonb(array['Sui']), 18, array['Layer 1'], true, true),
  ('HBAR', 'Hedera', 'crypto', 'HBAR-USD', 'hedera-hashgraph', 'Crypto', 'Global', 'USD', to_jsonb(array['Hedera']), 19, array['Enterprise'], true, true),
  ('SHIB', 'Shiba Inu', 'crypto', 'SHIB-USD', 'shiba-inu', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Shibarium']), 20, array['Popular'], true, true),
  ('POL', 'Polygon', 'crypto', 'POL-USD', 'polygon-ecosystem-token', 'Crypto', 'Global', 'USD', to_jsonb(array['Polygon PoS','Ethereum ERC-20']), 21, array['Scaling'], true, true),
  ('UNI', 'Uniswap', 'crypto', 'UNI-USD', 'uniswap', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Arbitrum One','Polygon PoS']), 22, array['DeFi'], true, true),
  ('AAVE', 'Aave', 'crypto', 'AAVE-USD', 'aave', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Polygon PoS','Arbitrum One']), 23, array['DeFi','Lending'], true, true),
  ('ATOM', 'Cosmos', 'crypto', 'ATOM-USD', 'cosmos', 'Crypto', 'Global', 'USD', to_jsonb(array['Cosmos']), 24, array['Interoperability'], true, true),
  ('NEAR', 'NEAR Protocol', 'crypto', 'NEAR-USD', 'near', 'Crypto', 'Global', 'USD', to_jsonb(array['NEAR']), 25, array['Layer 1'], true, true),
  ('APT', 'Aptos', 'crypto', 'APT-USD', 'aptos', 'Crypto', 'Global', 'USD', to_jsonb(array['Aptos']), 26, array['Layer 1'], true, true),
  ('ARB', 'Arbitrum', 'crypto', 'ARB-USD', 'arbitrum', 'Crypto', 'Global', 'USD', to_jsonb(array['Arbitrum One']), 27, array['Scaling'], true, true),
  ('OP', 'Optimism', 'crypto', 'OP-USD', 'optimism', 'Crypto', 'Global', 'USD', to_jsonb(array['Optimism']), 28, array['Scaling'], true, true),
  ('INJ', 'Injective', 'crypto', 'INJ-USD', 'injective-protocol', 'Crypto', 'Global', 'USD', to_jsonb(array['Injective','Ethereum ERC-20']), 29, array['DeFi'], true, true),
  ('ICP', 'Internet Computer', 'crypto', 'ICP-USD', 'internet-computer', 'Crypto', 'Global', 'USD', to_jsonb(array['Internet Computer']), 30, array['Compute'], true, true),
  ('FIL', 'Filecoin', 'crypto', 'FIL-USD', 'filecoin', 'Crypto', 'Global', 'USD', to_jsonb(array['Filecoin']), 31, array['Storage'], true, true),
  ('ETC', 'Ethereum Classic', 'crypto', 'ETC-USD', 'ethereum-classic', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum Classic']), 32, array['Proof of work'], true, true),
  ('VET', 'VeChain', 'crypto', 'VET-USD', 'vechain', 'Crypto', 'Global', 'USD', to_jsonb(array['VeChain']), 33, array['Supply chain'], true, true),
  ('ALGO', 'Algorand', 'crypto', 'ALGO-USD', 'algorand', 'Crypto', 'Global', 'USD', to_jsonb(array['Algorand']), 34, array['Layer 1'], true, true),
  ('XMR', 'Monero', 'crypto', 'XMR-USD', 'monero', 'Crypto', 'Global', 'USD', to_jsonb(array['Monero']), 35, array['Privacy'], true, true),
  ('FET', 'Artificial Superintelligence Alliance', 'crypto', 'FET-USD', 'fetch-ai', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Cosmos']), 36, array['AI'], true, true),
  ('RENDER', 'Render', 'crypto', 'RENDER-USD', 'render-token', 'Crypto', 'Global', 'USD', to_jsonb(array['Solana SPL','Ethereum ERC-20']), 37, array['AI','Compute'], true, true),
  ('PEPE', 'Pepe', 'crypto', 'PEPE-USD', 'pepe', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20']), 38, array['Popular'], true, true),
  ('BONK', 'Bonk', 'crypto', 'BONK-USD', 'bonk', 'Crypto', 'Global', 'USD', to_jsonb(array['Solana SPL']), 39, array['Popular'], true, true),
  ('WIF', 'dogwifhat', 'crypto', 'WIF-USD', 'dogwifcoin', 'Crypto', 'Global', 'USD', to_jsonb(array['Solana SPL']), 40, array['Popular'], true, true),
  ('DAI', 'Dai', 'crypto', 'DAI-USD', 'dai', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Polygon PoS','Arbitrum One','Optimism']), 41, array['Stablecoin','DeFi'], true, true),
  ('PYUSD', 'PayPal USD', 'crypto', 'PYUSD-USD', 'paypal-usd', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Solana SPL']), 42, array['Stablecoin','Payments'], true, true),
  ('FDUSD', 'First Digital USD', 'crypto', 'FDUSD-USD', 'first-digital-usd', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','BNB Smart Chain BEP-20']), 43, array['Stablecoin'], true, true),
  ('TUSD', 'TrueUSD', 'crypto', 'TUSD-USD', 'true-usd', 'Stablecoin', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','BNB Smart Chain BEP-20','Tron TRC-20']), 44, array['Stablecoin'], true, true),
  ('MKR', 'Maker', 'crypto', 'MKR-USD', 'maker', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20']), 45, array['DeFi'], true, true),
  ('LDO', 'Lido DAO', 'crypto', 'LDO-USD', 'lido-dao', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Arbitrum One']), 46, array['Staking'], true, true),
  ('QNT', 'Quant', 'crypto', 'QNT-USD', 'quant-network', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20']), 47, array['Interoperability'], true, true),
  ('GRT', 'The Graph', 'crypto', 'GRT-USD', 'the-graph', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Arbitrum One']), 48, array['Data'], true, true),
  ('CRV', 'Curve DAO', 'crypto', 'CRV-USD', 'curve-dao-token', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Arbitrum One']), 49, array['DeFi'], true, true),
  ('MANA', 'Decentraland', 'crypto', 'MANA-USD', 'decentraland', 'Crypto', 'Global', 'USD', to_jsonb(array['Ethereum ERC-20','Polygon PoS']), 50, array['Gaming'], true, true),
  ('SPY', 'SPDR S&P 500 ETF', 'etf', 'SPY', null, 'NYSE Arca', 'US', 'USD', to_jsonb(array[]::text[]), 1, array['S&P 500','ETF'], true, true),
  ('QQQ', 'Invesco QQQ Trust', 'etf', 'QQQ', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 2, array['Nasdaq 100','ETF'], true, true),
  ('VOO', 'Vanguard S&P 500 ETF', 'etf', 'VOO', null, 'NYSE Arca', 'US', 'USD', to_jsonb(array[]::text[]), 3, array['S&P 500','ETF'], true, true),
  ('VT', 'Vanguard Total World Stock ETF', 'etf', 'VT', null, 'NYSE Arca', 'Global', 'USD', to_jsonb(array[]::text[]), 4, array['World equity','ETF'], true, true),
  ('DIA', 'SPDR Dow Jones ETF', 'etf', 'DIA', null, 'NYSE Arca', 'US', 'USD', to_jsonb(array[]::text[]), 5, array['Dow','ETF'], true, true),
  ('IWM', 'iShares Russell 2000 ETF', 'etf', 'IWM', null, 'NYSE Arca', 'US', 'USD', to_jsonb(array[]::text[]), 6, array['Small caps','ETF'], true, true),
  ('GLD', 'SPDR Gold Shares', 'etf', 'GLD', null, 'NYSE Arca', 'Commodity', 'USD', to_jsonb(array[]::text[]), 7, array['Gold','Commodity ETF'], true, true),
  ('SLV', 'iShares Silver Trust', 'etf', 'SLV', null, 'NYSE Arca', 'Commodity', 'USD', to_jsonb(array[]::text[]), 8, array['Silver','Commodity ETF'], true, true),
  ('USO', 'United States Oil Fund', 'etf', 'USO', null, 'NYSE Arca', 'Commodity', 'USD', to_jsonb(array[]::text[]), 9, array['Oil','WTI'], true, true),
  ('BNO', 'United States Brent Oil Fund', 'etf', 'BNO', null, 'NYSE Arca', 'Commodity', 'USD', to_jsonb(array[]::text[]), 10, array['Oil','Brent'], true, true),
  ('UNG', 'United States Natural Gas Fund', 'etf', 'UNG', null, 'NYSE Arca', 'Commodity', 'USD', to_jsonb(array[]::text[]), 11, array['Natural gas','Energy'], true, true),
  ('NVDA', 'NVIDIA', 'stock', 'NVDA', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 12, array['AI','Semiconductors'], true, true),
  ('AAPL', 'Apple', 'stock', 'AAPL', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 13, array['Mega cap','Consumer tech'], true, true),
  ('MSFT', 'Microsoft', 'stock', 'MSFT', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 14, array['AI','Cloud'], true, true),
  ('TSLA', 'Tesla', 'stock', 'TSLA', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 15, array['EV','High demand'], true, true),
  ('AMZN', 'Amazon', 'stock', 'AMZN', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 16, array['Cloud','Consumer'], true, true),
  ('GOOGL', 'Alphabet', 'stock', 'GOOGL', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 17, array['AI','Search'], true, true),
  ('META', 'Meta Platforms', 'stock', 'META', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 18, array['AI','Social'], true, true),
  ('AMD', 'AMD', 'stock', 'AMD', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 19, array['Semiconductors'], true, true),
  ('AVGO', 'Broadcom', 'stock', 'AVGO', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 20, array['Semiconductors'], true, true),
  ('NFLX', 'Netflix', 'stock', 'NFLX', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 21, array['Streaming'], true, true),
  ('PLTR', 'Palantir', 'stock', 'PLTR', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 22, array['AI','Data'], true, true),
  ('COIN', 'Coinbase Global', 'stock', 'COIN', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 23, array['Crypto equity'], true, true),
  ('MSTR', 'Strategy', 'stock', 'MSTR', null, 'Nasdaq', 'US', 'USD', to_jsonb(array[]::text[]), 24, array['Bitcoin equity'], true, true),
  ('JPM', 'JPMorgan Chase', 'stock', 'JPM', null, 'NYSE', 'US', 'USD', to_jsonb(array[]::text[]), 25, array['Banking'], true, true),
  ('V', 'Visa', 'stock', 'V', null, 'NYSE', 'US', 'USD', to_jsonb(array[]::text[]), 26, array['Payments'], true, true),
  ('XOM', 'Exxon Mobil', 'stock', 'XOM', null, 'NYSE', 'US', 'USD', to_jsonb(array[]::text[]), 27, array['Oil','Energy'], true, true),
  ('CVX', 'Chevron', 'stock', 'CVX', null, 'NYSE', 'US', 'USD', to_jsonb(array[]::text[]), 28, array['Oil','Energy'], true, true),
  ('SHEL', 'Shell ADR', 'stock', 'SHEL', null, 'NYSE', 'UK', 'USD', to_jsonb(array[]::text[]), 29, array['Oil','Energy'], true, true),
  ('BP', 'BP ADR', 'stock', 'BP', null, 'NYSE', 'UK', 'USD', to_jsonb(array[]::text[]), 30, array['Oil','Energy'], true, true),
  ('TSM', 'Taiwan Semiconductor', 'stock', 'TSM', null, 'NYSE', 'Taiwan', 'USD', to_jsonb(array[]::text[]), 31, array['Semiconductors'], true, true),
  ('ASML', 'ASML Holding', 'stock', 'ASML', null, 'Nasdaq', 'Netherlands', 'USD', to_jsonb(array[]::text[]), 32, array['Semiconductors'], true, true),
  ('NVO', 'Novo Nordisk ADR', 'stock', 'NVO', null, 'NYSE', 'Denmark', 'USD', to_jsonb(array[]::text[]), 33, array['Healthcare'], true, true),
  ('BABA', 'Alibaba ADR', 'stock', 'BABA', null, 'NYSE', 'China', 'USD', to_jsonb(array[]::text[]), 34, array['Ecommerce','China'], true, true),
  ('TM', 'Toyota Motor ADR', 'stock', 'TM', null, 'NYSE', 'Japan', 'USD', to_jsonb(array[]::text[]), 35, array['Autos'], true, true),
  ('SONY', 'Sony Group ADR', 'stock', 'SONY', null, 'NYSE', 'Japan', 'USD', to_jsonb(array[]::text[]), 36, array['Consumer tech','Entertainment'], true, true),
  ('SHOP', 'Shopify', 'stock', 'SHOP', null, 'NYSE', 'Canada', 'USD', to_jsonb(array[]::text[]), 37, array['Ecommerce'], true, true),
  ('MELI', 'MercadoLibre', 'stock', 'MELI', null, 'Nasdaq', 'Latin America', 'USD', to_jsonb(array[]::text[]), 38, array['Ecommerce','Fintech'], true, true),
  ('RIO', 'Rio Tinto ADR', 'stock', 'RIO', null, 'NYSE', 'UK/Australia', 'USD', to_jsonb(array[]::text[]), 39, array['Mining','Materials'], true, true),
  ('BHP', 'BHP Group ADR', 'stock', 'BHP', null, 'NYSE', 'Australia', 'USD', to_jsonb(array[]::text[]), 40, array['Mining','Materials'], true, true),
  ('HSBC', 'HSBC Holdings ADR', 'stock', 'HSBC', null, 'NYSE', 'UK/Hong Kong', 'USD', to_jsonb(array[]::text[]), 41, array['Banking'], true, true),
  ('SAP', 'SAP ADR', 'stock', 'SAP', null, 'NYSE', 'Germany', 'USD', to_jsonb(array[]::text[]), 42, array['Software'], true, true),
  ('RELIANCE.NS', 'Reliance Industries', 'stock', 'RELIANCE.NS', null, 'NSE India', 'India', 'INR', to_jsonb(array[]::text[]), 43, array['Energy','Conglomerate'], true, true),
  ('INFY.NS', 'Infosys', 'stock', 'INFY.NS', null, 'NSE India', 'India', 'INR', to_jsonb(array[]::text[]), 44, array['Technology'], true, true),
  ('0700.HK', 'Tencent Holdings', 'stock', '0700.HK', null, 'Hong Kong', 'China', 'HKD', to_jsonb(array[]::text[]), 45, array['Internet','Gaming'], true, true),
  ('9988.HK', 'Alibaba Hong Kong', 'stock', '9988.HK', null, 'Hong Kong', 'China', 'HKD', to_jsonb(array[]::text[]), 46, array['Ecommerce','China'], true, true),
  ('7203.T', 'Toyota Motor', 'stock', '7203.T', null, 'Tokyo', 'Japan', 'JPY', to_jsonb(array[]::text[]), 47, array['Autos'], true, true),
  ('005930.KS', 'Samsung Electronics', 'stock', '005930.KS', null, 'Korea Exchange', 'South Korea', 'KRW', to_jsonb(array[]::text[]), 48, array['Semiconductors','Consumer tech'], true, true),
  ('MC.PA', 'LVMH', 'stock', 'MC.PA', null, 'Euronext Paris', 'France', 'EUR', to_jsonb(array[]::text[]), 49, array['Luxury','Consumer'], true, true),
  ('NESN.SW', 'Nestle', 'stock', 'NESN.SW', null, 'SIX Swiss', 'Switzerland', 'CHF', to_jsonb(array[]::text[]), 50, array['Consumer staples'], true, true)
on conflict (symbol) do update
set asset_name = excluded.asset_name,
    asset_type = excluded.asset_type,
    provider_symbol = excluded.provider_symbol,
    coingecko_id = excluded.coingecko_id,
    market = excluded.market,
    region = excluded.region,
    currency = excluded.currency,
    deposit_networks = excluded.deposit_networks,
    display_rank = excluded.display_rank,
    tags = excluded.tags,
    is_tradeable = excluded.is_tradeable,
    is_active = excluded.is_active,
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
demo_wallet_insert as (
  insert into wallets (account_mode_id, currency, cash_balance, reserved_cash, starting_balance)
  select id, 'USD', 50000, 0, 50000 from demo_mode
  on conflict (account_mode_id) do nothing
  returning id
),
demo_wallet as (
  select id from demo_wallet_insert
  union all
  select w.id
  from wallets w
  join demo_mode dm on dm.id = w.account_mode_id
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
on conflict (wallet_id, symbol) do nothing;

with practice_profile as (
  select id from profiles where email = 'ontold7@gmail.com'
)
insert into watchlists (profile_id, symbol, asset_type, mode)
select id, symbol, asset_type, 'demo'
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
on conflict (profile_id, symbol, mode) do nothing;

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
on conflict (account_mode_id) do nothing;
