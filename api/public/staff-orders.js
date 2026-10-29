'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||'&#39;'));
 const money=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(n)||0)+' ₫';
 const date=s=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const state={role:null,menu:[],tables:[],orders:[],cart:new Map(),requestId:null,ready:false,loading:false,saving:false};
 const staffPresence={sessionId:crypto.randomUUID(),ordered:false,inFlight:false,dirty:false,timer:null,pending:null};
 const message=(s,error=false)=>{$('message').textContent=s;$('message').classList.toggle('error',error)};
 async function api(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const result=await response.json();
  if(!response.ok){const error=Error(result.error||'Máy chủ từ chối yêu cầu');error.status=response.status;throw error}
  return result;
 }
 const canPay=()=>['admin','manager','cashier'].includes(state.role);
 // Each payment action reports next to the order itself, not only above the mobile page.
 function paymentFeedback(orderId,text,error=false){
  const card=[...$('orders').querySelectorAll('article.order')].find(el=>el.dataset.orderId===orderId);
  if(!card)return;
  let note=card.querySelector('.paymentFeedback');
  if(!note){note=document.createElement('p');note.className='paymentFeedback';note.setAttribute('role','status');note.setAttribute('aria-live','polite');card.appendChild(note)}
  note.textContent=text;
  note.classList.toggle('is-error',error);
 }
 // Send ONLY counts and a table identifier, never item names, prices, notes or customer data.
 const activity=()=>({
  sessionId:staffPresence.sessionId,tableId:$('table').value||null,
  stage:state.saving?'submitting':staffPresence.ordered?'ordered':
   (state.cart.size>0||$('table').value||$('search').value.trim())?'selecting':'viewing',
  cartItems:[...state.cart.values()].reduce((a,b)=>a+b,0)
 });
 async function pulsePresence(){
  if(!state.ready||document.hidden)return;
  if(staffPresence.inFlight){staffPresence.dirty=true;return}
  staffPresence.inFlight=true;
  try{await api('/api/v1/staff/presences',{method:'POST',body:JSON.stringify(activity())})}
  catch{ /* Advisory telemetry only: ordering remains available if tracking is offline. */ }
  finally{
   staffPresence.inFlight=false;
   if(staffPresence.dirty){staffPresence.dirty=false;queuePresence()}
  }
 }
 function queuePresence(){
  if(staffPresence.pending)clearTimeout(staffPresence.pending);
  staffPresence.pending=setTimeout(()=>{staffPresence.pending=null;void pulsePresence()},250);
 }
 function leavePresence(){
  if(staffPresence.pending){clearTimeout(staffPresence.pending);staffPresence.pending=null}
  if(!state.ready)return;
  const body=JSON.stringify({sessionId:staffPresence.sessionId});
  if(navigator.sendBeacon){
   try{if(navigator.sendBeacon('/api/v1/staff/presences/leave',new Blob([body],{type:'text/plain;charset=UTF-8'})))return}catch{}
  }
  try{void fetch('/api/v1/staff/presences/leave',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'text/plain'},body})}catch{}
 }
 function drawCart(){
  const count=[...state.cart.values()].reduce((a,b)=>a+b,0);
  const sum=[...state.cart].reduce((a,[id,q])=>a+q*(Number(state.menu.find(m=>m.id===id)?.price)||0),0);
  $('cartCount').textContent=count?count+' phần · '+state.cart.size+' món':'Chưa chọn món';
  $('amount').textContent=money(sum);
  $('place').disabled=state.saving||!count||!$('table').value;
 }
 function drawMenu(){
  const query=$('search').value.trim().toLocaleLowerCase('vi-VN');
  const items=state.menu.filter(m=>(m.name+' '+m.category).toLocaleLowerCase('vi-VN').includes(query));
  $('menu').innerHTML=items.map(m=>{
   const q=state.cart.get(m.id)||0,n=Number(m.available_quantity)||0;
   const cartTotal=[...state.cart.values()].reduce((total,qty)=>total+qty,0);
   const canAdd=!state.saving&&q<n&&q<20&&cartTotal<60;
   const soldOut=n<=0;
   const hint=soldOut?'Hết hàng':q?'Đã chọn '+q+' · chạm để thêm':'Chạm vào món để thêm';
   // The main item surface is a real button, separate from +/- controls.
   // Tap the name, price or empty area on mobile to add one portion to the cart.
   return '<div class="food'+(q?' in-cart':'')+(soldOut?' sold-out':'')+'">'+
    '<button type="button" class="foodPick" data-id="'+esc(m.id)+'" data-step="1" '+(canAdd?'':'disabled')+
    ' aria-label="Thêm một phần '+esc(m.name)+' vào giỏ hàng"><span class="foodInfo"><b>'+esc(m.name)+'</b>'+
    '<small>'+esc(m.category)+' · '+(n>0?'Còn '+n+' phần':'Hết hàng')+'</small><span class="price">'+money(m.price)+'</span>'+
    '<span class="tapHint">'+esc(hint)+'</span></span></button>'+
    '<div class="counter"><button type="button" data-id="'+esc(m.id)+'" data-step="-1" '+(!q||state.saving?'disabled':'')+' aria-label="Giảm '+esc(m.name)+'">−</button>'+
    '<b aria-label="'+q+' phần">'+q+'</b><button type="button" data-id="'+esc(m.id)+'" data-step="1" '+(canAdd?'':'disabled')+
    ' aria-label="Thêm '+esc(m.name)+'">+</button></div></div>';
  }).join('')||'<div class="empty">Không có món phù hợp</div>';
  drawCart();
 }
 async function loadCatalog(){
  const [menu,tables]=await Promise.all([api('/api/v1/staff/menu'),api('/api/v1/tables')]);
  state.menu=menu.items;state.tables=tables.tables.filter(t=>t.active);
  const selected=$('table').value;
  $('table').innerHTML='<option value="">Chọn bàn</option>'+state.tables.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
  $('table').value=state.tables.some(t=>t.id===selected)?selected:'';
  for(const [id,q] of state.cart){const m=state.menu.find(m=>m.id===id);if(!m||Number(m.available_quantity)<q)state.cart.delete(id)}
  drawMenu();
 }
 const textStatus={new:'Chờ làm',preparing:'Đang làm',ready:'Sẵn sàng',served:'Đã phục vụ',cancelled:'Đã hủy'};
 function actions(item){
  const code=esc(item.id),role=state.role;
  const btn=(s,label,cls='')=>'<button type="button" data-line="'+code+'" data-next="'+s+'" class="'+cls+'">'+label+'</button>';
  let s='';
  if(['admin','manager'].includes(role)&&item.status==='new')s+=btn('preparing','Bắt đầu');
  if(['admin','manager'].includes(role)&&item.status==='preparing')s+=btn('ready','Làm xong');
  if(item.status==='ready')s+=btn('served','Đã phục vụ');
  if(item.status==='new'||(['admin','manager'].includes(role)&&item.status==='preparing'))s+=btn('cancelled','Hủy món','danger');
  return s;
 }
 function drawOrders(){
  const q=$('filter').value.trim().toLocaleLowerCase('vi-VN'),status=$('status').value;
  const rows=state.orders.filter(o=>(!q||(o.table_name+' '+o.id).toLocaleLowerCase('vi-VN').includes(q))&&(status==='all'||(status==='active'&&o.items.some(i=>!['served','cancelled'].includes(i.status)))||o.payment_status===status));
  $('count').textContent=rows.length+' đơn phù hợp · danh sách tự cập nhật';
  $('orders').innerHTML=rows.map(o=>{
   const total=Number(o.total_vnd)||0,paid=o.payment_status==='paid',pay=canPay()&&!paid&&o.payment_status==='unpaid'&&total>0;
   return '<article class="order" data-order-id="'+esc(o.id)+'"><div class="orderHead"><div><strong>'+esc(o.table_name)+'</strong><small>#'+esc(o.id.slice(0,8))+' · '+esc(date(o.created_at))+'</small></div><span class="pill '+(paid?'paid':'')+'">'+(paid?'Đã thu':o.payment_status==='refunded'?'Đã hoàn tiền':'Chưa thu')+'</span></div>'+
    (o.note?'<p class="hint">Ghi chú: '+esc(o.note)+'</p>':'')+
    o.items.map(i=>'<div class="line"><div><b>'+Number(i.quantity)+' × '+esc(i.name)+'</b><small>'+esc(textStatus[i.status]||i.status)+' · '+(i.station==='bar'?'Bar':'Bếp')+'</small></div><div class="lineActions">'+actions(i)+'</div></div>').join('')+
    '<div class="orderFooter"><div><strong>'+money(total)+'</strong><small>'+(o.payment_method==='bank_transfer'?'Chuyển khoản':o.payment_method==='cash'?'Tiền mặt':'Chưa rõ phương thức')+'</small></div>'+
   (pay?'<button type="button" class="pay" data-pay="'+esc(o.id)+'">Đã nhận tiền</button>':
    (!canPay()&&!paid&&o.payment_status==='unpaid'&&total>0?'<span class="payRestricted">Chỉ Thu ngân / Quản lý xác nhận thu tiền</span>':''))+
    '</div></article>';
  }).join('')||'<div class="empty">Không có đơn phù hợp.</div>';
 }
 async function loadOrders(silent=false){
  if(!state.ready||state.loading||document.hidden)return;state.loading=true;
  try{state.orders=(await api('/api/v1/staff/orders')).orders;drawOrders();if(!silent)message('Đã cập nhật đơn hàng.')}
  catch(e){message(e.message,true);if(e.status===401||e.status===403)location.replace('/login')}
  finally{state.loading=false}
 }
 $('menu').addEventListener('click',e=>{
  // Both tapping the item card and pressing + add one portion; - removes one.
  const btn=e.target.closest('button[data-id]');if(!btn||btn.disabled||state.saving)return;
  const id=btn.dataset.id,m=state.menu.find(x=>x.id===id);if(!m)return;
  const old=state.cart.get(id)||0,next=Math.max(0,old+Number(btn.dataset.step));
  const all=[...state.cart.values()].reduce((a,b)=>a+b,0)-old+next;
  if(next>20||next>Number(m.available_quantity)||all>60)return;
  if(next)state.cart.set(id,next);else state.cart.delete(id);
  state.requestId=null;staffPresence.ordered=false;drawMenu();queuePresence();
 });
 $('search').addEventListener('input',()=>{staffPresence.ordered=false;drawMenu();queuePresence()});
 $('table').addEventListener('change',()=>{state.requestId=null;staffPresence.ordered=false;drawCart();queuePresence()});
 $('payment').addEventListener('change',()=>{state.requestId=null});
 $('note').addEventListener('input',()=>{state.requestId=null});
 $('orderForm').addEventListener('submit',async e=>{
  e.preventDefault();if(state.saving||!state.cart.size)return;
  const table=state.tables.find(t=>t.id===$('table').value);if(!table){message('Chọn bàn trước khi gọi món.',true);return}
  const body={token:table.token,requestId:state.requestId||crypto.randomUUID(),paymentMethod:$('payment').value,note:$('note').value.trim(),items:[...state.cart].map(([id,qty])=>({id,qty}))};
  state.requestId=body.requestId;state.saving=true;drawCart();void pulsePresence();
  try{const result=await api('/api/v1/staff/orders',{method:'POST',body:JSON.stringify(body)});
   state.cart.clear();staffPresence.ordered=true;state.requestId=null;$('note').value='';$('search').value='';
   message('Đã gửi đơn #'+result.id.slice(0,8)+' đến Bếp/Bar.');
   await loadCatalog();await loadOrders(true);
  }catch(error){message(error.message,true);if(error.status===409){state.requestId=null;try{await loadCatalog()}catch{}}}
  finally{state.saving=false;drawMenu();queuePresence()}
 });
 $('orders').addEventListener('click',async e=>{
  const line=e.target.closest('button[data-line]');
  if(line){
   if(line.dataset.next==='cancelled'&&!confirm('Hủy món chưa chế biến? Hệ thống sẽ hoàn lại tồn kho.'))return;
   line.disabled=true;try{await api('/api/v1/order-items/'+encodeURIComponent(line.dataset.line),{method:'PATCH',body:JSON.stringify({status:line.dataset.next})});await loadOrders(true);message('Đã cập nhật món.')}catch(error){message(error.message,true)}finally{line.disabled=false}return;
  }
  const pay=e.target.closest('button[data-pay]');if(!pay||!canPay())return;
  const o=state.orders.find(o=>o.id===pay.dataset.pay);if(!o)return;
  let method=o.payment_method;
  if(!['cash','bank_transfer'].includes(method)){method=prompt('Đơn cũ: nhập cash hoặc bank_transfer','cash');if(!['cash','bank_transfer'].includes(method))return}
  if(!confirm('Xác nhận đã nhận đủ '+money(o.total_vnd)+' bằng '+(method==='cash'?'tiền mặt':'chuyển khoản')+'?'))return;
  pay.disabled=true;paymentFeedback(o.id,'Đang ghi nhận thanh toán…');
  try{
   const result=await api('/api/v1/staff/orders/'+encodeURIComponent(o.id)+'/payment-confirmations',{method:'POST',body:JSON.stringify({confirm:true,paymentMethod:method})});
   // The background 5s poll may be in flight; update the visible state immediately.
   o.payment_status='paid';o.paid_amount=result.payment.amount;o.paid_at=new Date().toISOString();
   drawOrders();
   const success=result.payment.already?'Đơn này đã được xác nhận trước đó.':'Đã ghi nhận '+money(result.payment.amount)+' thành công.';
   paymentFeedback(o.id,success);
   message('Đã xác nhận thu tiền đơn #'+o.id.slice(0,8)+'.');
   await loadOrders(true);
  }catch(error){
   paymentFeedback(o.id,'Không xác nhận được: '+error.message,true);
   message('Đơn #'+o.id.slice(0,8)+': '+error.message,true);
  }finally{pay.disabled=false}
 });
 $('filter').addEventListener('input',drawOrders);
 $('status').addEventListener('change',drawOrders);
 $('reload').addEventListener('click',()=>loadOrders());
 $('logout').addEventListener('click',async()=>{leavePresence();try{await api('/api/v1/sessions/logout',{method:'POST',body:'{}'})}finally{location.replace('/login')}});
 (async()=>{
  try{
   const me=await api('/api/v1/session');
   if(!me.staff){$('gate').textContent='Bạn cần đăng nhập trước. Mở trang Nhân viên để tiếp tục.';return}
   if(me.workArea||!['admin','waiter','cashier','manager'].includes(me.role)){$('gate').textContent='Vai trò này không có quyền gọi món. Quay lại màn hình Bếp hoặc khu vực được giao.';return}
   state.role=me.role;$('employeeName').textContent=me.displayName||me.username||'Chủ cửa hàng';
   $('gate').hidden=true;$('app').hidden=false;await loadCatalog();state.ready=true;void pulsePresence();await loadOrders(true);
   message(canPay()?'Sẵn sàng gọi món và xác nhận thanh toán theo quyền.':'Sẵn sàng gọi món. Tài khoản Phục vụ không có quyền nhấn Đã nhận tiền; hãy dùng tài khoản Thu ngân / Quản lý để xác nhận thu tiền.');
  }catch(error){message(error.message,true);$('gate').textContent='Không kết nối được hoặc phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'}
 })();
 setInterval(()=>{if(!document.hidden)loadOrders(true)},5000);
 staffPresence.timer=setInterval(()=>{if(!document.hidden)void pulsePresence()},15000);
 window.addEventListener('pagehide',leavePresence);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)leavePresence();else{loadOrders(true);void pulsePresence()}});
})();