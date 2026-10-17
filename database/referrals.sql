alter table wallets add column if not exists promotional_cash numeric(18,2) not null default 0
  check (promotional_cash >= 0 and promotional_cash <= greatest(cash_balance, 0));
alter table holdings add column if not exists promotional_quantity numeric(28,10) not null default 0
  check (promotional_quantity >= 0 and promotional_quantity <= greatest(quantity, 0));

create table if not exists referral_codes (
  profile_id uuid primary key references profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_profile_id uuid references profiles(id) on delete set null,
  invitee_profile_id uuid unique references profiles(id) on delete set null,
  invitee_email_hash text not null unique,
  invitee_phone_hash text not null unique,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'disqualified')),
  reward_usd numeric(18,2) not null default 10 check (reward_usd = 10),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (inviter_profile_id is null or invitee_profile_id is null or inviter_profile_id <> invitee_profile_id)
);
create index if not exists referrals_inviter_idx on referrals(inviter_profile_id, created_at desc);
create table if not exists referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references referrals(id),
  profile_id uuid references profiles(id) on delete set null,
  role text not null check (role in ('inviter', 'invitee')),
  amount_usd numeric(18,2) not null default 10 check (amount_usd = 10),
  created_at timestamptz not null default now(),
  unique (referral_id, role)
);
create index if not exists referral_rewards_profile_idx on referral_rewards(profile_id, created_at desc);
alter table referral_codes enable row level security;
alter table referrals enable row level security;
alter table referral_rewards enable row level security;

alter table referral_rewards add column if not exists released_at timestamptz;
alter table referral_rewards add column if not exists legacy_group boolean not null default false;
alter table wallets add column if not exists referral_lots_initialized boolean not null default false;
alter table app_sessions add column if not exists is_support boolean not null default false;
do $$ begin
  if to_regclass('public.admin_account_events') is not null then
    update app_sessions s set is_support=true from admin_account_events e
    where e.profile_id=s.profile_id and e.action='impersonate'
      and e.created_at between s.created_at-interval '10 seconds' and s.created_at+interval '10 seconds';
  end if;
end $$;

-- Each reward keeps its own restricted funds through purchases, sales and swaps.
-- The legacy origin protects any older restricted balance without an award ledger.
create table if not exists referral_reward_lots (
  wallet_id uuid not null references wallets(id) on delete cascade,
  origin text not null,
  reward_id uuid references referral_rewards(id),
  symbol text not null,
  quantity numeric(28,10) not null check(quantity >= 0),
  primary key(wallet_id, origin, symbol),
  check((reward_id is null and origin='legacy') or (reward_id is not null and origin=reward_id::text))
);
create index if not exists referral_reward_lots_reward_idx on referral_reward_lots(reward_id);

create table if not exists referral_qualifying_trades (
  order_id uuid primary key references orders(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  own_funded_usd numeric(18,2) not null check(own_funded_usd > 0),
  created_at timestamptz not null default now()
);
create index if not exists referral_qualifying_trades_profile_idx on referral_qualifying_trades(profile_id);
-- Only pre-reward historical trades have a provably non-reward funding source.
insert into referral_qualifying_trades(order_id,profile_id,own_funded_usd,created_at)
select o.id,am.profile_id,o.notional_usd,coalesce(o.filled_at,o.created_at)
from orders o join account_modes am on am.id=o.account_mode_id and am.mode='live'
where lower(o.side) in ('buy','sell','swap') and lower(o.status)='filled' and o.notional_usd>=0.01
  and coalesce(o.filled_at,o.created_at)<coalesce(
    (select min(r.created_at) from referral_rewards r where r.profile_id=am.profile_id),'infinity'::timestamptz)
on conflict(order_id) do nothing;

create table if not exists referral_signals (
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null check(kind in ('email','phone','device','signup_ip','document')),
  signal_hash text not null,
  created_at timestamptz not null default now(),
  primary key(profile_id,kind,signal_hash)
);
create index if not exists referral_signals_match_idx on referral_signals(kind,signal_hash,created_at);
-- Match older members too, using the same canonical keys as the signup guard.
insert into referral_signals(profile_id,kind,signal_hash)
select p.id,'email',encode(sha256(convert_to('autody-referral-v1:' || case
  when split_part(lower(trim(p.email)),'@',2) in ('gmail.com','googlemail.com')
    then replace(split_part(split_part(lower(trim(p.email)),'@',1),'+',1),'.','') || '@gmail.com'
  else lower(trim(p.email)) end,'UTF8')),'hex') from profiles p on conflict do nothing;
insert into referral_signals(profile_id,kind,signal_hash)
select pv.profile_id,'phone',encode(sha256(convert_to('autody-referral-v1:' || regexp_replace(pv.phone,'[^0-9]','','g'),'UTF8')),'hex')
from profile_verifications pv where regexp_replace(pv.phone,'[^0-9]','','g')<>'' on conflict do nothing;
create table if not exists referral_risk_controls (
  profile_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'review' check(status in ('clear','review','blocked')),
  reasons text[] not null default '{}',
  manual_override boolean not null default false,
  review_note text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists referral_risk_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  action text not null,
  reasons text[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table referral_reward_lots enable row level security;
alter table referral_qualifying_trades enable row level security;
alter table referral_signals enable row level security;
alter table referral_risk_controls enable row level security;
alter table referral_risk_audit enable row level security;
