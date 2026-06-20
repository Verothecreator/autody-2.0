begin;

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
