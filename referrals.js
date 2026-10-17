const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = fs.readFileSync(path.join(__dirname, 'database', 'referrals.sql'), 'utf8');
const REWARD_USD = 10;
const RESTRICTION = 'Referral rewards and the assets or proceeds funded by them can only be used within Autody. They cannot be withdrawn or sent to another account or wallet.';
function failure(status, message) {
  return Object.assign(new Error(message), { status, statusCode: status });
}
function canonicalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at), domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}
const phoneKey = value => String(value || '').replace(/\D/g, '');
const identityHash = value => crypto.createHash('sha256').update(`autody-referral-v1:${value}`).digest('hex');
const normalizeCode = value => String(value || '').trim().toUpperCase();
const cents = value => Math.round(Number(value) * 100);
function restrictedPortion(total, share, precision = 2) {
  if (!Number.isFinite(Number(total)) || !Number.isFinite(Number(share)) || total < 0 || share < 0 || share > 1) throw failure(400, 'Invalid reward allocation.');
  const scale = 10 ** precision;
  // Round restrictions up, so repeated tiny trades cannot release reward value.
  return Math.max(0, Math.min(Number(total), Math.ceil(Number(total) * Number(share) * scale - 1e-7) / scale));
}
async function ensureSchema(client) { await client.query(schema); }
async function eligibleCode(client, code) {
  const result = await client.query(`
    select c.profile_id, p.email, pv.phone
    from referral_codes c join profiles p on p.id=c.profile_id
    join profile_verifications pv on pv.profile_id=p.id and pv.email_status='verified'
    join account_modes am on am.profile_id=p.id and am.mode='live' and am.status='active'
    where c.code=$1`, [normalizeCode(code)]);
  return result.rows[0] || null;
}
async function codeForProfile(client, profileId) {
  const eligible = await client.query(`select 1 from profile_verifications pv
    join account_modes am on am.profile_id=pv.profile_id and am.mode='live' and am.status='active'
    where pv.profile_id=$1 and pv.email_status='verified'`, [profileId]);
  if (!eligible.rows.length) throw failure(403, 'Verify your email and keep your account in good standing to invite friends.');
  const result = await client.query(`insert into referral_codes(profile_id,code) values($1,$2)
    on conflict(profile_id) do update set profile_id=excluded.profile_id returning code`,
  [profileId, crypto.randomBytes(10).toString('hex').toUpperCase()]);
  return result.rows[0].code;
}
async function attach(client, profileId, code, email, phone) {
  if (!code) return;
  const inviter = await eligibleCode(client, code);
  if (!inviter) throw failure(400, 'This referral link is unavailable. Remove the referral to continue without a reward.');
  if (inviter.profile_id === profileId || canonicalEmail(inviter.email) === canonicalEmail(email) || phoneKey(inviter.phone) === phoneKey(phone)) {
    throw failure(400, 'You cannot refer yourself or use another account with your own email or phone number.');
  }
  try {
    await client.query(`insert into referrals(inviter_profile_id,invitee_profile_id,invitee_email_hash,invitee_phone_hash,referral_code)
      values($1,$2,$3,$4,$5)`, [inviter.profile_id,profileId,identityHash(canonicalEmail(email)),identityHash(phoneKey(phone)),normalizeCode(code)]);
  } catch (err) {
    if (err.code === '23505') throw failure(409, 'This email or phone number has already participated in a referral. Each new member may receive one welcome reward.');
    throw err;
  }
}
async function syncUsdHolding(client, walletId) {
  await client.query(`insert into holdings(wallet_id,symbol,asset_name,asset_type,quantity,average_cost,last_price,value_usd)
    select id,'USD','USD Funds','cash',cash_balance,1,1,cash_balance from wallets where id=$1
    on conflict(wallet_id,symbol) do update set quantity=excluded.quantity,value_usd=excluded.value_usd,updated_at=now()`, [walletId]);
}
async function settleOne(pool, referralId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select r.* from referrals r
      join profile_verifications vi on vi.profile_id=r.invitee_profile_id and vi.email_status='verified'
      join profile_verifications vr on vr.profile_id=r.inviter_profile_id and vr.email_status='verified'
      join account_modes ai on ai.profile_id=r.invitee_profile_id and ai.mode='live' and ai.status='active'
      join account_modes ar on ar.profile_id=r.inviter_profile_id and ar.mode='live' and ar.status='active'
      where r.id=$1 and r.status='pending' for update of r`, [referralId]);
    const referral = result.rows[0];
    if (!referral) { await client.query('commit'); return false; }
    const wallets = await client.query(`select w.id,am.profile_id from wallets w join account_modes am on am.id=w.account_mode_id
      where am.mode='live' and am.profile_id=any($1::uuid[]) order by w.id for update of w`, [[referral.inviter_profile_id, referral.invitee_profile_id]]);
    if (wallets.rows.length !== 2) throw failure(503, 'Referral wallets are not ready. Please try again.');
    for (const wallet of wallets.rows) {
      const role = wallet.profile_id === referral.inviter_profile_id ? 'inviter' : 'invitee';
      const award = await client.query(`insert into referral_rewards(referral_id,profile_id,role) values($1,$2,$3)
        on conflict(referral_id,role) do nothing returning id`, [referral.id,wallet.profile_id,role]);
      if (!award.rows.length) throw failure(409, 'Referral reward requires review.');
      await client.query(`update wallets set cash_balance=cash_balance+10,promotional_cash=promotional_cash+10,updated_at=now() where id=$1`, [wallet.id]);
      await syncUsdHolding(client, wallet.id);
    }
    await client.query(`update referrals set status='rewarded',rewarded_at=now() where id=$1`, [referral.id]);
    await client.query('commit');
    return true;
  } catch (err) { await client.query('rollback').catch(()=>{}); throw err; }
  finally { client.release(); }
}
async function settleForProfile(pool, profileId) {
  const rows = await pool.query(`select r.id from referrals r
    join profile_verifications vi on vi.profile_id=r.invitee_profile_id and vi.email_status='verified'
    join profile_verifications vr on vr.profile_id=r.inviter_profile_id and vr.email_status='verified'
    join account_modes ai on ai.profile_id=r.invitee_profile_id and ai.mode='live' and ai.status='active'
    join account_modes ar on ar.profile_id=r.inviter_profile_id and ar.mode='live' and ar.status='active'
    where r.status='pending' and (r.invitee_profile_id=$1 or r.inviter_profile_id=$1) order by r.created_at limit 100`, [profileId]);
  for (const row of rows.rows) await settleOne(pool, row.id);
}
async function summary(pool, profileId, baseUrl) {
  const code = await codeForProfile(pool, profileId);
  await settleForProfile(pool, profileId);
  const stats = await pool.query(`select count(*)::int as invited,
    count(*) filter(where status='pending')::int as pending,
    count(*) filter(where status='rewarded')::int as rewarded from referrals where inviter_profile_id=$1`, [profileId]);
  const rewards = await pool.query(`select id,role,amount_usd,created_at from referral_rewards where profile_id=$1 order by created_at desc limit 50`, [profileId]);
  const total = await pool.query(`select coalesce(sum(amount_usd),0) as amount from referral_rewards where profile_id=$1`, [profileId]);
  const wallet = await pool.query(`select w.promotional_cash from wallets w join account_modes am on am.id=w.account_mode_id where am.profile_id=$1 and am.mode='live'`, [profileId]);
  return { code, link:`${baseUrl.replace(/\/$/,'')}/sign-up?ref=${encodeURIComponent(code)}`, rewardUsd:REWARD_USD,
    ...stats.rows[0], totalEarned:Number(total.rows[0].amount), promotionalCash:Number(wallet.rows[0]?.promotional_cash||0),
    rewards:rewards.rows.map(r=>({id:r.id,role:r.role,amountUsd:Number(r.amount_usd),createdAt:r.created_at})), restriction:RESTRICTION };
}
async function spendCash(client, walletId, cost) {
  const amount = cents(cost)/100;
  if (!(amount > 0)) throw failure(400, 'Enter a valid order amount.');
  const result = await client.query('select cash_balance,reserved_cash,promotional_cash from wallets where id=$1 for update', [walletId]);
  const wallet = result.rows[0];
  if (!wallet || cents(wallet.cash_balance)-cents(wallet.reserved_cash)<cents(amount)) throw failure(400, 'Not enough USD available for this order.');
  const used = Math.min(cents(wallet.promotional_cash),cents(amount))/100;
  await client.query('update wallets set promotional_cash=promotional_cash-$2 where id=$1', [walletId,used]);
  return used/amount;
}
async function addHoldingRestriction(client, walletId, symbol, quantity, share) {
  const restricted = restrictedPortion(quantity, share, 10);
  if (restricted > 0) await client.query(`update holdings set promotional_quantity=least(quantity,promotional_quantity+$3::numeric)
    where wallet_id=$1 and upper(symbol)=upper($2)`, [walletId,symbol,restricted]);
}
async function takeHoldingRestriction(client, walletId, symbol, quantity) {
  quantity = Number(Number(quantity).toFixed(10));
  const result = await client.query('select quantity,promotional_quantity from holdings where wallet_id=$1 and upper(symbol)=upper($2) for update', [walletId,symbol]);
  const holding = result.rows[0];
  const total = Number(holding?.quantity||0), promotional = Number(holding?.promotional_quantity||0);
  if (!(quantity > 0) || quantity > total) throw failure(400, `Not enough ${symbol} available for this order.`);
  const restricted = Math.min(promotional, restrictedPortion(quantity, total > 0 ? promotional/total : 0, 10));
  if (restricted > 0) await client.query('update holdings set promotional_quantity=greatest(0,promotional_quantity-$3::numeric) where wallet_id=$1 and upper(symbol)=upper($2)', [walletId,symbol,restricted]);
  return Math.min(1, restricted/quantity);
}
async function creditSaleRestriction(client, walletId, proceeds, share) {
  const restricted = restrictedPortion(cents(proceeds)/100, share);
  if (restricted > 0) await client.query('update wallets set promotional_cash=promotional_cash+$2,updated_at=now() where id=$1', [walletId,restricted]);
}
async function assertWithdrawable(client, walletId, symbol, amount) {
  const usd = symbol === 'USD';
  if (usd && Math.abs(Number(amount)*100-Math.round(Number(amount)*100))>1e-7) throw failure(400, 'USD transfers must use whole cents.');
  const result = usd
    ? await client.query(`select greatest(cash_balance-reserved_cash-promotional_cash,0) as available,
        $2::numeric>0 and $2::numeric<=greatest(cash_balance-reserved_cash-promotional_cash,0) as allowed from wallets where id=$1 for update`, [walletId,amount])
    : await client.query(`select greatest(quantity-promotional_quantity,0) as available,
        $3::numeric>0 and $3::numeric<=greatest(quantity-promotional_quantity,0) as allowed from holdings where wallet_id=$1 and upper(symbol)=upper($2) for update`, [walletId,symbol,amount]);
  if (!result.rows[0]?.allowed) throw failure(403, `${RESTRICTION} Available from your own funds: ${Number(result.rows[0]?.available||0)} ${symbol}.`);
}
module.exports = { REWARD_USD, RESTRICTION, ensureSchema, canonicalEmail, normalizeCode, restrictedPortion,
  eligibleCode, codeForProfile, attach, settleForProfile, settleOne, summary, spendCash,
  addHoldingRestriction, takeHoldingRestriction, creditSaleRestriction, assertWithdrawable };
