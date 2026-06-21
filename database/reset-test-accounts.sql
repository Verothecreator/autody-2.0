begin;

delete from holdings
where wallet_id in (
  select w.id
  from wallets w
  join account_modes am on am.id = w.account_mode_id
  join profiles p on p.id = am.profile_id
  where lower(p.email) <> lower('ontold7@gmail.com')
);

delete from demo_performance
where account_mode_id in (
  select am.id
  from account_modes am
  join profiles p on p.id = am.profile_id
  where lower(p.email) <> lower('ontold7@gmail.com')
);

delete from orders
where account_mode_id in (
  select am.id
  from account_modes am
  join profiles p on p.id = am.profile_id
  where lower(p.email) <> lower('ontold7@gmail.com')
);

delete from wallets
where account_mode_id in (
  select am.id
  from account_modes am
  join profiles p on p.id = am.profile_id
  where lower(p.email) <> lower('ontold7@gmail.com')
);

delete from account_modes
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from app_sessions
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from verification_codes
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from watchlists
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from research_preferences
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from account_settings
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from profile_credentials
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from profile_verifications
where profile_id in (
  select id from profiles where lower(email) <> lower('ontold7@gmail.com')
);

delete from profiles
where lower(email) <> lower('ontold7@gmail.com');

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
where lower(email) = lower('ontold7@gmail.com')
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

create unique index if not exists profile_verifications_phone_unique_idx
  on profile_verifications (phone);

commit;
