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
  assert.match(html,/any sale proceeds or gains attributable to that credit/);
  assert.match(html,/permanently ban your account and any other accounts involved/);
  assert.match(html,/90 days after the account's first verified deposit/);
 }
});
