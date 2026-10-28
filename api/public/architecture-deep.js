(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const W=1630,H=790;
 const services={
  http:{name:'HTTP Router / Render',tag:'server.js',kind:'gateway',summary:'Node.js HTTP server trên Render. Nhận HTTPS, định tuyến request, trả JSON và phục vụ giao diện tĩnh.',paths:['api/server.js','api/static-files.js'],steps:['Nhận HTTP request qua web service Render','Kiểm tra same-origin và giới hạn tần suất theo nhóm endpoint','Định tuyến theo method + URL; không có API gateway riêng được xác minh','Trả HTTP status và response; ghi thời gian API vào bộ nhớ tiến trình'],tables:[]},
  auth:{name:'Session / RBAC / Khu vực',tag:'RBAC',kind:'gateway',summary:'Cookie phiên HttpOnly được xác minh ở server. Nhân viên có role và work_area; chủ cửa hàng có quyền riêng.',paths:['identity(req)','requireAuth(req,res)','requireAdmin(req,res)','api/area-access.js','api/staff-auth.js'],steps:['Đọc cookie phiên và kiểm tra chữ ký HMAC','Tra cứu tài khoản, auth_version và active khi cần','Phân quyền role; kiểm tra quyền khu vực equipment/restroom','Từ chối bằng HTTP 401/403 khi thiếu quyền, không tin vào role do frontend gửi'],tables:['staff_users','owner_accounts']},
  validate:{name:'Validation / Idempotency',tag:'INPUT',kind:'gateway',summary:'Xử lý JSON, kiểm tra tham số, định dạng, trùng requestId và giá tiền do server tính. Tùy module có các kiểm tra bổ sung.',paths:['api/server.js','api/operations.js','api/lockers.js','api/area-receipts.js'],steps:['Giới hạn kích thước và kiểm tra dữ liệu đầu vào','Kiểm tra QR token / item / quantity; kiểm tra các trạng thái hợp lệ','Dùng requestId và UNIQUE constraint để chống ghi trùng ở nghiệp vụ hỗ trợ','Giá tủ và phao được quyết định tại backend, không lấy giá từ trình duyệt'],tables:['dining_orders.request_id','finance_entries.request_id','locker_rentals.request_id']},
  orders:{name:'Order Engine',tag:'ORDER',kind:'module',summary:'Tạo đơn QR; chống gửi trùng, tạo từng món, gọi trừ tồn theo công thức, ghi audit và COMMIT trong một transaction.',paths:['POST /api/orders','api/server.js → placeOrder()','api/operations.js → consume()'],steps:['Kiểm tra token bàn, menu đang bán, số lượng, ghi chú và requestId','BEGIN; INSERT dining_orders có UNIQUE(table_id,request_id)','INSERT dining_order_lines, tạo nhật ký order_validated','consume(): đọc recipe, khóa hàng tồn bằng FOR UPDATE, trừ quantity, ghi movements','Ghi inventory_checked, order_created và cập nhật bàn occupied','COMMIT thành công mới gửi tín hiệu làm mới SSE; nếu lỗi ROLLBACK toàn bộ'],tables:['dining_orders','dining_order_lines','dining_tables','dining_audit','inventory_items','inventory_movements']},
  kds:{name:'Kitchen & Bar Engine',tag:'KDS',kind:'module',summary:'Phân danh sách món theo bếp/bar và trạng thái, bảo vệ quy tắc chuyển món, trả tồn khi hủy hợp lệ.',paths:['GET /api/kds','PATCH /api/items/:id','api/server.js → updateLine()','api/operations.js → restore()'],steps:['Xác minh vai trò và khu vực ăn uống','GET /api/kds lọc item theo station kitchen/bar','PATCH bắt buộc chuyển trạng thái new → preparing → ready → served (hoặc cancelled khi hợp lệ)','BEGIN, SELECT ... FOR UPDATE để chặn tranh chấp cập nhật','Nếu hủy món, khôi phục nguyên liệu theo movement đã tiêu thụ','INSERT dining_audit; COMMIT; KDS lần sau đọc trạng thái mới'],tables:['dining_order_lines','dining_audit','inventory_movements']},
  inventory:{name:'Inventory & Recipe Engine',tag:'STOCK',kind:'module',summary:'Nhập kho, xuất kho, cập nhật định mức, kiểm tra tồn và ghi lịch sử biến động theo từng giao dịch.',paths:['GET /api/admin/inventory','POST /api/admin/inventory/movements','PUT /api/admin/inventory/recipes','api/operations.js'],steps:['Xác thực chủ cửa hàng cho tác vụ quản trị kho','Kiểm tra loại biến động: purchase / opening / adjustment / consume / restore','BEGIN, khóa inventory_items FOR UPDATE, kiểm tra tồn không âm','UPDATE số lượng, INSERT inventory_movements trong cùng transaction','Nếu là purchase, INSERT finance_entries khoản chi nhập nguyên liệu','COMMIT; ngưỡng reorder_level hiển thị cảnh báo khi số lượng thấp'],tables:['inventory_items','inventory_recipes','inventory_movements','finance_entries']},
  finance:{name:'Finance & Payment Engine',tag:'LEDGER',kind:'module',summary:'Ghi thu–chi, xác nhận nhận tiền và tổng hợp nguồn tiền mà không cộng trùng doanh thu đơn với phiếu dịch vụ.',paths:['POST /api/admin/finance/entries','POST /api/admin/orders/:id/confirm-payment','GET /api/admin/analytics','api/finance-analytics.js'],steps:['Kiểm tra quyền chủ cửa hàng và giá trị số tiền hợp lệ','Ghi finance_entries cho thu/chi thủ công hoặc mua hàng, theo requestId','Với đơn ăn uống, xác nhận thanh toán riêng, cập nhật payment_status và paid_amount','Báo cáo tổng hợp đơn đã thanh toán + thu dịch vụ, trừ khoản chi','QR chuyển khoản là hướng dẫn chuyển tiền, không xác nhận tiền về tự động'],tables:['finance_entries','dining_orders','register_shifts','merchant_payment_settings']},
  rental:{name:'Phao & Tủ đồ Engine',tag:'RENTAL',kind:'module',summary:'Một khu vực nghiệp vụ cho nhân viên phụ trách phao và tủ A1–A30/B1–B30; thu theo giá server và ghi sổ.',paths:['POST /api/lockers/:code/rent','POST /api/lockers/:code/release','POST /api/area/receipts','api/lockers.js','api/area-receipts.js'],steps:['Kiểm tra quyền khu vực equipment và requestId','Thuê tủ: BEGIN, khóa tủ, đảm bảo chỉ 1 lượt thuê còn hiệu lực','Tủ 30.000đ; phao trẻ em / áo phao trẻ em 20.000đ, phao người lớn 30.000đ','INSERT locker_rentals / area_receipts / finance_entries, pos_audit cùng transaction','COMMIT mới ghi nhận thuê và doanh thu; trả tủ ghi ended_at, không tự thu tiền lần hai','Không xuất số điện thoại/tên khách vào sự kiện giám sát'],tables:['lockers','locker_rentals','area_receipts','float_receipt_details','finance_entries','pos_audit']},
  admin:{name:'Admin / Catalog Engine',tag:'CORE',kind:'module',summary:'Quản lý món, bàn, người dùng, ca thu ngân, nhà cung cấp và thay đổi quản trị. Không hiển thị chức năng đặt bàn trên UI.',paths:['/api/admin/core/*','/api/admin/users/*','api/core.js','api/staff-auth.js'],steps:['Xác thực chủ cửa hàng ở các API quản trị','Kiểm tra tính hợp lệ trước khi ghi danh mục và nhân sự','Ghi thay đổi qua các bảng nghiệp vụ, có pos_audit ở các thao tác hỗ trợ','Cập nhật mật khẩu / auth_version để thu hồi phiên khi cần','Frontend theo quyền không thay thế xác thực backend'],tables:['menu_items','dining_tables','staff_users','owner_accounts','pos_audit']},
  tx:{name:'PostgreSQL Transaction',tag:'ACID',kind:'database',summary:'Một cơ sở dữ liệu giao dịch dùng chung. Các module dùng BEGIN / COMMIT / ROLLBACK và khóa bản ghi khi cần.',paths:['pg Pool: max=5','api/server.js','api/operations.js','api/lockers.js'],steps:['Pool cấp kết nối cho tác vụ dữ liệu','BEGIN mở transaction cho thao tác nhiều bảng','SELECT ... FOR UPDATE khóa bản ghi khi tranh chấp tồn kho, tủ hay trạng thái món','UNIQUE và CHECK constraint bảo vệ dữ liệu','COMMIT ghi đồng thời các bảng; lỗi thì ROLLBACK','Không có queue/broker phân tán được chứng minh trong repo'],tables:['dining_*','inventory_*','finance_entries','locker_*']},
  pg:{name:'Neon PostgreSQL',tag:'DATA',kind:'database',summary:'Cơ sở dữ liệu PostgreSQL được kết nối qua DATABASE_URL. Dữ liệu thật nằm trong các bảng theo nghiệp vụ.',paths:['api/schema.sql','DATABASE_URL (chỉ cấu hình server)'],steps:['Lưu dữ liệu trong bảng có PRIMARY KEY / UNIQUE / FOREIGN KEY','Bảo đảm nhất quán ghi giao dịch theo transaction','Indexes phục vụ truy vấn đơn, audit, tồn và thuê tủ','API kiểm tra kết nối DB qua GET /api/health','Không đưa secret và thông tin khách hàng vào sơ đồ'],tables:['dining_orders','dining_order_lines','inventory_items','inventory_movements','finance_entries','locker_rentals','pos_audit']},
  audit:{name:'Business Audit / Event Read Model',tag:'AUDIT',kind:'observe',summary:'Đọc sự kiện đã commit từ các bảng audit và nghiệp vụ. Đây là sự kiện hệ thống thật, chưa phải distributed tracing cấp SQL.',paths:['api/system-flow.js','api/order-flow-live.js','GET /api/admin/architecture/system/recent'],steps:['SELECT từ dining_audit, inventory_movements, finance_entries, pos_audit, locker_rentals, area_receipts','Hợp nhất thành timeline 24 giờ, sắp xếp theo timestamp','Giới hạn 100 sự kiện, chỉ hiển thị module/hành động/nguồn','Không lấy tên khách, điện thoại, tài khoản ngân hàng hoặc raw request body','Sự kiện được xác nhận lưu DB; không suy diễn mọi bước nội bộ từ audit'],tables:['dining_audit','pos_audit','inventory_movements','finance_entries','locker_rentals','area_receipts']},
  stream:{name:'SSE / System Live Feed',tag:'LIVE',kind:'observe',summary:'SSE dành riêng cho chủ cửa hàng đẩy snapshot mới của các sự kiện DB và HTTP telemetry, có tự nối lại.',paths:['GET /api/admin/architecture/system/live','GET /api/admin/architecture/system/recent','api/system-flow.js'],steps:['Backend kiểm tra owner session trước khi mở SSE','SSE gửi snapshot PostgreSQL tối đa 4 giây/lần khi có người theo dõi','Kiểm tra lại quyền chủ định kỳ trên kết nối dài','HTTP telemetry đo status/latency trong bộ nhớ; mất khi Render restart','Frontend tự tải lại dữ liệu qua API khi SSE mất kết nối','Không phát hoạt ảnh giả khi không có sự kiện'],tables:['process memory (tạm)','PostgreSQL (bền vững)']},
  app:{name:'Owner Architecture Console',tag:'UI',kind:'observe',summary:'Trang giám sát chỉ cho chủ cửa hàng: bản đồ logic, trạng thái DB, sự kiện commit và truy cập API.',paths:['/admin/architecture','api/public/architecture.html','api/public/architecture-deep.js'],steps:['Chọn luồng xử lý muốn xem trên bản đồ','Nhấp một node để xem trình tự xử lý, API, file mã nguồn và bảng SQL','Theo dõi event DB đã commit và request HTTP theo từng module','Phân biệt dữ liệu lịch sử và telemetry trong RAM','Không lộ thông tin khách hàng trong console'],tables:[]}
 };
 const nodes=[
  {id:'guest',label:'Khách gọi món',subtitle:'QR / trình duyệt',kind:'client',x:25,y:125,w:190},
  {id:'staff',label:'Nhân viên / Bếp',subtitle:'KDS / dịch vụ',kind:'client',x:25,y:350,w:190},
  {id:'owner',label:'Chủ cửa hàng',subtitle:'Quản trị / báo cáo',kind:'client',x:25,y:575,w:190},
  {id:'http',label:'Render · HTTP Router',subtitle:'server.js · API',kind:'gateway',x:265,y:285,w:215},
  {id:'auth',label:'Session & RBAC',subtitle:'HMAC / role / work area',kind:'gateway',x:265,y:450,w:215},
  {id:'validate',label:'Validation',subtitle:'requestId / giá server',kind:'gateway',x:265,y:125,w:215},
  {id:'orders',label:'Order Engine',subtitle:'QR · tạo đơn',kind:'module',x:545,y:77,w:220},
  {id:'kds',label:'Kitchen & Bar',subtitle:'state machine',kind:'module',x:545,y:187,w:220},
  {id:'inventory',label:'Inventory',subtitle:'công thức / movements',kind:'module',x:545,y:297,w:220},
  {id:'finance',label:'Finance & Payment',subtitle:'thu / chi / đối soát',kind:'module',x:545,y:407,w:220},
  {id:'rental',label:'Phao & Tủ đồ',subtitle:'rental / receipts',kind:'module',x:545,y:517,w:220},
  {id:'admin',label:'Admin Core',subtitle:'thực đơn / nhân sự',kind:'module',x:545,y:627,w:220},
  {id:'tx',label:'BEGIN / COMMIT',subtitle:'lock / rollback / ACID',kind:'database',x:845,y:235,w:210},
  {id:'pg',label:'PostgreSQL · Neon',subtitle:'DB schema / indexes',kind:'database',x:1110,y:235,w:210},
  {id:'audit',label:'Audit & Read Model',subtitle:'sự kiện đã COMMIT',kind:'observe',x:1110,y:465,w:210},
  {id:'stream',label:'SSE Live Feed',subtitle:'owner only / ~4s',kind:'observe',x:1370,y:295,w:210},
  {id:'app',label:'Architecture UI',subtitle:'event log / inspector',kind:'observe',x:1370,y:525,w:210}
 ];
 const edges=[
  ['guest','http','orders'],['staff','http','kds'],['owner','http','admin'],['http','validate','access'],
  ['http','auth','access'],['validate','orders','orders'],['auth','kds','kds'],['auth','inventory','inventory'],
  ['auth','finance','finance'],['auth','rental','rental'],['auth','admin','admin'],
  ['orders','inventory','orders'],['orders','kds','orders'],
  ['orders','tx','orders'],['kds','tx','kds'],['inventory','tx','inventory'],['finance','tx','finance'],
  ['rental','tx','rental'],['admin','tx','admin'],['tx','pg','database'],['pg','audit','database'],
  ['audit','stream','observe'],['stream','app','observe'],['owner','app','observe']
 ];
 const filters=[['all','Tất cả'],['orders','QR Order'],['kds','Bếp / Bar'],['inventory','Kho'],['finance','Thu–chi'],['rental','Phao & Tủ'],['admin','Quản trị'],['access','API / Quyền'],['database','PostgreSQL'],['observe','Giám sát']];
 const colors={client:'#53c8ed',gateway:'#5fe0ad',module:'#f6c74f',database:'#a998ff',observe:'#ffa361'};
 let selected='orders',filter='all',scale=1,source=null,timer=null,last=null,view='events';
 function node(id){return nodes.find(n=>n.id===id)}
 const nameFor=id=>services[id]?.name||node(id)?.label||id;
 function line(a,b){
  const from=node(a),to=node(b);if(!from||!to)return '';
  let x1=from.x+from.w,y1=from.y+42,x2=to.x,y2=to.y+42;
  if(x2<=x1){x1=from.x+from.w/2;y1=from.y+86;x2=to.x+to.w/2;y2=to.y;return 'M'+x1+' '+y1+' C'+x1+' '+(y1+48)+' '+x2+' '+(y2-48)+' '+x2+' '+y2}
  const d=Math.max(24,(x2-x1)*.45);return 'M'+x1+' '+y1+' C'+(x1+d)+' '+y1+' '+(x2-d)+' '+y2+' '+x2+' '+y2
 }
 function renderGraph(){
  $('deepNodes').innerHTML=nodes.map(n=>'<button type="button" class="deep-node deep-'+escape(n.kind)+'" data-id="'+escape(n.id)+'" style="left:'+n.x+'px;top:'+n.y+'px;width:'+n.w+'px;--nodecolor:'+colors[n.kind]+'" aria-pressed="false"><span class="deep-node-top"><span class="deep-node-light"></span><strong>'+escape(n.label)+'</strong></span><span class="deep-node-desc">'+escape(n.subtitle)+'</span><span class="deep-node-end">'+escape(services[n.id]?.tag||n.kind.toUpperCase())+'</span></button>').join('');
  $('deepWires').innerHTML='<defs><marker id="deepArrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 2 L10 6 L1 10" fill="none" stroke="#90a3bd" stroke-width="1.3"/></marker></defs>'+edges.map(([a,b,f])=>'<path class="deep-edge" data-flow="'+f+'" data-src="'+a+'" data-dst="'+b+'" d="'+line(a,b)+'" marker-end="url(#deepArrow)"/>').join('');
  $('deepFilters').innerHTML=filters.map(([id,title])=>'<button type="button" data-flow="'+id+'" class="deep-filter">'+escape(title)+'</button>').join('');
  $('deepNodes').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)select(b.dataset.id)});
  $('deepFilters').addEventListener('click',e=>{const b=e.target.closest('[data-flow]');if(b){filter=b.dataset.flow;highlight()}});
  $('deepZoomOut').addEventListener('click',()=>setScale(scale-.1));
  $('deepZoomIn').addEventListener('click',()=>setScale(scale+.1));
  $('deepFit').addEventListener('click',fit);
  window.addEventListener('resize',fit);
  highlight();fit();
 }
 function setScale(s){
  scale=Math.min(1.2,Math.max(.40,Math.round(s*100)/100));
  $('deepStage').style.transform='scale('+scale+')';
  $('deepSizer').style.width=Math.round(W*scale)+'px';
  $('deepSizer').style.height=Math.round(H*scale)+'px';
  $('deepScale').textContent=Math.round(scale*100)+'%';
 }
 function fit(){const width=$('deepViewport').clientWidth||1000;setScale(Math.min(1,(width-18)/W))}
 function highlight(){
  document.querySelectorAll('#deepFilters [data-flow]').forEach(b=>b.classList.toggle('is-active',b.dataset.flow===filter));
  document.querySelectorAll('#deepNodes [data-id]').forEach(b=>{
   const id=b.dataset.id,selectedNow=id===selected;
   const isFlow=filter==='all'||id==='http'||id==='pg'||id==='tx'||id==='audit'||id==='stream'||id==='app'||id==='auth'||id==='validate'||id===filter;
   b.classList.toggle('is-muted',!isFlow);
   b.classList.toggle('is-selected',selectedNow);
   b.setAttribute('aria-pressed',String(selectedNow));
  });
  document.querySelectorAll('#deepWires [data-flow]').forEach(p=>{
   const inFlow=filter==='all'||p.dataset.flow===filter||p.dataset.flow==='database'&&filter==='all';
   const related=p.dataset.src===selected||p.dataset.dst===selected;
   p.classList.toggle('is-muted',!inFlow);
   p.classList.toggle('is-selected',related&&inFlow);
  });
 }
 function select(id){
  if(!services[id])return;
  selected=id;highlight();
  const s=services[id];
  $('deepInspector').innerHTML='<div class="deep-inspect-meta"><span>'+escape(s.tag)+'</span><span>CHI TIẾT BACKEND</span></div><h3>'+escape(s.name)+'</h3><p>'+escape(s.summary)+'</p><h4>CÁC BƯỚC THỰC THI</h4><ol class="deep-step-list">'+s.steps.map((t,i)=>'<li><span>'+String(i+1).padStart(2,'0')+'</span><p>'+escape(t)+'</p></li>').join('')+'</ol><h4>API / FILE THỰC THI</h4><div class="deep-code-list">'+s.paths.map(p=>'<code>'+escape(p)+'</code>').join('')+'</div>'+(s.tables.length?'<h4>BẢNG / DỮ LIỆU</h4><div class="deep-code-list">'+s.tables.map(p=>'<code>'+escape(p)+'</code>').join('')+'</div>':'')+'<div class="deep-inspect-note">Sơ đồ mô tả luồng mã nguồn. Chỉ sự kiện trong bảng trực tiếp được chứng minh từ các bản ghi thực tế.</div>';
 }
 const clock=s=>{let d=new Date(s);return Number.isFinite(+d)?d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'};
 const domain={orders:'QR Order',kds:'Bếp / Bar',inventory:'Kho',finance:'Thu–chi',rental:'Phao / Tủ',admin:'Quản trị'};
 function renderEvents(){
  if(!last)return;
  const list=view==='events'?last.events:last.requests;
  $('deepEventCount').textContent=(list?.length||0)+' sự kiện';
  $('deepEventItems').innerHTML=!list?.length?'<p class="deep-empty">Chưa có sự kiện được ghi nhận trong phạm vi dữ liệu hiện tại.</p>':list.slice(0,70).map(e=>{
   const action=view==='events'?e.action:(e.method+' '+e.route);
   const meta=view==='events'?e.source:('HTTP '+e.status+' · '+e.durationMs+' ms · RAM');
   return '<button type="button" class="deep-event" data-event-module="'+escape(e.module)+'"><span class="deep-event-dot" data-module="'+escape(e.module)+'"></span><span class="deep-event-main"><strong>'+escape(action)+'</strong><small>'+escape(domain[e.module]||e.module)+' · '+escape(meta)+'</small></span><time>'+escape(clock(e.occurredAt))+'</time></button>';
  }).join('');
  $('deepLastSync').textContent='Cập nhật '+clock(last.checkedAt)+' · DB events ≠ HTTP request trace';
 }
 function setConnection(text,ok){$('deepStreamStatus').textContent=text;$('deepStreamStatus').classList.toggle('online',!!ok)}
 async function fallback(){
  try{
   const r=await fetch('/api/admin/architecture/system/recent',{credentials:'same-origin',cache:'no-store'});
   if(!r.ok)throw Error('HTTP '+r.status);
   last=await r.json();renderEvents();
  }catch(e){setConnection('Không kết nối: '+e.message,false)}
 }
 function connect(){
  if(typeof EventSource==='undefined'){setConnection('Không hỗ trợ SSE · cập nhật 10s',false);timer=setInterval(fallback,10000);void fallback();return}
  source=new EventSource('/api/admin/architecture/system/live');
  source.addEventListener('system',e=>{try{last=JSON.parse(e.data);setConnection('Đang kết nối SSE · dữ liệu thực',true);renderEvents()}catch{}});
  source.addEventListener('offline',()=>setConnection('DB tạm mất kết nối',false));
  source.onerror=()=>{
   setConnection('SSE gián đoạn · cập nhật qua API',false);
   if(!timer){timer=setInterval(fallback,10000);void fallback()}
   source.close();source=null;
  };
 }
 function init(){
  if(!$('deepStage'))return;
  renderGraph();select('orders');
  $('deepEventItems').addEventListener('click',e=>{const el=e.target.closest('[data-event-module]');if(el&&services[el.dataset.eventModule])select(el.dataset.eventModule)});
  document.querySelectorAll('[data-deep-event-view]').forEach(b=>b.addEventListener('click',()=>{
   view=b.dataset.deepEventView;document.querySelectorAll('[data-deep-event-view]').forEach(x=>x.classList.toggle('is-active',x===b));renderEvents()
  }));
  connect();
  window.addEventListener('pagehide',()=>{if(source)source.close();if(timer)clearInterval(timer)});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
