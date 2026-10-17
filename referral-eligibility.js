const MIN_DEPOSIT_USD = 1000;
const MIN_TRADES = 3;
const HOLD_DAYS = 90;

// Keep allocations exact at the database's precision, including tiny asset units.
function atoms(value, precision) {
  const text = typeof value === 'number' ? value.toFixed(precision) : String(value);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole || '0') * 10n ** BigInt(precision) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision));
}
function decimal(value, precision) {
  const text = value.toString().padStart(precision + 1, '0');
  return `${text.slice(0, -precision)}.${text.slice(-precision)}`;
}
function allocation(total, lots, precision) {
  const target = atoms(total, precision);
  const weights = lots.map(lot => atoms(lot.quantity, 10));
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (target === 0n) return [];
  if (!sum) throw new Error('Referral reward allocation is missing.');
  const shares = weights.map(weight => target * weight / sum);
  shares[0] += target - shares.reduce((a, b) => a + b, 0n);
  return lots.map((lot, i) => ({ ...lot, quantity: decimal(shares[i], precision) })).filter(lot => atoms(lot.quantity, precision) > 0n);
}
async function addLots(client, walletId, symbol, quantity, sources) {
  for (const lot of allocation(quantity, sources, symbol === 'USD' ? 2 : 10)) {
    await client.query(`insert into referral_reward_lots(wallet_id,origin,reward_id,symbol,quantity) values($1,$2,$3,$4,$5)
      on conflict(wallet_id,origin,symbol) do update set quantity=referral_reward_lots.quantity+excluded.quantity`,
    [walletId, lot.origin, lot.rewardId || null, symbol, lot.quantity]);
  }
}
async function ensureLots(client, walletId) {
  const { rows: [wallet] } = await client.query('select * from wallets where id=$1 for update', [walletId]);
  if (!wallet || wallet.referral_lots_initialized) return;
  const rewards = await client.query(`select r.id from referral_rewards r join account_modes am on am.profile_id=r.profile_id
    where am.id=$1 and r.released_at is null order by r.created_at,r.id`, [wallet.account_mode_id]);
  // Old balances were pooled without per-invitation provenance. Release that
  // pool only when every old invitation qualifies; never guess its ownership.
  const sources = [{ origin:'legacy', rewardId:null, quantity:'1' }];
  if (rewards.rows.length) await client.query('update referral_rewards set legacy_group=true where id=any($1::uuid[])', [rewards.rows.map(r=>r.id)]);
  await addLots(client, walletId, 'USD', wallet.promotional_cash, sources);
  const holdings = await client.query("select symbol,promotional_quantity from holdings where wallet_id=$1 and upper(symbol)<>'USD' and promotional_quantity>0", [walletId]);
  for (const h of holdings.rows) await addLots(client, walletId, h.symbol, h.promotional_quantity, sources);
  await client.query('update wallets set referral_lots_initialized=true where id=$1', [walletId]);
}
async function takeLots(client, walletId, symbol, quantity) {
  await ensureLots(client, walletId);
  const precision = symbol === 'USD' ? 2 : 10;
  let remaining = atoms(quantity, precision);
  const result = await client.query(`select origin,reward_id,quantity from referral_reward_lots
    where wallet_id=$1 and symbol=$2 and quantity>0 order by origin for update`, [walletId, symbol]);
  const consumed = [];
  for (const lot of result.rows) {
    if (!remaining) break;
    const available = atoms(lot.quantity, precision);
    const used = available < remaining ? available : remaining;
    if (!used) continue;
    await client.query('update referral_reward_lots set quantity=quantity-$4 where wallet_id=$1 and origin=$2 and symbol=$3',
      [walletId,lot.origin,symbol,decimal(used,precision)]);
    consumed.push({ origin:lot.origin, rewardId:lot.reward_id, quantity:decimal(used,precision) });
    remaining -= used;
  }
  if (remaining) throw new Error('Referral reward balances require reconciliation.');
  return consumed;
}
async function recordSignal(client, profileId, kind, hash) {
  if (!hash) return;
  await client.query(`insert into referral_signals(profile_id,kind,signal_hash) values($1,$2,$3) on conflict do nothing`, [profileId,kind,hash]);
}
async function riskReasons(client, profileId) {
  const duplicates = await client.query(`select distinct s.kind from referral_signals s join referral_signals other
    on other.kind=s.kind and other.signal_hash=s.signal_hash and other.profile_id<>s.profile_id
    where s.profile_id=$1 and s.kind in ('email','phone','device','document')`, [profileId]);
  const reasons = duplicates.rows.map(r => `shared_${r.kind}`);
  const burst = await client.query(`select 1 from referral_signals s join referral_signals other
    on other.kind=s.kind and other.signal_hash=s.signal_hash
    where s.profile_id=$1 and s.kind='signup_ip' and other.created_at>now()-interval '1 hour'
    group by s.signal_hash having count(distinct other.profile_id)>=6`, [profileId]);
  if (burst.rows.length) reasons.push('signup_velocity');
  const invites = await client.query("select count(*)::int as n from referrals where inviter_profile_id=$1 and created_at>now()-interval '24 hours'", [profileId]);
  if (invites.rows[0].n >= 20) reasons.push('invitation_velocity');
  const trades = await client.query(`select 1 from referral_qualifying_trades where profile_id=$1 and created_at>now()-interval '1 minute' having count(*)>=10`, [profileId]);
  if (trades.rows.length) reasons.push('trade_velocity');
  return [...new Set(reasons)].sort();
}
async function riskStatus(client, profileId) {
  const { rows: [control] } = await client.query('select * from referral_risk_controls where profile_id=$1', [profileId]);
  if (control?.status === 'blocked') return 'blocked';
  if (control?.manual_override && control.status==='clear') {
    return (await riskReasons(client,profileId)).some(reason=>!control.reasons.includes(reason)) ? 'review' : 'clear';
  }
  if (control?.status === 'review') return 'review';
  return (await riskReasons(client, profileId)).length ? 'review' : 'clear';
}
async function refreshRisk(client, profileId) {
  const reasons = await riskReasons(client, profileId);
  if (!reasons.length) return;
  const result = await client.query(`insert into referral_risk_controls(profile_id,status,reasons) values($1,'review',$2)
    on conflict(profile_id) do update set status='review',reasons=excluded.reasons,manual_override=false,updated_at=now()
    where referral_risk_controls.status<>'blocked'
      and (not referral_risk_controls.manual_override or not (referral_risk_controls.reasons @> excluded.reasons))
      and referral_risk_controls.reasons is distinct from excluded.reasons returning profile_id`, [profileId,reasons]);
  if (result.rows.length) await client.query("insert into referral_risk_audit(profile_id,action,reasons) values($1,'automatic_hold',$2)", [profileId,reasons]);
}
async function eligibility(client, profileId) {
  const { rows: [member] } = await client.query(`select am.id,pv.email_status,pv.identity_status,pv.risk_status,am.status
    from account_modes am join profile_verifications pv on pv.profile_id=am.profile_id where am.profile_id=$1 and am.mode='live'`, [profileId]);
  if (!member) return { eligible:false };
  // Crypto and manual confirmed deposits already have one canonical deposit order.
  // Card/ACH settlements are separate; do not also sum crypto event mirrors.
  const deposits = await client.query(`select notional_usd as amount,coalesce(filled_at,created_at) as credited_at
    from orders where account_mode_id=$1 and lower(side)='deposit' and lower(status)='filled' and notional_usd>0`, [member.id]);
  const tables = await client.query("select to_regclass('public.fiat_funding_requests') as fiat");
  if (tables.rows[0].fiat) {
    const fiat = await client.query(`select net_usd as amount,settled_at as credited_at from fiat_funding_requests
      where profile_id=$1 and account_mode_id=$2 and settled_at is not null and net_usd>0
        and lower(status) in ('settled','credited','completed','succeeded')`, [profileId,member.id]);
    deposits.rows.push(...fiat.rows);
  }
  const depositCents = deposits.rows.reduce((sum,d) => sum + atoms(d.amount,2), 0n);
  const times = deposits.rows.map(d => new Date(d.credited_at).getTime()).filter(Number.isFinite);
  const firstDeposit = times.length ? Math.min(...times) : null;
  const holdPassed = firstDeposit !== null && Date.now() >= firstDeposit + HOLD_DAYS * 86400000;
  const trades = await client.query(`select count(*)::int as n from referral_qualifying_trades t join orders o on o.id=t.order_id
    where t.profile_id=$1 and lower(o.status)='filled' and lower(o.side) in ('buy','sell','swap') and t.own_funded_usd>=0.01`, [profileId]);
  const risk = await riskStatus(client,profileId);
  return { eligible: member.status==='active' && member.email_status==='verified' && ['verified','approved'].includes(member.identity_status)
      && !['restricted','frozen','banned','blocked','deleted','high_risk','high','review','in_review','rejected'].includes(member.risk_status)
      && depositCents>=BigInt(MIN_DEPOSIT_USD*100) && trades.rows[0].n>=MIN_TRADES && holdPassed && risk==='clear',
    depositedUsd:Number(depositCents)/100, qualifyingTrades:trades.rows[0].n, holdPassed, risk };
}
async function releaseForWallet(client, walletId) {
  await ensureLots(client,walletId);
  const { rows:[owner] } = await client.query('select am.profile_id from wallets w join account_modes am on am.id=w.account_mode_id where w.id=$1', [walletId]);
  if (!owner) return 0;
  const rewards = await client.query(`select rw.id,rw.legacy_group,r.inviter_profile_id,r.invitee_profile_id,r.status from referral_rewards rw
    join referrals r on r.id=rw.referral_id where rw.profile_id=$1 and rw.released_at is null order by rw.id for update of rw`, [owner.profile_id]);
  if (!rewards.rows.length || !(await eligibility(client,owner.profile_id)).eligible) return 0;
  const checks = new Map([[owner.profile_id,true]]);
  for (const reward of rewards.rows) {
    const other=reward.inviter_profile_id===owner.profile_id ? reward.invitee_profile_id : reward.inviter_profile_id;
    if (other && !checks.has(other)) checks.set(other,(await eligibility(client,other)).eligible);
  }
  const legacyEligible = rewards.rows.filter(r=>r.legacy_group).every(r=>r.status==='rewarded' && checks.get(r.inviter_profile_id) && checks.get(r.invitee_profile_id));
  let released = 0;
  for (const reward of rewards.rows) {
    const other = reward.inviter_profile_id===owner.profile_id ? reward.invitee_profile_id : reward.inviter_profile_id;
    if (!other || reward.status!=='rewarded') continue;
    if (!checks.get(other)) continue;
    if (reward.legacy_group && !legacyEligible) continue;
    const lots = await client.query("select symbol,quantity from referral_reward_lots where wallet_id=$1 and (reward_id=$2 or ($3 and origin='legacy')) for update", [walletId,reward.id,reward.legacy_group]);
    for (const lot of lots.rows) {
      if (lot.symbol==='USD') await client.query('update wallets set promotional_cash=promotional_cash-$2 where id=$1', [walletId,lot.quantity]);
      else await client.query('update holdings set promotional_quantity=promotional_quantity-$3 where wallet_id=$1 and symbol=$2', [walletId,lot.symbol,lot.quantity]);
    }
    await client.query("delete from referral_reward_lots where wallet_id=$1 and (reward_id=$2 or ($3 and origin='legacy'))", [walletId,reward.id,reward.legacy_group]);
    await client.query('update referral_rewards set released_at=now() where id=$1', [reward.id]);
    await client.query("insert into referral_risk_audit(profile_id,action,note) values($1,'reward_unlocked',$2)", [owner.profile_id,reward.id]);
    released++;
  }
  return released;
}
async function releaseForProfile(pool, profileId) {
  await refreshRisk(pool,profileId);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const wallets = await client.query("select w.id from wallets w join account_modes am on am.id=w.account_mode_id where am.profile_id=$1 and am.mode='live'", [profileId]);
    if (wallets.rows[0]) await releaseForWallet(client,wallets.rows[0].id);
    await client.query('commit');
  } catch (err) { await client.query('rollback').catch(()=>{}); throw err; }
  finally { client.release(); }
}
async function recordTrade(client, profileId, order, share) {
  const ownCents = Math.floor(Number(order.notional_usd)*(1-share)*100+1e-7);
  if (ownCents>0) await client.query(`insert into referral_qualifying_trades(order_id,profile_id,own_funded_usd)
    values($1,$2,$3) on conflict do nothing`, [order.id,profileId,ownCents/100]);
}
async function review(pool, profileId, status, note) {
  if (!['clear','review','blocked'].includes(status) || !String(note||'').trim()) throw Object.assign(new Error('Choose a valid referral decision and include a review note.'),{status:400});
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into referral_risk_controls(profile_id,status,manual_override,review_note) values($1,$2,true,$3)
      on conflict(profile_id) do update set status=excluded.status,manual_override=true,review_note=excluded.review_note,updated_at=now()`, [profileId,status,String(note).slice(0,500)]);
    await client.query("insert into referral_risk_audit(profile_id,action,note) values($1,$2,$3)", [profileId,`admin_${status}`,String(note).slice(0,500)]);
    await client.query('commit');
  } catch(err) { await client.query('rollback').catch(()=>{}); throw err; }
  finally { client.release(); }
}
module.exports = { MIN_DEPOSIT_USD,MIN_TRADES,HOLD_DAYS,allocation,addLots,ensureLots,takeLots,recordSignal,
  riskReasons,riskStatus,refreshRisk,eligibility,releaseForWallet,releaseForProfile,recordTrade,review };
