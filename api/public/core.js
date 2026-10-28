'use strict';
const $=x=>document.querySelector(x),esc=x=>String(x??'').replace(/[&<>"']/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[a]));
const vnd=x=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(x)||0);
const stamp=x=>new Date(x).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'});
const base='/api/admin/core/';
let data={},busy=false;
const menuPending=new Set();
function note(text,error=false){const el=$('#notice');el.textContent=text;el.className='notice'+(error?' error':'')}
async function api(path,options={}){
 const res=await fetch(base+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 let d;try{d=await res.json()}catch{throw Error('Phản hồi không hợp lệ')}
 if(!res.ok)throw Error(d.error||'Có lỗi khi cập nhật');return d;
}
const put=(path,obj,method='POST')=>api(path,{method,body:JSON.stringify(obj)});
const formData=f=>Object.fromEntries(new FormData(f));
const empty=(cols,msg)=>'<tr><td colspan="'+cols+'" class="empty">'+esc(msg)+'</td></tr>';
async function refresh(){
 if(busy)return;busy=true;
 try{
  const [catalog,tables,customers,shift,audit]=await Promise.all([
   api('catalog'),api('tables'),api('customers?limit=150'),
   api('shift'),api('audit?limit=100')
  ]);
  data={catalog:catalog.items,tables:tables.tables,customers:customers.customers,shift:shift.shift,audit:audit.events};
  render();note('Đã đồng bộ dữ liệu quản trị từ PostgreSQL.');
 }catch(e){note(e.message,true)}finally{busy=false}
}
function render(){
 $('#menuRows').innerHTML=data.catalog.map(x=>'<tr><td><b>'+esc(x.name)+'</b><div class="muted">'+esc(x.sku||'')+'</div></td><td>'+esc(x.category)+'<div class="muted">'+(x.station==='bar'?'Bar':'Bếp')+'</div></td><td>'+vnd(x.price)+'</td><td><span class="pill '+(!x.active?'warn':'')+'">'+(x.active?'Đang bán':'Tạm ẩn')+'</span></td><td><button class="secondary" data-edit="menu" data-id="'+esc(x.id)+'">Sửa</button><button class="secondary" data-toggle="'+esc(x.id)+'">'+(x.active?'Ngừng bán':'Mở bán')+'</button></td></tr>').join('')||empty(5,'Chưa có món nào.');
 if(window.TT6MenuMobile)window.TT6MenuMobile.render(data.catalog);
 $('#tableRows').innerHTML=data.tables.map(t=>'<tr><td><b>'+esc(t.name)+'</b></td><td>'+esc(t.zone)+'</td><td>'+t.capacity+'</td><td><select data-table-status="'+esc(t.id)+'"><option value="available" '+(t.service_status==='available'?'selected':'')+'>Trống</option><option value="occupied" '+(t.service_status==='occupied'?'selected':'')+'>Có khách</option><option value="reserved" '+(t.service_status==='reserved'?'selected':'')+'>Đã đặt</option><option value="cleaning" '+(t.service_status==='cleaning'?'selected':'')+'>Đang dọn</option></select></td><td><a href="/t/'+esc(t.token)+'" target="_blank" rel="noopener">Mở QR</a><div class="muted">'+(t.active?'QR hoạt động':'QR đang khóa')+'</div></td><td><button data-table-active="'+esc(t.id)+'" class="secondary">'+(t.active?'Khóa QR':'Mở QR')+'</button><button data-table-rotate="'+esc(t.id)+'" class="secondary">Đổi QR</button></td></tr>').join('')||empty(6,'Chưa có bàn.');
 const setRows=(id,rows,cols)=>{$(id).innerHTML=rows||empty(cols,'Chưa có dữ liệu.')};
 setRows('#customerRows',data.customers.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.phone)+'</td><td>'+esc(x.email)+'</td><td><button data-edit="customer" data-id="'+esc(x.id)+'" class="secondary">Sửa</button></td></tr>').join(''),4);
 setRows('#auditRows',data.audit.map(a=>'<tr><td>'+esc(stamp(a.created_at))+'</td><td>'+esc(a.actor)+'</td><td>'+esc(a.entity)+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.entity_id||'')+'</td></tr>').join(''),5);
 const shift=data.shift;
 $('#shiftStatus').textContent=!shift?'Chưa có ca nào.':shift.status==='open'?'Ca đang mở từ '+stamp(shift.opened_at)+' · Tiền đầu ca '+vnd(shift.opening_cash):
  'Ca gần nhất đã chốt. Tiền thực đếm '+vnd(shift.counted_cash)+' · Chênh lệch '+vnd(shift.variance);
 $('#openShiftForm').classList.toggle('hidden',Boolean(shift&&shift.status==='open'));
 $('#closeShiftForm').classList.toggle('hidden',!shift||shift.status!=='open');
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
  const kind=b.dataset.edit,item=(kind==='menu'?data.catalog:data.customers).find(x=>x.id===b.dataset.id);
  const form=$('#'+(kind==='menu'?'menuForm':'customerForm'));
  if(!item)return;
  for(const [name,v]of Object.entries(item)){const control=form.elements.namedItem(name);if(control)control.value=v??''}
  if(kind==='menu')document.getElementById('menuSheetTitle').textContent='Chỉnh sửa món';
  if(!(kind==='menu'&&window.matchMedia('(max-width:760px)').matches))form.scrollIntoView({behavior:'smooth',block:'center'});
 });
 document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{
  const itemId=b.dataset.toggle;
  if(menuPending.has(itemId))return;
  const item=data.catalog.find(x=>x.id===itemId);
  if(!item)return;
  menuPending.add(itemId);
  document.querySelectorAll('[data-toggle]').forEach(el=>{if(el.dataset.toggle===itemId)el.disabled=true});
  try{await put('catalog/'+itemId+'/availability',{active:!item.active},'PATCH');await refresh()}
  catch(e){note(e.message,true)}
  finally{
   menuPending.delete(itemId);
   document.querySelectorAll('[data-toggle]').forEach(el=>{if(el.dataset.toggle===itemId)el.disabled=false});
  }
 });
 document.querySelectorAll('[data-table-active]').forEach(b=>b.onclick=()=>mutation(async()=>put('tables/'+b.dataset.tableActive,{active:!data.tables.find(t=>t.id===b.dataset.tableActive)?.active},'PATCH')));
 document.querySelectorAll('[data-table-status]').forEach(s=>s.onchange=()=>mutation(async()=>put('tables/'+s.dataset.tableStatus,{serviceStatus:s.value},'PATCH')));
 document.querySelectorAll('[data-table-rotate]').forEach(b=>b.onclick=async()=>{if(!window.confirm('Đổi mã QR sẽ vô hiệu hóa tem đang dán. Xác nhận đổi QR cho bàn này?'))return;await mutation(async()=>put('tables/'+b.dataset.tableRotate+'/rotate-qr',{confirm:true}))});
}
async function mutation(fn){try{await fn();await refresh()}catch(e){note(e.message,true)}}
async function saveForm(form,path,method,convert=x=>x){
 const button=form.querySelector('[type=submit]');button.disabled=true;
 try{const b=convert(formData(form));await put(path,b,method);form.reset();await refresh()}catch(e){note(e.message,true)}finally{button.disabled=false}
}
$('#menuForm').onsubmit=e=>{e.preventDefault();const b=formData(e.target);const path=b.id?'catalog/'+b.id:'catalog';saveForm(e.target,path,b.id?'PATCH':'POST',x=>({...x,price:Number(x.price)}))};
$('#tableForm').onsubmit=e=>{e.preventDefault();saveForm(e.target,'tables','POST',x=>({...x,capacity:Number(x.capacity)}))};
$('#customerForm').onsubmit=e=>{e.preventDefault();const b=formData(e.target);saveForm(e.target,b.id?'customers/'+b.id:'customers',b.id?'PATCH':'POST')};
$('#openShiftForm').onsubmit=e=>{e.preventDefault();saveForm(e.target,'shift','POST',x=>({action:'open',openingCash:Number(x.openingCash)}))};
$('#closeShiftForm').onsubmit=e=>{e.preventDefault();if(!window.confirm('Bạn đã đếm tiền mặt thực tế và muốn chốt ca?'))return;saveForm(e.target,'shift','POST',x=>({action:'close',countedCash:Number(x.countedCash),note:x.note,confirm:true}))};
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el===b));
 document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===b.dataset.tab));
}));
(async()=>{try{const r=await fetch('/api/me',{credentials:'same-origin'});const me=await r.json();if(me.role!=='admin'){location.replace('/admin');return}await refresh()}catch(e){note('Không xác minh được quyền: '+e.message,true)}})();

