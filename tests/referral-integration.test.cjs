const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const url=process.env.REFERRAL_TEST_DATABASE_URL;
if(!url){test('Postgres integration tests require the isolated referral test database',{skip:true},()=>{});}
else {
 const target=new URL(url);
 if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!='/autody_referral_test')throw Error('Refusing to test against a non-test database');
 process.env.DATABASE_URL=url;process.env.PGSSLMODE='disable';
 const server=require('../server');
 const r=require('../referrals');
 const rules=require('../referral-eligibility');
 const pool=server.dbPool;
 before(async()=>{await server.initializeDatabase();});
 after(async()=>{await pool.end();});
 async function member({verified=true,cash=0,promo=0}={}){
  const email=`referral-${crypto.randomUUID()}@example.test`,phone=String(Date.now())+crypto.randomInt(10000,99999);
  const {rows:[p]}=await pool.query('insert into profiles(email,display_name) values($1,$2) returning *',[email,'Referral test member']);
  await pool.query(`insert into profile_verifications(profile_id,legal_name,phone,country,date_of_birth,email_status,identity_status) values($1,'Test Member',$2,'United States','1990-01-01',$3,'verified')`,[p.id,phone,verified?'verified':'pending']);
  const live=await server.seedAccountWallet(pool,p.id,'live',0);
  await pool.query('update wallets set cash_balance=$2,promotional_cash=$3 where id=$1',[live.walletId,cash,promo]);
  return {...p,phone,walletId:live.walletId,accountModeId:live.accountModeId};
 }
 async function inTransaction(work){const c=await pool.connect();try{await c.query('begin');const result=await work(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
 async function balance(p){return(await pool.query('select cash_balance,promotional_cash from wallets where id=$1',[p.walletId])).rows[0];}
 function auth(p){return {profileId:p.id,userId:p.id,source:'supabase',user:{email:p.email,name:p.display_name,verification:{identity:'verified'}}};}
 async function oldDeposit(p){await pool.query(`insert into orders(account_mode_id,symbol,asset_type,side,status,notional_usd,created_at,filled_at) values($1,'USD','cash','deposit','filled',1,now()-interval '100 days',now()-interval '100 days')`,[p.accountModeId]);}
 function market(prices){return {resolveAsset:async symbol=>({symbol,name:symbol,assetType:'crypto',price:prices[symbol]}),loadAccount:async()=>null,applyMarketImpact:async()=>{}};}
 test('verification grants exactly $10 to both members, even under simultaneous retries',async()=>{
  const inviter=await member(),invitee=await member({verified:false});
  const code=await r.codeForProfile(pool,inviter.id);
  await inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone));
  await r.settleForProfile(pool,invitee.id);
  assert.equal(Number((await balance(inviter)).cash_balance),0);
  await pool.query("update profile_verifications set email_status='verified' where profile_id=$1",[invitee.id]);
  await Promise.all(Array.from({length:8},()=>r.settleForProfile(pool,invitee.id)));
  for(const p of [inviter,invitee]){const b=await balance(p);assert.equal(Number(b.cash_balance),10);assert.equal(Number(b.promotional_cash),10);}
  const ledger=await pool.query('select count(*)::int as n from referral_rewards where profile_id=any($1::uuid[])',[[inviter.id,invitee.id]]);
  assert.equal(ledger.rows[0].n,2);
  const deposits=await pool.query("select 1 from orders where account_mode_id=$1 and side='deposit'",[invitee.accountModeId]);
  assert.equal(deposits.rows.length,0);
 });
 test('self-referrals, reused identities and referral reassignment are rejected',async()=>{
  const inviter=await member(),invitee=await member();const code=await r.codeForProfile(pool,inviter.id);
  await assert.rejects(inTransaction(c=>r.attach(c,inviter.id,code,inviter.email,inviter.phone)),/cannot refer yourself/);
  await inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone));
  await assert.rejects(inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone)),/already participated/);
  await pool.query('delete from profiles where id=$1',[invitee.id]);
  const replacement=await member();
  await assert.rejects(inTransaction(c=>r.attach(c,replacement.id,code,invitee.email,invitee.phone)),/already participated/);
 });
 test('the actual signup and email verification flow records the invite and awards both members',async()=>{
  const inviter=await member(),code=await r.codeForProfile(pool,inviter.id);
  const signUp={firstName:'New',lastName:'Member',legalName:'New Member',displayName:'New Member',
   email:`signup-${crypto.randomUUID()}@example.test`,phone:String(Date.now())+crypto.randomInt(10000,99999),country:'United States',dateOfBirth:'1990-01-01',accountType:'personal',
   password:'Test-only-password-9731!',termsVersion:'2026-10-17',termsAcceptedAt:new Date().toISOString(),informationConfirmedAt:new Date().toISOString(),referralCode:code};
  const created=await server.createDatabaseAccount(signUp);
  assert.equal((await pool.query('select status from referrals where invitee_profile_id=$1',[created.user.id])).rows[0].status,'pending');
  const verified=await server.verifyDatabaseCode(signUp.email,'email',created.verificationDelivery.emailToken);
  assert.equal(verified.success,true);
  assert.equal(Number((await balance(inviter)).promotional_cash),10);
  assert.equal(Number((await pool.query('select promotional_cash from wallets w join account_modes am on am.id=w.account_mode_id where am.profile_id=$1 and am.mode=\'live\'',[created.user.id])).rows[0].promotional_cash),10);
 });
 test('frozen members cannot issue links or collect new rewards',async()=>{
  const inviter=await member(),invitee=await member();const code=await r.codeForProfile(pool,inviter.id);
  await inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone));
  await pool.query("update account_modes set status='frozen' where profile_id=$1 and mode='live'",[inviter.id]);
  await assert.rejects(r.codeForProfile(pool,inviter.id),/good standing/);
  await r.settleForProfile(pool,invitee.id);assert.equal(Number((await balance(invitee)).cash_balance),0);
 });
 test('direct withdrawal and internal transfer reject promotional cash even after the hold',async()=>{
  const p=await member({cash:10,promo:10}),recipient=await member();await oldDeposit(p);
  await assert.rejects(server.createDatabaseWithdrawalRequest(auth(p),{type:'external',asset:'USD',amount:10,destination:'test-only-destination'}),/not eligible for withdrawal/);
  await assert.rejects(server.createDatabaseWithdrawalRequest(auth(p),{type:'internal',asset:'USD',amount:10,recipientEmail:recipient.email}),/not eligible for withdrawal/);
  assert.equal(Number((await balance(p)).cash_balance),10);
  await pool.query('update wallets set cash_balance=cash_balance+7 where id=$1',[p.walletId]);
  await server.createDatabaseWithdrawalRequest(auth(p),{type:'internal',asset:'USD',amount:7,recipientEmail:recipient.email});
  assert.equal(Number((await balance(p)).cash_balance),10);
  assert.equal(Number((await balance(recipient)).cash_balance),7);
 });
 test('buy then profitable sale cannot launder reward credit into withdrawable USD',async()=>{
  const p=await member({cash:10,promo:10});
  const impacts=[];
  const quotes=prices=>({...market(prices),applyMarketImpact:async(...args)=>{impacts.push(args);}});
  await server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:9.97},auth(p),quotes({BTC:100}));
  const h=(await pool.query("select * from holdings where wallet_id=$1 and symbol='BTC'",[p.walletId])).rows[0];
  assert.equal(Number(h.promotional_quantity),Number(h.quantity));
  await assert.rejects(inTransaction(c=>server.debitDbWalletAsset(c,p.walletId,'BTC',Number(h.quantity))),/not eligible for withdrawal/);
  await server.placeDatabaseLiveOrder({side:'sell',symbol:'BTC',quantity:Number(h.quantity)},auth(p),quotes({BTC:200}));
  const b=await balance(p);assert.ok(Number(b.cash_balance)>10);assert.equal(Number(b.cash_balance),Number(b.promotional_cash));
  await assert.rejects(inTransaction(c=>r.assertWithdrawable(c,p.walletId,'USD',0.01)),/not eligible for withdrawal/);
  assert.equal(impacts.length,0,'Promotional trades must not move controlled market prices for other accounts');
 });
 test('swaps preserve promotional units and protect real funds in a mixed holding',async()=>{
  const p=await member({cash:30,promo:10});
  await server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:19.95},auth(p),market({BTC:100}));
  const h=(await pool.query("select * from holdings where wallet_id=$1 and symbol='BTC'",[p.walletId])).rows[0];
  assert.ok(Number(h.promotional_quantity)>0&&Number(h.promotional_quantity)<Number(h.quantity));
  await server.placeDatabaseLiveOrder({side:'swap',fromSymbol:'BTC',toSymbol:'ETH',notionalUsd:19.95},auth(p),market({BTC:100,ETH:10}));
  const next=(await pool.query("select * from holdings where wallet_id=$1 and symbol='ETH'",[p.walletId])).rows[0];
  assert.ok(Number(next.promotional_quantity)>0&&Number(next.promotional_quantity)<Number(next.quantity));
  await assert.rejects(inTransaction(c=>r.assertWithdrawable(c,p.walletId,'ETH',Number(next.quantity))),/not eligible for withdrawal/);
  const own=Number((Number(next.quantity)-Number(next.promotional_quantity)).toFixed(10));
  await inTransaction(c=>r.assertWithdrawable(c,p.walletId,'ETH',own));
 });
 test('overdrawn and concurrently submitted orders roll back the reward allocation',async()=>{
  const p=await member({cash:10,promo:10});
  const results=await Promise.allSettled(Array.from({length:2},()=>server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:9.97},auth(p),market({BTC:100}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const b=await balance(p);assert.equal(Number(b.cash_balance),Number(b.promotional_cash));assert.ok(Number(b.cash_balance)>=0);
 });
 test('existing identity and 90-day withdrawal controls still apply',()=>{
  assert.throws(()=>server.assertWithdrawalIdentityVerified({verification:{identity:'pending'}}),/Identity verification/);
  assert.throws(()=>server.assertWithdrawalDepositAgeAllowed({email:'person@example.test'},new Date().toISOString()),/90 days/);
  assert.doesNotThrow(()=>server.assertWithdrawalDepositAgeAllowed({email:'person@example.test'},new Date(Date.now()-91*86400000).toISOString()));
 });
 async function pair(inviter){
  inviter=inviter||await member();const invitee=await member();
  const code=await r.codeForProfile(pool,inviter.id);
  await inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone));
  await r.settleForProfile(pool,invitee.id);
  return {inviter,invitee};
 }
 async function qualify(p,{deposit=1000,days=100,trades=3,identity='verified'}={}){
  await pool.query(`insert into orders(account_mode_id,symbol,asset_type,side,status,notional_usd,created_at,filled_at)
    values($1,'USD','cash','deposit','filled',$2,now()-$3*interval '1 day',now()-$3*interval '1 day')`,[p.accountModeId,deposit,days]);
  await pool.query('update profile_verifications set identity_status=$2 where profile_id=$1',[p.id,identity]);
  for(let i=0;i<trades;i++){
   const {rows:[order]}=await pool.query(`insert into orders(account_mode_id,symbol,asset_type,side,status,notional_usd,quantity,filled_price,filled_at)
     values($1,'BTC','crypto','buy','filled',10,0.1,100,now()) returning *`,[p.accountModeId]);
   await rules.recordTrade(pool,p.id,order,0);
  }
 }
 test('both members must qualify; a released reward is real withdrawable USD and release is idempotent',async()=>{
  const {inviter,invitee}=await pair();await qualify(inviter);
  await rules.releaseForProfile(pool,inviter.id);
  assert.equal(Number((await balance(inviter)).promotional_cash),10);
  await qualify(invitee);
  await Promise.all(Array.from({length:5},()=>rules.releaseForProfile(pool,inviter.id)));
  await rules.releaseForProfile(pool,invitee.id);
  for(const p of [inviter,invitee]){const b=await balance(p);assert.equal(Number(b.cash_balance),10);assert.equal(Number(b.promotional_cash),0);}
  const recipient=await member();
  await server.createDatabaseWithdrawalRequest(auth(inviter),{type:'internal',asset:'USD',amount:10,recipientEmail:recipient.email});
  assert.equal(Number((await balance(recipient)).cash_balance),10);
  assert.equal(Number((await balance(inviter)).cash_balance),0);
 });
 test('deposit threshold, trade count, ID approval and 90-day boundary are checked independently',async()=>{
  for(const setting of [{deposit:999.99},{trades:2},{identity:'pending'},{days:89}]){
   const {inviter,invitee}=await pair();await qualify(inviter);await qualify(invitee,setting);
   await rules.releaseForProfile(pool,inviter.id);
   assert.equal(Number((await balance(inviter)).promotional_cash),10,JSON.stringify(setting));
  }
 });
 test('an unrelated unqualified invitation cannot hold back a qualified reward',async()=>{
  const {inviter,invitee}=await pair();await pair(inviter);
  await qualify(inviter);await qualify(invitee);
  await rules.releaseForProfile(pool,inviter.id);
  const b=await balance(inviter);assert.equal(Number(b.cash_balance),20);assert.equal(Number(b.promotional_cash),10);
  await inTransaction(c=>r.assertWithdrawable(c,inviter.walletId,'USD',10));
  await assert.rejects(inTransaction(c=>r.assertWithdrawable(c,inviter.walletId,'USD',10.01)),/not eligible/);
 });
 test('each reward retains its own eligibility through a profitable trade and a swap',async()=>{
  const {inviter,invitee}=await pair();await pair(inviter);
  await server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:19.95},auth(inviter),market({BTC:100}));
  await server.placeDatabaseLiveOrder({side:'swap',fromSymbol:'BTC',toSymbol:'ETH',notionalUsd:39.9},auth(inviter),market({BTC:200,ETH:10}));
  await qualify(inviter);await qualify(invitee);await rules.releaseForProfile(pool,inviter.id);
  const {rows:[h]}=await pool.query("select quantity,promotional_quantity from holdings where wallet_id=$1 and symbol='ETH'",[inviter.walletId]);
  assert.ok(Number(h.promotional_quantity)>0&&Number(h.promotional_quantity)<Number(h.quantity));
  const own=Number((Number(h.quantity)-Number(h.promotional_quantity)).toFixed(10));
  await inTransaction(c=>r.assertWithdrawable(c,inviter.walletId,'ETH',own));
  await assert.rejects(inTransaction(c=>r.assertWithdrawable(c,inviter.walletId,'ETH',Number(h.quantity))),/not eligible/);
 });
 test('only completed trades with own funds count, using the actual order path',async()=>{
  const {inviter}=await pair();
  await server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:1},auth(inviter),market({BTC:100}));
  assert.equal((await pool.query('select count(*)::int as n from referral_qualifying_trades where profile_id=$1',[inviter.id])).rows[0].n,0);
  await pool.query('update wallets set cash_balance=cash_balance+1000 where id=$1',[inviter.walletId]);
  for(let i=0;i<3;i++)await server.placeDatabaseLiveOrder({side:'buy',symbol:'BTC',notionalUsd:20},auth(inviter),market({BTC:100}));
  assert.equal((await pool.query('select count(*)::int as n from referral_qualifying_trades where profile_id=$1',[inviter.id])).rows[0].n,3);
  await pool.query("update orders set status='cancelled' where id=(select order_id from referral_qualifying_trades where profile_id=$1 limit 1)",[inviter.id]);
  assert.equal((await rules.eligibility(pool,inviter.id)).qualifyingTrades,2);
 });
 test('shared devices and copied identity documents hold rewards, with an audited admin review',async()=>{
  const inviter=await member(),invitee=await member(),code=await r.codeForProfile(pool,inviter.id);
  const device=crypto.randomUUID();await rules.recordSignal(pool,inviter.id,'device',device);
  await inTransaction(c=>r.attach(c,invitee.id,code,invitee.email,invitee.phone,{device}));
  await r.settleForProfile(pool,invitee.id);
  assert.equal(Number((await balance(inviter)).cash_balance),0);
  for(const p of [inviter,invitee])await rules.review(pool,p.id,'clear','Verified distinct account owners in isolated test');
  await r.settleForProfile(pool,invitee.id);assert.equal(Number((await balance(inviter)).cash_balance),10);
  await qualify(inviter);await qualify(invitee);
  const document=crypto.randomUUID();for(const p of [inviter,invitee])await rules.recordSignal(pool,p.id,'document',document);
  await rules.releaseForProfile(pool,inviter.id);
  assert.equal(Number((await balance(inviter)).promotional_cash),10,'New signals must not inherit an old manual clearance');
  assert.equal(await rules.riskStatus(pool,inviter.id),'review');
  const audit=await pool.query('select action from referral_risk_audit where profile_id=$1',[inviter.id]);
  assert.ok(audit.rows.some(r=>r.action==='automatic_hold'));assert.ok(audit.rows.some(r=>r.action==='admin_clear'));
 });
 test('a shared network alone is allowed, while a signup burst is held for review',async()=>{
  const ip=crypto.randomUUID(),members=[];
  for(let i=0;i<6;i++){const p=await member();members.push(p);await rules.recordSignal(pool,p.id,'signup_ip',ip);if(i===1)assert.equal(await rules.riskStatus(pool,p.id),'clear');}
  await rules.refreshRisk(pool,members[0].id);assert.equal(await rules.riskStatus(pool,members[0].id),'review');
 });
 test('manual reward blocks cannot be bypassed by meeting eligibility',async()=>{
  const {inviter,invitee}=await pair();await qualify(inviter);await qualify(invitee);
  await rules.review(pool,invitee.id,'blocked','Confirmed reward abuse in isolated test');
  await rules.releaseForProfile(pool,inviter.id);assert.equal(Number((await balance(inviter)).promotional_cash),10);
  await assert.rejects(inTransaction(c=>r.assertWithdrawable(c,invitee.walletId,'USD',10)),/review your account activity/);
 });
 test('old pooled balances migrate conservatively and unlock without adding money',async()=>{
  const {inviter,invitee}=await pair();
  await pool.query('delete from referral_reward_lots where wallet_id=$1',[inviter.walletId]);
  await pool.query('update wallets set referral_lots_initialized=false where id=$1',[inviter.walletId]);
  await qualify(inviter);await qualify(invitee);await rules.releaseForProfile(pool,inviter.id);
  const b=await balance(inviter);assert.equal(Number(b.cash_balance),10);assert.equal(Number(b.promotional_cash),0);
 });
 test('new referral admin endpoints reject unauthenticated requests',async()=>{
  const http=server.app.listen(0,'127.0.0.1');await new Promise(resolve=>http.once('listening',resolve));
  try {for(const path of ['overview','review']){const response=await fetch(`http://127.0.0.1:${http.address().port}/api/admin/referrals/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);}}
  finally {await new Promise(resolve=>http.close(resolve));}
 });
 test('ordinary funds do not acquire referral eligibility requirements',async()=>{
  const p=await member({cash:2}),recipient=await member();
  await server.createDatabaseWithdrawalRequest(auth(p),{type:'internal',asset:'USD',amount:1,recipientEmail:recipient.email});
  assert.equal(Number((await balance(recipient)).cash_balance),1);
  await assert.rejects(server.createDatabaseWithdrawalRequest(auth(p),{type:'external',asset:'USD',amount:2,destination:'test-only'}),/Not enough USD/);
 });
}
