'use strict';
const $=s=>document.querySelector(s),escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let users=[];
function msg(s,isError=false){$('#notice').textContent=s;$('#notice').className='alert'+(isError?' error':'')}
async function api(path,options={}){const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});const data=await res.json();if(!res.ok)throw Error(data.error||'Máy chủ từ chối yêu cầu');return data}
async function load(){
 const j=await api('/api/admin/users');users=j.users;$('#users').innerHTML=users.map(u=>
 '<tr><td>'+escapeHTML(u.display_name)+'</td><td>'+escapeHTML(u.username)+'</td><td>'+escapeHTML(u.role)+'</td><td>'+escapeHTML(u.active?'Đang hoạt động':'Đã khóa')+'</td><td><button class="secondary" data-toggle="'+escapeHTML(u.id)+'">'+(u.active?'Khóa':'Mở')+'</button><button class="secondary" data-pwd="'+escapeHTML(u.id)+'">Đặt lại mật khẩu</button></td></tr>').join('')||'<tr><td colspan="5">Chưa có tài khoản riêng. Tạo tài khoản đầu tiên.</td></tr>';
 document.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',async()=>{
 const u=users.find(x=>x.id===b.dataset.toggle);if(!window.confirm((u.active?'Khóa':'Mở lại')+' nhân viên '+u.display_name+'?'))return;
 await change(u.id,{active:!u.active});
 }));
 document.querySelectorAll('[data-pwd]').forEach(b=>b.addEventListener('click',async()=>{
 const u=users.find(x=>x.id===b.dataset.pwd);const password=window.prompt('Mật khẩu mới của '+u.username+' (tối thiểu 12 ký tự):');
 if(password===null)return;if(password.length<12){msg('Mật khẩu cần ít nhất 12 ký tự.',true);return}
 await change(u.id,{password});
 }));
}
async function change(id,data){
 try{await api('/api/admin/users/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(data)});msg('Đã cập nhật và thu hồi phiên đăng nhập cũ.');await load()}catch(e){msg(e.message,true)}
}
$('#createUser').addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/api/admin/users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();msg('Tạo nhân viên thành công.');await load()}catch(error){msg(error.message,true)}finally{button.disabled=false}
});
(async()=>{try{const me=await api('/api/me');if(me.role!=='admin'){location.replace('/admin');return}await load();msg('Đã đồng bộ danh sách nhân viên từ Neon.')}catch(e){msg(e.message,true)}})();

(function simplifiedStaff(){
 const columns=document.getElementById('usersColumns');
 const formPanel=document.getElementById('createUserCard');
 const listPanel=columns.querySelector(':scope > .card:last-child');
 const button=document.getElementById('showCreateUser');
 columns.style.display='flex';columns.style.flexDirection='column';
 formPanel.classList.add('ui-hide-by-default');
 formPanel.style.width='100%';formPanel.style.maxWidth='670px';
 listPanel.style.order='1';formPanel.style.order='2';
 button.setAttribute('aria-expanded','false');
 const show=open=>{
  formPanel.classList.toggle('is-open',open);
  button.textContent=open?'Đóng biểu mẫu':'+ Thêm nhân viên';
  button.setAttribute('aria-expanded',String(open));
  if(open)formPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
 };
 button.addEventListener('click',()=>show(!formPanel.classList.contains('is-open')));
 document.getElementById('createUser').addEventListener('reset',()=>setTimeout(()=>show(false),0));
})();
