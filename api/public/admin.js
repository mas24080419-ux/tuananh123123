'use strict';
const $=s=>document.querySelector(s);
const text=(id,value)=>{$(id).textContent=String(value)};
const cash=v=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v)||0);
const shortDate=s=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const zoneDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
let latest=null,loading=false;
function notice(message,kind='ok'){const n=$('#notice');n.textContent=message;n.className='notice '+kind+(message?'':' hidden')}
function screen(auth){document.body.classList.toggle('tt6-owner-login',!auth);$('#login').classList.toggle('hidden',auth);$('#dashboard').classList.toggle('hidden',!auth)}
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
function renderFinanceAnalytics(report){
 if(!report||report.error||!window.TT6FinanceCharts){
  const msg=report?.error||'Chưa tải được thư viện biểu đồ.';
  for(const id of ['#faExpensePie','#faPaymentPie','#faCashBars'])$(id).textContent='Không thể tải báo cáo: '+msg;
  return;
 }
 const ch=window.TT6FinanceCharts;
 ch.donut($('#faExpensePie'),report.expense_categories.map(x=>({name:x.name,amount:x.amount})),
    {title:'Tỷ trọng chi phí theo danh mục',totalLabel:'TỔNG CHI',drilldown:false});
 ch.donut($('#faPaymentPie'),report.payment_methods,
    {title:'Cơ cấu phương thức tiền thực thu',totalLabel:'ĐÃ NHẬN'});
 ch.trend($('#faCashBars'),report.series,report.range.granularity);
}
async function reload(){
 if(loading)return;
 loading=true;
 try{
 const params=new URLSearchParams({from:$('#from').value,to:$('#to').value});
 const analyticsReport=await request('/api/admin/analytics?'+params.toString());
 renderFinanceAnalytics(analyticsReport);
 notice('Đã cập nhật biểu đồ · '+new Date().toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}));
 }catch(e){notice(e.message,'error');if(e.status===401||e.status===403)screen(false)}
 finally{loading=false}
}
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('#loginButton');button.disabled=true;text('#loginError','');
 try{
  await request('/api/admin/login',{method:'POST',body:JSON.stringify({email:$('#adminEmail').value.trim(),password:$('#password').value})});
  $('#password').value='';screen(true);await reload();
 }catch(e){text('#loginError',e.message)}finally{button.disabled=false}
});
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
  await request('/api/admin/change-password',{method:'POST',body:JSON.stringify({currentPassword:old,newPassword:neu})});
  $('#passwordForm').reset();output.style.color='#197a63';
  output.textContent='Đổi mật khẩu thành công. Những phiên đăng nhập cũ đã bị thu hồi.';
 }catch(e){output.textContent=e.message}finally{btn.disabled=false}
});
$('#logout').addEventListener('click',async()=>{try{await request('/api/logout',{method:'POST',body:'{}'})}catch{}screen(false);latest=null});
$('#filterForm').addEventListener('submit',e=>{e.preventDefault();reload()});
$('#today').addEventListener('click',()=>{$('#from').value=zoneDate;$('#to').value=zoneDate;reload()});
$('#thisMonth').addEventListener('click',()=>{defaultDates();reload()});

(async()=>{defaultDates();try{const me=await request('/api/me');if(me.role==='admin'){screen(true);await reload();if(location.hash==='#security')securityPanel(true)}else screen(false)}catch{screen(false)}})();
