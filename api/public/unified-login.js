'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 // This is a safety net for old sessions. Authorization is enforced by the server.
 const destinations={admin:'/admin',waiter:'/staff/orders',cashier:'/staff/orders',manager:'/staff/orders',kitchen:'/staff?kds=1',bar:'/staff?kds=1'};
 const landing=account=>{
  if(!account?.staff)return null;
  if(account.role==='admin')return '/admin';
  if(account.workArea==='equipment')return '/staff/lockers';
  if(account.workArea==='restroom')return '/staff';
  return destinations[account.role]||null;
 };
 const navigate=target=>{if(target&&target!=='/login')location.replace(target)};
 const message=s=>{$('loginError').textContent=s};
 $('togglePassword').addEventListener('click',()=>{
  const el=$('password'),visible=el.type==='password';
  el.type=visible?'text':'password';
  $('togglePassword').textContent=visible?'Ẩn':'Hiện';
  $('togglePassword').setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');
 });
 $('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('loginButton');
  if(button.disabled)return;
  const email=$('email').value.trim().toLowerCase(),password=$('password').value;
  button.disabled=true;message('');
  try{
   const response=await fetch('/api/session/login',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Email hoặc mật khẩu không chính xác.');
   $('password').value='';
   // Only server-returned role/home is used; the form never selects a role.
   navigate(data.home||landing({...data,staff:true}));
  }catch(error){message(error.message||'Không kết nối được máy chủ.')}
  finally{button.disabled=false}
 });
 fetch('/api/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null)
  .then(me=>{if(me?.staff)navigate(me.home||landing(me))}).catch(()=>{});
})();
