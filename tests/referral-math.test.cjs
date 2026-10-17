const {test}=require('node:test');
const assert=require('node:assert/strict');
const r=require('../referrals');
test('Gmail aliases cannot be used to refer yourself',()=>{
 assert.equal(r.canonicalEmail('Test.User+bonus@googlemail.com'),'testuser@gmail.com');
 assert.equal(r.canonicalEmail('Person+orders@company.example'),'person+orders@company.example');
});
test('reward proceeds and mixed-fund allocations never lose their restriction through rounding',()=>{
 assert.equal(r.restrictedPortion(19.89,1),19.89);
 assert.equal(r.restrictedPortion(0.01,0.5),0.01);
 assert.equal(r.restrictedPortion(100,0),0);
 for(const precision of [2,10])for(let i=1;i<=1000;i++){
   const amount=i/97,share=(i%100)/100;
   const restricted=r.restrictedPortion(amount,share,precision);
   assert.ok(restricted+1e-12>=amount*share);
   assert.ok(restricted<=amount);
 }
 assert.throws(()=>r.restrictedPortion(10,1.1));
});
test('both customer-facing terms contain the referral restrictions',()=>{
 const fs=require('fs'),path=require('path');
 for(const file of ['terms.html','sign-up.html']){
  const html=fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
  assert.match(html,/id="referral-rewards"/);
  assert.match(html,/sale proceeds or gains attributable to it/);
  assert.match(html,/\$1,000 in genuine confirmed deposits/);
  assert.match(html,/at least three qualifying live asset trades/);
  assert.match(html,/both you and the member linked to that reward/);
  assert.match(html,/permanently ban your account and any other accounts involved/);
  assert.match(html,/90 days after the account's first verified deposit/);
 }
});
test('per-reward allocations conserve cents and the smallest asset unit',()=>{
 const {allocation}=require('../referral-eligibility');
 const lots=[{origin:'a',quantity:'1'},{origin:'b',quantity:'1'},{origin:'c',quantity:'1'}];
 assert.deepEqual(allocation('0.01',lots,2),[{origin:'a',quantity:'0.01'}]);
 assert.deepEqual(allocation('0.0000000001',lots,10),[{origin:'a',quantity:'0.0000000001'}]);
 const values=allocation('23.99',lots,2);assert.equal(values.reduce((sum,r)=>sum+Math.round(Number(r.quantity)*100),0),2399);
});