/* V11 progressive disclosure: preserve all original forms and connected APIs. */
(function minimalCore(){
 const actions=[
  ['menu','Thêm món'],['tables','Thêm bàn'],
  ['customers','Thêm khách hàng']
 ];
 const registry=new Map();
 for(const [sectionId,actionText] of actions){
  const section=document.getElementById(sectionId);
  const split=section?.querySelector('.split');
  const panels=split?.querySelectorAll(':scope > .panel');
  if(!panels||panels.length<2)throw Error('Thiếu vùng nghiệp vụ '+sectionId);
  const formPanel=panels[0],listPanel=panels[1];
  split.classList.add('ui-focus-stack');
  formPanel.classList.add('ui-form-card');
  listPanel.classList.add('ui-focused-list');
  const row=document.createElement('div');row.className='ui-action-row';
  const title=document.createElement('strong');title.textContent=sectionId==='tables'?'Danh sách bàn':sectionId==='menu'?'Thực đơn đang quản lý':'Khách hàng';title.className='sh-headingline';
  const button=document.createElement('button');button.type='button';button.className='ui-form-toggle';button.textContent='+ '+actionText;
  const toggle=open=>{
   formPanel.classList.toggle('is-open',open);
   button.textContent=open?'Đóng biểu mẫu':'+ '+actionText;
   button.setAttribute('aria-expanded',String(open));
   const mobileMenu=sectionId==='menu'&&window.matchMedia('(max-width:760px)').matches;
   if(mobileMenu){
    document.body.classList.toggle('tt6-menu-sheet-open',open);
    if(open){
     formPanel.setAttribute('role','dialog');formPanel.setAttribute('aria-modal','true');
     formPanel.setAttribute('aria-label','Thêm hoặc sửa món');
     document.getElementById('menuSheetTitle').textContent=formPanel.querySelector('[name="id"]')?.value?'Chỉnh sửa món':'Thêm món';
     setTimeout(()=>formPanel.querySelector('[name="name"]')?.focus({preventScroll:true}),0);
    }else{
     formPanel.removeAttribute('role');formPanel.removeAttribute('aria-modal');formPanel.removeAttribute('aria-label');
    }
   }
   if(open&&!mobileMenu)formPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  button.addEventListener('click',()=>toggle(!formPanel.classList.contains('is-open')));
  row.append(title,button);listPanel.prepend(row);
  const form=formPanel.querySelector('form');
  if(form)form.addEventListener('reset',()=>setTimeout(()=>toggle(false),0));
  registry.set(sectionId,toggle);
 }
 document.addEventListener('click',ev=>{
  const edit=ev.target.closest('[data-edit]');
  if(!edit)return;
  const sectionId=edit.closest('.section')?.id;
  if(registry.has(sectionId))registry.get(sectionId)(true);
 },true);
 // Keep the three most frequent actions visible; group lower-frequency functions.
 const tabs=document.querySelector('.tabs');
 const extra=document.createElement('details');extra.className='ui-core-extra';
 const label=document.createElement('summary');label.textContent='Khác';
 const menu=document.createElement('div');
 extra.append(label,menu);
 const secondary=['customers','shifts','audit'];
 for(const code of secondary){
  const el=tabs.querySelector('[data-tab="'+code+'"]');
  if(!el)throw Error('Thiếu tab '+code);
  menu.append(el);
 }
 tabs.append(extra);
 document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  extra.open=false;
  if(secondary.includes(btn.dataset.tab)){label.textContent='Khác · '+btn.textContent.trim();}
  else label.textContent='Khác';
 }));
 document.getElementById('menuSheetClose')?.addEventListener('click',()=>registry.get('menu')?.(false));
 document.getElementById('menuSheetBackdrop')?.addEventListener('click',()=>registry.get('menu')?.(false));
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('tt6-menu-sheet-open')){
   event.preventDefault();registry.get('menu')?.(false);
  }
 });
 document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  if(btn.dataset.tab!=='menu'&&document.body.classList.contains('tt6-menu-sheet-open'))registry.get('menu')?.(false);
 }));
 const start=location.hash.slice(1);
 if(start&&document.querySelector('[data-tab="'+start+'"]'))document.querySelector('[data-tab="'+start+'"]').click();
})();
