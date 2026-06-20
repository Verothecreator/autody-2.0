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

update profile_verifications
set email_status = 'verified',
    updated_at = now()
where profile_id in (
  select id from profiles where lower(email) = lower('ontold7@gmail.com')
);

create unique index if not exists profile_verifications_phone_unique_idx
  on profile_verifications (phone);

commit;
