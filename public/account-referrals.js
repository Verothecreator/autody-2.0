const referralMessage = document.getElementById('referral-message');
async function loadReferralProgram() {
  if (!referralMessage) return;
  try {
    const response = await fetch('/api/account/referrals',{cache:'no-store',headers:window.AutodyAuth?.headers?.()||{}});
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error||'Your referral link is temporarily unavailable.');
    document.getElementById('referral-link').value=data.program.link;
    document.getElementById('copy-referral-link').disabled=false;
    const balance=document.getElementById('referral-sidebar-balance');
    if (balance) balance.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(data.program.totalEarned);
    referralMessage.textContent='Your link is ready to share.';
  } catch(err) {
    referralMessage.textContent=err.message;
    document.getElementById('referral-link').value='';
  }
}
document.getElementById('copy-referral-link')?.addEventListener('click',async()=>{
  const input=document.getElementById('referral-link');
  try { await navigator.clipboard.writeText(input.value);referralMessage.textContent='Invitation link copied.'; }
  catch { input.focus();input.select();referralMessage.textContent='Select and copy your invitation link.'; }
});
loadReferralProgram();
