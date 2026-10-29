'use strict';
const $=s=>document.querySelector(s);
const text=(id,value)=>{$(id).textContent=String(value)};
const cash=v=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v)||0);
const shortDate=s=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const zoneDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));

function notice(message,kind='ok'){const n=$('#notice');n.textContent=message;n.className='notice '+kind+(message?'':' hidden')}
function screen(auth){if(!auth){location.replace('/login');return}document.body.classList.remove('tt6-owner-login');$('#dashboard').classList.remove('hidden')}
async function request(url,options={}){
 let response;
 try{response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}})}
 catch{throw Error('Không kết nối được máy chủ.')}
 let data;
 try{data=await response.json()}catch{throw Error('Phản hồi không hợp lệ từ máy chủ.')}
 if(!response.ok){const error=new Error(data.error||'Không thể xử lý yêu cầu.');error.status=response.status;throw error}
 return data;
}
function defaultDates(){text('#from',zoneDate.slice(0,7)+'-01');text('#to',zoneDate);$('#from').value=zoneDate.slice(0,7)+'-01';$('#to').value=zoneDate}
function setupOwnerShared(reload,onLogout){
document.querySelectorAll('[data-visibility]').forEach(button=>button.addEventListener('click',()=>{
 const field=document.getElementById(button.dataset.visibility);
 const reveal=field.type==='password';field.type=reveal?'text':'password';
 button.textContent=reveal?'Ẩn':'Hiện';button.setAttribute('aria-label',reveal?'Ẩn mật khẩu':'Hiện mật khẩu');
}));
function securityPanel(show){
 if($('#dashboard').classList.contains('hidden'))return;
 $('#security').classList.toggle('hidden',!show);
 $('#dashboard').classList.toggle('tt6-security-mode',show);
 if(show){location.hash='security';$('#currentPassword').focus({preventScroll:true})}
 else if(location.hash==='#security')history.replaceState(null,'',location.pathname);
}
$('#changePassBtn').addEventListener('click',()=>securityPanel(true));
$('#closeSecurity').addEventListener('click',()=>securityPanel(false));
window.addEventListener('hashchange',()=>{if(!$('#dashboard').classList.contains('hidden'))securityPanel(location.hash==='#security')});
$('#passwordForm').addEventListener('submit',async ev=>{
 ev.preventDefault();
 const old=$('#currentPassword').value,neu=$('#newPassword').value,confirmed=$('#confirmPassword').value;
 const output=$('#securityNotice'),btn=$('#savePassword');
 output.textContent='';output.style.color='#a3293a';
 if(neu!==confirmed){output.textContent='Hai lần nhập mật khẩu mới không khớp.';return}
 btn.disabled=true;
 try{
  await request('/api/management/change-password',{method:'POST',body:JSON.stringify({currentPassword:old,newPassword:neu})});
  $('#passwordForm').reset();output.style.color='#197a63';
  output.textContent='Đổi mật khẩu thành công. Những phiên đăng nhập cũ đã bị thu hồi.';
 }catch(e){output.textContent=e.message}finally{btn.disabled=false}
});
$('#logout').addEventListener('click',async()=>{try{await request('/api/session/logout',{method:'POST',body:'{}'})}catch{}location.replace('/login');onLogout()});
$('#filterForm').addEventListener('submit',e=>{e.preventDefault();reload()});
$('#today').addEventListener('click',()=>{$('#from').value=zoneDate;$('#to').value=zoneDate;reload()});
$('#thisMonth').addEventListener('click',()=>{defaultDates();reload()});

(async()=>{defaultDates();try{const me=await request('/api/session');if(me.role==='admin'){screen(true);await reload();if(location.hash==='#security')securityPanel(true)}else screen(false)}catch{screen(false)}})();
}
