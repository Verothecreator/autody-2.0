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
