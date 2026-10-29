'use strict';
(() => {
 const $=q=>document.querySelector(q);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={list:[],busy:false,saving:false};
 const form=$('#customerForm'),editor=$('#customerEditor'),notice=$('#customerNotice');
 const notify=(message,error=false)=>{notice.textContent=message;notice.classList.toggle('error',error)};
 const api=async(route,options={})=>{
  const response=await fetch('/api/v1/admin/core/customers'+route,{credentials:'same-origin',cache:'no-store',
   ...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.error||'Không thể xử lý yêu cầu ('+response.status+').');
  return data;
 };
 const close=()=>{
  if(state.saving)return;
  editor.hidden=true;form.reset();$('#customerEditorTitle').textContent='Thêm khách hàng';
  $('#customerAdd').focus({preventScroll:true});
 };
 const open=item=>{
  form.reset();
  form.elements.namedItem('id').value=item?.id||'';
  for(const field of ['name','phone','email','note'])
   form.elements.namedItem(field).value=item?.[field]||'';
  $('#customerEditorTitle').textContent=item?'Chỉnh sửa khách hàng':'Thêm khách hàng';
  editor.hidden=false;
  editor.scrollIntoView({block:'start',behavior:'auto'});
  form.elements.namedItem('name').focus({preventScroll:true});
 };
 function show(){
  const query=$('#customerSearch').value.trim().toLocaleLowerCase('vi-VN');
  const list=state.list.filter(item=>!query||
   [item.name,item.phone,item.email].some(x=>String(x||'').toLocaleLowerCase('vi-VN').includes(query)));
  $('#customerCount').textContent=list.length+' / '+state.list.length+' hồ sơ khách hàng';
  $('#customerRows').innerHTML=list.map(item=>
   '<tr><td data-label="Họ tên"><strong>'+esc(item.name)+'</strong></td>'+
   '<td data-label="Điện thoại">'+esc(item.phone||'—')+'</td>'+
   '<td data-label="Email">'+esc(item.email||'—')+'</td>'+
   '<td data-label="Thao tác"><button type="button" class="secondary customer-edit" data-customer-id="'+esc(item.id)+'">Sửa hồ sơ</button></td></tr>'
  ).join('')||'<tr><td colspan="4" class="empty">'+(query?'Không tìm thấy khách hàng phù hợp.':'Chưa có khách hàng nào.')+'</td></tr>';
 }
 async function load({announce=true}={}){
  if(state.busy)return;
  state.busy=true;
  try{
   const response=await api('?limit=150');
   state.list=Array.isArray(response.customers)?response.customers:[];
   show();
   if(announce)notify('Đã đồng bộ '+state.list.length+' hồ sơ khách hàng từ PostgreSQL.');
  }catch(error){notify(error.message,true)}
  finally{state.busy=false}
 }
 $('#customerAdd').addEventListener('click',()=>open(null));
 $('#customerClose').addEventListener('click',close);
 $('#customerCancel').addEventListener('click',close);
 $('#customerSearch').addEventListener('input',show);
 $('#customerRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-customer-id]');
  if(!button)return;
  const item=state.list.find(x=>x.id===button.dataset.customerId);
  if(item)open(item);
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(state.saving)return;
  const customer=Object.fromEntries(new FormData(form));
  const id=customer.id;delete customer.id;
  state.saving=true;
  const save=$('#customerSave');save.disabled=true;save.textContent='Đang lưu…';
  try{
   await api(id?'/'+encodeURIComponent(id):'',{method:id?'PATCH':'POST',body:JSON.stringify(customer)});
   editor.hidden=true;form.reset();
   await load({announce:false});
   notify(id?'Đã cập nhật thông tin khách hàng.':'Đã thêm khách hàng thành công.');
  }catch(error){notify(error.message,true)}
  finally{state.saving=false;save.disabled=false;save.textContent='Lưu khách hàng'}
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!editor.hidden&&!state.saving)close();
 });
 (async()=>{
  try{
   const response=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});
   const me=await response.json().catch(()=>null);
   if(!response.ok||me?.role!=='admin'){location.replace('/login');return}
   await load();
  }catch(error){notify('Không xác minh được phiên đăng nhập: '+error.message,true)}
 })();
})();
