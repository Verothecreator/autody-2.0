const referralMoney = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const referralMessage = document.getElementById('referral-message');
async function loadReferralProgram() {
  try {
    const response = await fetch('/api/account/referrals',{cache:'no-store',headers:window.AutodyAuth?.headers?.()||{}});
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error||'Your referral rewards are temporarily unavailable.');
    const program=data.program;
    document.getElementById('referral-link').value=program.link;
    document.getElementById('copy-referral-link').disabled=false;
    document.getElementById('referral-credit').textContent=referralMoney.format(program.promotionalCash);
    document.getElementById('referral-sidebar-balance').textContent=referralMoney.format(program.promotionalCash);
    document.getElementById('referral-earned').textContent=referralMoney.format(program.totalEarned);
    document.getElementById('referral-completed').textContent=String(program.rewarded);
    document.getElementById('referral-pending').textContent=program.pending ? `${program.pending} invitation${program.pending===1?'':'s'} waiting for verification or review` : 'Share your link to invite a new member';
    const history=document.getElementById('referral-history');history.replaceChildren();
    if (!program.rewards.length) {const empty=document.createElement('p');empty.className='referral-muted';empty.textContent='Your first reward will appear here after an eligible invitation is verified.';history.append(empty);}
    for(const reward of program.rewards){
      const row=document.createElement('div');row.className='referral-history-row';
      const copy=document.createElement('div'),title=document.createElement('strong'),date=document.createElement('small'),amount=document.createElement('strong');
      title.textContent=reward.role==='invitee'?'Welcome reward':'Invitation reward';
      date.textContent=`${new Date(reward.createdAt).toLocaleDateString()} · Platform-only credit`;
      amount.className='referral-history-amount';amount.textContent=`+${referralMoney.format(reward.amountUsd)}`;
      copy.append(title,date);row.append(copy,amount);history.append(row);
    }
    referralMessage.textContent='Your link is ready to share.';
  }catch(err){referralMessage.textContent=err.message;document.getElementById('referral-link').value='';document.getElementById('referral-history').textContent='We could not load your reward history. Refresh to try again.';}
}
document.getElementById('copy-referral-link').addEventListener('click',async()=>{
  const input=document.getElementById('referral-link');
  try{await navigator.clipboard.writeText(input.value);referralMessage.textContent='Invitation link copied.';}
  catch{input.focus();input.select();referralMessage.textContent='Select and copy your invitation link.';}
});
loadReferralProgram();
