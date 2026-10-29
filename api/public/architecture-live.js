(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const time=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'—'};
 const shortId=id=>String(id||'').slice(0,8).toUpperCase();
 let source=null,fallbackTimer=null,retryTimer=null,data=null,selected=null,pinned=true,seenCursor='0',loaded=false,inFlight=false;
 const current=()=>data?.orders?.find(o=>o.id===selected);
 const events=()=>data?.events?.filter(e=>e.orderId===selected)||[];
 const getState=o=>{
  const rows=o.items||[];
  if(!rows.length)return 'Đang ghi nhận';
  if(rows.every(x=>x.status==='cancelled'))return 'Đã hủy';
  if(rows.every(x=>x.status==='served'||x.status==='cancelled'))return 'Đã phục vụ';
  if(rows.some(x=>x.status==='preparing'))return 'Đang chế biến';
  if(rows.some(x=>x.status==='ready'))return 'Món đã sẵn sàng';
  return 'Chờ bếp / Bar';
 };
 const statusClass=o=>getState(o)==='Đã phục vụ'?'done':getState(o)==='Đã hủy'?'cancel':getState(o)==='Đang chế biến'?'busy':getState(o)==='Món đã sẵn sàng'?'ready':'waiting';
 const changeConnection=(state,label)=>{
  const el=$('liveConnection');
  el.className='live-connection '+state;
  el.innerHTML='<span class="live-connection-dot" aria-hidden="true"></span>'+escape(label);
 };
 function paintList(){
  const orders=data?.orders||[];
  $('liveOrderCount').textContent=orders.length+' đơn gần đây';
  $('liveOrderList').innerHTML=orders.length?orders.map(o=>
   '<button type="button" role="option" class="live-order-option '+(o.id===selected?'selected':'')+'" data-order="'+escape(o.id)+'" aria-selected="'+String(o.id===selected)+'">'+
   '<span class="live-order-option-row"><strong>'+escape(o.tableName)+'</strong><span class="live-order-mini '+statusClass(o)+'">'+escape(getState(o))+'</span></span>'+
   '<span class="live-order-option-sub">'+(o.source==='staff'?'Nhân viên':o.source==='guest'?'QR khách':'Không rõ nguồn')+' · #'+escape(shortId(o.id))+' · '+escape(time(o.createdAt))+'</span>'+
   '<span class="live-order-option-qty">'+(o.items||[]).reduce((sum,x)=>sum+Number(x.quantity||0),0)+' món</span></button>'
  ).join(''):'<div class="live-order-empty">Chưa có đơn QR hoặc nhân viên nào trong 24 giờ qua hoặc đang xử lý.<small>Đơn mới sẽ tự xuất hiện sau khi được lưu thành công.</small></div>';
 }
 const actionLabel=e=>({
  order_validated:'API đã kiểm tra đơn hợp lệ',
  inventory_checked:'Đã xử lý quy tắc kho',
  order_created:'Đã lưu đơn vào PostgreSQL',
  payment_confirmed:'Nhân viên xác nhận thanh toán'
 })[e.action]||({
  preparing:'Bếp / Bar bắt đầu chế biến',
  ready:'Bếp / Bar báo món sẵn sàng',
  served:'Món đã phục vụ',
  cancelled:'Đã hủy món'
 })[e.to]||'Đã cập nhật trạng thái món';
 const actionStage=e=>({
  order_validated:'http',inventory_checked:'inventory',order_created:'postgres',
  payment_confirmed:'finance'
 })[e.action]||(e.action==='item_status_changed'?'kds':'audit');
 function paintDetail(){
  const o=current();
  if(!o){$('liveOrderDetail').innerHTML='<div class="live-order-empty">Tất cả luồng vẫn đang được theo dõi. Chọn một đơn để xem chi tiết riêng.</div>';highlight([]);return}
  const audit=events(),stages=[
   ['order_validated','API kiểm tra yêu cầu'],
   ['inventory_checked','Xử lý quy tắc tồn kho'],
   ['order_created','Lưu đơn thành công'],
   ['item_status_changed','Bếp / Bar cập nhật món']
  ];
  const observed=audit.map(x=>x.action);
  const bar=stages.map(([action,label],index)=>{
   const done=observed.includes(action);
   return '<span class="live-flow-stage '+(done?'observed':'pending')+'"><span class="live-flow-stage-mark">'+(done?'✓':String(index+1))+'</span><small>'+escape(label)+'</small></span>';
  }).join('');
  const names=(o.items||[]).map(x=>
   '<div class="live-order-food"><span>'+escape(x.name)+' <small>× '+escape(x.quantity)+'</small></span><span class="live-order-food-status">'+escape(({new:'Chờ',preparing:'Đang làm',ready:'Sẵn sàng',served:'Đã phục vụ',cancelled:'Đã hủy'})[x.status]||x.status)+'</span></div>'
  ).join('');
  const timeline=audit.map(e=>
   '<li class="live-timeline-event"><span class="live-timeline-dot"></span><div><strong>'+escape(actionLabel(e))+'</strong>'+
   (e.itemName?'<p>'+escape(e.itemName)+'</p>':'')+
   '<time>'+escape(time(e.at))+'</time></div></li>'
  ).join('')||'<li class="live-timeline-missing">Đang chờ sự kiện audit được lưu. Không suy diễn trạng thái thành công khi chưa có bản ghi.</li>';
  $('liveOrderDetail').innerHTML='<div class="live-order-detail-top"><div><p class="live-order-detail-kicker">'+(o.source==='staff'?'ĐƠN NHÂN VIÊN':o.source==='guest'?'ĐƠN KHÁCH QR':'ĐƠN CHƯA RÕ NGUỒN')+' / '+escape(shortId(o.id))+'</p>'+
   '<h3>'+escape(o.tableName)+'</h3><small>Nhận đơn: '+escape(time(o.createdAt))+'</small></div>'+
   '<span class="live-order-state '+statusClass(o)+'">'+escape(getState(o))+'</span></div>'+
   '<div class="live-flow-stages">'+bar+'</div>'+
   '<div class="live-detail-columns"><div><h4>Danh sách món</h4>'+names+'</div><div><h4>Nhật ký sự kiện</h4><ol class="live-timeline">'+timeline+'</ol></div></div>'+
   '<div class="live-order-detail-foot">Nguồn: dining_audit và dining_order_lines · các mốc trong cùng transaction chỉ hiển thị sau COMMIT.</div>';
  highlight(audit);
 }
 function highlight(audit){
  const origin=current()?.source;
  const roots=new Set(['http','orders']);
  if(origin==='staff'){roots.add('stafforder');roots.add('auth')}
  if(origin==='guest')roots.add('guest');
  for(const e of audit){
   const stage=actionStage(e);
   roots.add(stage);
   if(stage==='kds')roots.add('audit');
  }
  if(audit.some(e=>e.action==='order_created'))roots.add('postgres');
  for(const el of document.querySelectorAll('#archNodes [data-arch-node]'))
   el.classList.toggle('arch-live-node-active',Boolean(selected&&roots.has(el.dataset.archNode)));
  const connections=new Set(['orders-postgres']);
  if(origin==='staff'){connections.add('stafforder-http');connections.add('http-auth');connections.add('auth-orders')}
  if(origin==='guest'){connections.add('guest-http');connections.add('http-orders')}
  if(roots.has('inventory'))connections.add('orders-inventory');
  if(roots.has('kds')){connections.add('orders-kds');connections.add('kds-postgres')}
  if(roots.has('audit'))connections.add('postgres-audit');
  for(const el of document.querySelectorAll('#archEdges [data-arch-edge]')){
   el.classList.toggle('arch-live-wire-active',Boolean(selected&&connections.has(el.dataset.archEdge)));
  }
 }
 function consume(next){
  if(!next||!Array.isArray(next.orders)||!Array.isArray(next.events))return;
  const first=next.orders[0]?.id||null;
  if(!pinned&&(first!==selected||!selected))selected=first;
  else if(selected&&!next.orders.some(x=>x.id===selected))selected=null;
  const different=String(next.cursor)!==seenCursor;
  data=next;seenCursor=String(next.cursor||'0');
  paintList();paintDetail();
  if(different&&loaded){$('liveLastEvent').textContent='Sự kiện PostgreSQL mới: '+time(next.checkedAt)}
  else $('liveLastEvent').textContent='Đồng bộ lúc '+time(next.checkedAt);
  loaded=true;
 }
 async function reload(){
  if(inFlight||document.hidden)return;
  inFlight=true;
  try{
   const response=await fetch('/api/v1/management/architecture/recent',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
   if(response.status===401||response.status===403){disconnect();changeConnection('offline','Cần đăng nhập lại');return}
   if(!response.ok)throw Error('HTTP '+response.status);
   consume(await response.json());
  }catch{changeConnection('offline','Kết nối gián đoạn · đang thử lại')}
  finally{inFlight=false}
 }
 function startFallback(){
  if(fallbackTimer)return;
  changeConnection('fallback','Đang đồng bộ dự phòng · 5 giây');
  fallbackTimer=setInterval(()=>{void reload()},5000);
  void reload();
 }
 function stopFallback(){if(fallbackTimer){clearInterval(fallbackTimer);fallbackTimer=null}}
 function connect(){
  if(source||document.hidden||!window.EventSource)return startFallback();
  const stream=new EventSource('/api/v1/management/architecture/live',{withCredentials:true});
  source=stream;
  stream.addEventListener('open',()=>{stopFallback();changeConnection('connected','Đang nhận trực tiếp · SSE')});
  stream.addEventListener('snapshot',event=>{
   try{consume(JSON.parse(event.data))}catch{changeConnection('offline','Dữ liệu sự kiện không hợp lệ')}
  });
  stream.addEventListener('offline',()=>{changeConnection('offline','Không truy vấn được PostgreSQL');startFallback()});
  stream.onerror=()=>{changeConnection('fallback','Đang kết nối lại');startFallback()};
 }
 function disconnect(){
  if(source){source.close();source=null}stopFallback();
 }
 $('liveFollowNewest').setAttribute('aria-pressed','false');
 $('liveOrderList').addEventListener('click',event=>{
  const btn=event.target.closest('[data-order]');
  if(!btn||!data)return;
  selected=btn.dataset.order;pinned=true;
  $('liveFollowNewest').setAttribute('aria-pressed','false');
  paintList();paintDetail();
 });
 $('liveFollowNewest').addEventListener('click',()=>{
  pinned=false;selected=data?.orders?.[0]?.id||null;
  $('liveFollowNewest').setAttribute('aria-pressed','true');
  paintList();paintDetail();
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){disconnect();changeConnection('offline','Tạm dừng khi ẩn trang')}
  else{void reload();connect()}
 });
 window.addEventListener('beforeunload',disconnect);
 // The API remains protected on the server; the event source is only opened after an admin check.
 (async()=>{
  try{
   const r=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});
   const me=await r.json();
   if(!r.ok||me.role!=='admin'){changeConnection('offline','Chỉ chủ cửa hàng');return}
   await reload();connect();
  }catch{changeConnection('offline','Không xác thực được tài khoản')}
 })();
})();
