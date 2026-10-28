(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const W=1630,H=790;
 const services={
  guest:{name:'Khách / QR',tag:'CLIENT',kind:'client',summary:'Khách dùng trình duyệt mở link bàn từ QR để xem món và gửi order.',paths:['/t/:token','GET /api/menu/:token','POST /api/orders'],steps:['Trình duyệt đọc QR trên bàn và nhận token của bàn','Tải thực đơn qua API và gửi requestId cùng món đã chọn','Backend kiểm tra token, món và số lượng; khách không có quyền truy cập các API quản trị'],tables:[]},
  cart:{name:'Đang chọn món · Giỏ QR',tag:'BROWSER CART',kind:'client',summary:'Theo dõi các phiên QR có món trong giỏ trên điện thoại trước khi khách xác nhận. Dữ liệu trạng thái do trình duyệt báo về và chỉ giữ tạm trong RAM.',paths:['api/public/guest.js → cart Map','window.saleshubQrActivity()','POST /api/qr/presence','api/qr-presence.js'],steps:['Khách mở thực đơn, phiên được ghi nhận là đang xem','Khi thay đổi giỏ, frontend gửi trạng thái selecting và tổng số phần','Backend thống kê số phiên đang chọn và số phần tạm theo từng bàn, không lưu giỏ vào PostgreSQL','Khách bấm xác nhận: chuyển sang submitting; backend xử lý POST /api/orders riêng','Chỉ sau khi HTTP trả thành công mới ghi nhận ordered trên phiên; số đơn đã lưu nằm trong PostgreSQL','Khi khách rời trang, thông tin tạm tự hết hạn sau khoảng 55 giây'],tables:['process memory: qrPresence (tạm)']},
  staff:{name:'Nhân viên / Bếp / Bar',tag:'STAFF',kind:'client',summary:'Giao diện nội bộ dành cho các vai trò theo tài khoản và khu vực.',paths:['/staff','/staff/lockers','GET /api/kds','GET /api/lockers'],steps:['Đăng nhập và nhận cookie phiên HttpOnly','Backend kiểm tra role / work_area tại mỗi request','Nhân viên bếp/bar đổi trạng thái món; khu vực thiết bị xử lý phao và tủ'],tables:[]},
  owner:{name:'Chủ cửa hàng',tag:'OWNER',kind:'client',summary:'Điều hành toàn bộ hệ thống qua giao diện quản trị; dữ liệu giám sát chỉ chủ cửa hàng mới được đọc.',paths:['/admin','/admin/architecture','/admin/inventory','/admin/operations'],steps:['Xác thực chủ qua session HMAC và dữ liệu owner_accounts','Truy cập API quản trị và số liệu tổng hợp','Xem sự kiện DB đã commit và telemetry API đã chuẩn hóa trên bản đồ'],tables:['owner_accounts']},
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
  {id:'guest',label:'Khách gọi món',subtitle:'QR / trình duyệt',kind:'client',x:25,y:100,w:190},
   {id:'cart',label:'Đang chọn món',subtitle:'Giỏ hàng · trước đặt đơn',kind:'client',x:25,y:230,w:190},
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
  ['guest','http','orders'],['guest','cart','orders'],['cart','http','orders'],['staff','http','kds'],['owner','http','admin'],['http','validate','access'],
  ['http','auth','access'],['validate','orders','orders'],['auth','kds','kds'],['auth','inventory','inventory'],
  ['auth','finance','finance'],['auth','rental','rental'],['auth','admin','admin'],
  ['orders','inventory','orders'],['orders','kds','orders'],
  ['orders','tx','orders'],['kds','tx','kds'],['inventory','tx','inventory'],['finance','tx','finance'],
  ['rental','tx','rental'],['admin','tx','admin'],['tx','pg','database'],['pg','audit','database'],
  ['audit','stream','observe'],['stream','app','observe'],['owner','app','observe']
 ];
 const filters=[['all','Tất cả'],['orders','QR Order'],['cart','Đang chọn món'],['kds','Bếp / Bar'],['inventory','Kho'],['finance','Thu–chi'],['rental','Phao & Tủ'],['admin','Quản trị'],['access','API / Quyền'],['database','PostgreSQL'],['observe','Giám sát']];
 const colors={client:'#53c8ed',gateway:'#5fe0ad',module:'#f6c74f',database:'#a998ff',observe:'#ffa361'};
 let selected='orders',filter='all',scale=1,source=null,timer=null,last=null,view='events',followLive=true,focusedTrace=null,hasSnapshot=false;
 function node(id){return nodes.find(n=>n.id===id)}
 const nameFor=id=>services[id]?.name||node(id)?.label||id;
 function line(a,b){
  const from=node(a),to=node(b);if(!from||!to)return '';
  let x1=from.x+from.w,y1=from.y+42,x2=to.x,y2=to.y+42;
  if(x2<=x1){x1=from.x+from.w/2;y1=from.y+86;x2=to.x+to.w/2;y2=to.y;return 'M'+x1+' '+y1+' C'+x1+' '+(y1+48)+' '+x2+' '+(y2-48)+' '+x2+' '+y2}
  const d=Math.max(24,(x2-x1)*.45);return 'M'+x1+' '+y1+' C'+(x1+d)+' '+y1+' '+(x2-d)+' '+y2+' '+x2+' '+y2
 }
 function renderGraph(){
  $('deepNodes').innerHTML=nodes.map(n=>'<button type="button" class="deep-node deep-'+escape(n.kind)+'" data-id="'+escape(n.id)+'" style="left:'+n.x+'px;top:'+n.y+'px;width:'+n.w+'px;--nodecolor:'+colors[n.kind]+'" aria-pressed="false"><span class="deep-node-top"><span class="deep-node-light"></span><strong>'+escape(n.label)+'</strong></span><span class="deep-node-desc">'+escape(n.subtitle)+'</span><span class="deep-node-end">'+escape(services[n.id]?.tag||n.kind.toUpperCase())+'</span><span class="deep-node-count" data-live-node="'+escape(n.id)+'">—</span><span class="deep-node-active" data-active-node="'+escape(n.id)+'" hidden></span></button>').join('');
  $('deepWires').innerHTML='<defs><marker id="deepArrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 2 L10 6 L1 10" fill="none" stroke="#90a3bd" stroke-width="1.3"/></marker></defs>'+edges.map(([a,b,f])=>'<path class="deep-edge" data-flow="'+f+'" data-src="'+a+'" data-dst="'+b+'" d="'+line(a,b)+'" marker-end="url(#deepArrow)"/>').join('');
  $('deepFilters').innerHTML=filters.map(([id,title])=>'<button type="button" data-flow="'+id+'" class="deep-filter">'+escape(title)+'</button>').join('');
  $('deepNodes').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b){followLive=false;updateFollow();select(b.dataset.id)}});
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
 function fit(){const width=$('deepViewport').clientWidth||1000;setScale(width<760?.7:Math.min(1,(width-18)/W))}
 function highlight(){
  document.querySelectorAll('#deepFilters [data-flow]').forEach(b=>b.classList.toggle('is-active',b.dataset.flow===filter));
  document.querySelectorAll('#deepNodes [data-id]').forEach(b=>{
   const id=b.dataset.id,selectedNow=id===selected;
   const traceNodes=new Set(currentTrace()?.steps?.map(x=>x.node)||[]);
   const isFlow=traceNodes.has(id)||filter==='all'||(filter==='orders'&&id==='cart')||id==='http'||id==='pg'||id==='tx'||id==='audit'||id==='stream'||id==='app'||id==='auth'||id==='validate'||id===filter;
   b.classList.toggle('is-muted',!isFlow);
   b.classList.toggle('is-selected',selectedNow);
   b.setAttribute('aria-pressed',String(selectedNow));
  });
  document.querySelectorAll('#deepWires [data-flow]').forEach(p=>{
   const traceNodes=new Set(currentTrace()?.steps?.map(x=>x.node)||[]);
   const inFlow=filter==='all'||(filter==='cart'&&(p.dataset.src==='cart'||p.dataset.dst==='cart'))||p.dataset.flow===filter||(traceNodes.has(p.dataset.src)&&traceNodes.has(p.dataset.dst));
   const related=p.dataset.src===selected||p.dataset.dst===selected;
   p.classList.toggle('is-muted',!inFlow);
   p.classList.toggle('is-selected',related&&inFlow);
  });
  updateTraceHighlights();
 }
 function select(id){
  if(!services[id])return;
  selected=id;highlight();
  const s=services[id];
  $('deepInspector').innerHTML='<div class="deep-inspect-meta"><span>'+escape(s.tag)+'</span><span>CHI TIẾT BACKEND</span></div><h3>'+escape(s.name)+'</h3><p>'+escape(s.summary)+'</p><h4>CÁC BƯỚC THỰC THI</h4><ol class="deep-step-list">'+s.steps.map((t,i)=>'<li><span>'+String(i+1).padStart(2,'0')+'</span><p>'+escape(t)+'</p></li>').join('')+'</ol><h4>API / FILE THỰC THI</h4><div class="deep-code-list">'+s.paths.map(p=>'<code>'+escape(p)+'</code>').join('')+'</div>'+(s.tables.length?'<h4>BẢNG / DỮ LIỆU</h4><div class="deep-code-list">'+s.tables.map(p=>'<code>'+escape(p)+'</code>').join('')+'</div>':'')+'<div class="deep-inspect-note">Sơ đồ mô tả luồng mã nguồn. Chỉ sự kiện trong bảng trực tiếp được chứng minh từ các bản ghi thực tế.</div>';
 }
 const clock=s=>{let d=new Date(s);return Number.isFinite(+d)?d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'};
 const domain={orders:'QR Order',kds:'Bếp / Bar',inventory:'Kho',finance:'Thu–chi',rental:'Phao / Tủ',admin:'Quản trị'};
 const metricIds={orders24h:'deepMetricOrders',ordersInProgress:'deepMetricInProgress',ordersPreparing:'deepMetricOrderPreparing',itemsWaiting:'deepMetricWaiting',itemsPreparing:'deepMetricPreparing',
  itemsReady:'deepMetricReady',stockMovements24h:'deepMetricStock'};
 const pretty=n=>n!==undefined&&n!==null&&Number.isFinite(Number(n))?new Intl.NumberFormat('vi-VN').format(Number(n)):'—';
 const traceAll=()=>[...(last?.active||[]),...(last?.traces||[])];
 const currentTrace=()=>traceAll().find(t=>t.id===focusedTrace);
 function renderQrPresence(){
  const state=last?.qrPresence;
  const count=state?.activeSessions;
  const tables=state?.activeTables;
  $('deepQrViewers').textContent=count==null?'—':pretty(count);
  $('deepQrTables').textContent=tables==null?'—':pretty(tables);
  $('deepQrSelecting').textContent=state?.selectingSessions==null?'—':pretty(state.selectingSessions);
  $('deepQrCartItems').textContent=state?.cartItems==null?'—':pretty(state.cartItems);
  $('deepQrSubmitting').textContent=state?.submittingSessions==null?'—':pretty(state.submittingSessions);
  const summary=$('deepQrSummary'),list=$('deepQrTableBreakdown');
  if(!state){
   summary.textContent='Đang kết nối dữ liệu QR';
   list.innerHTML='<span class="deep-qr-no-viewers">Chưa kết nối bộ đếm QR.</span>';
   return;
  }
  summary.textContent=pretty(count)+' phiên mở · '+pretty(state.selectingSessions||0)+' đang chọn · '+pretty(state.submittingSessions||0)+' đang gửi';
  const rows=state.tables||[];
  list.innerHTML=rows.length?rows.map(t=>
   '<div class="deep-qr-table-chip"><div class="deep-qr-table-main"><strong>'+escape(t.tableName)+'</strong><span>'+pretty(t.activeSessions)+' phiên mở</span></div>'+
   '<div class="deep-qr-table-stages"><span>'+pretty(t.viewingSessions||0)+' xem menu</span><span class="is-selecting">'+pretty(t.selectingSessions||0)+' chọn món</span>'+
   '<span class="is-cart">'+pretty(t.cartItems||0)+' phần trong giỏ</span><span class="is-submitting">'+pretty(t.submittingSessions||0)+' đang gửi</span>'+
   '<span>'+pretty(t.orderedSessions||0)+' đã nhận xác nhận</span></div></div>'
  ).join(''):'<span class="deep-qr-no-viewers">Hiện chưa có thiết bị đang mở thực đơn QR.</span>';
 }
 function renderMetrics(){
  const m=last?.metrics||{};
  for(const [key,id] of Object.entries(metricIds))$(id).textContent=last?.metrics?pretty(m[key]):'—';
  $('deepMetricActive').textContent=hasSnapshot?pretty(last?.inFlight??0):'—';
  renderQrPresence();
  const a=last?.active||[];
  const at=node=>a.filter(t=>t.steps?.at(-1)?.node===node).length;
  const values={
   guest:[last?.qrPresence?.activeSessions??null,'phiên QR mở'],
    cart:[last?.qrPresence?.selectingSessions??null,'đang chọn món'],
   staff:[a.filter(t=>['kds','rental'].includes(t.module)).length,'đang chạy'],
   owner:[a.filter(t=>['admin','finance','inventory'].includes(t.module)).length,'đang chạy'],
   http:[last?.inFlight||0,'đang chạy'],auth:[at('auth'),'đang xác thực'],validate:[at('validate'),'đang kiểm tra'],
   orders:[m.ordersInProgress,'đơn chưa xong'],kds:[m.itemsWaiting,'món chờ'],inventory:[m.stockMovements24h,'biến động / 24h'],
   finance:[m.financeEntries24h,'phiếu / 24h'],rental:[m.occupiedLockers,'tủ đang thuê'],
   admin:[a.filter(t=>t.module==='admin').length,'đang chạy'],tx:[at('tx'),'đang giao dịch'],
   pg:[at('pg'),'đang xử lý'],audit:[m.auditEvents24h,'audit / 24h'],
   stream:[last?.connectedOwners||0,'kết nối'],app:[last?.connectedOwners||0,'người xem']
  };
  document.querySelectorAll('#deepNodes [data-live-node]').forEach(b=>{
   const pair=values[b.dataset.liveNode];
   b.textContent=hasSnapshot&&pair?pretty(pair[0])+' · '+pair[1]:'— · chưa có số liệu';
  });
  document.querySelectorAll('#deepNodes [data-active-node]').forEach(b=>{const n=a.filter(t=>t.steps?.at(-1)?.node===b.dataset.activeNode).length;b.hidden=n===0;b.textContent=n+' LIVE';});
  // The cart is a browser-side step, not an HTTP trace; light it only when
  // real live QR sessions report selecting items.
  const cartNode=document.querySelector('#deepNodes [data-id="cart"]');
  if(cartNode)cartNode.classList.toggle('is-cart-live',Number(last?.qrPresence?.selectingSessions||0)>0);
 }
 function updateTraceHighlights(){
  // During auto-follow, the packet overlay owns progressive node/path highlights.
  // Do not illuminate the entire finished route before the viewer sees each stage.
  if(followLive){
   document.querySelectorAll('#deepNodes [data-id]').forEach(b=>{b.classList.remove('trace-visited','trace-current')});
   document.querySelectorAll('#deepWires [data-src]').forEach(e=>{e.classList.remove('trace-visited','trace-current')});
   return;
  }
  const t=currentTrace(),trail=t?.steps?.map(step=>step.node)||[];
  const seen=new Set(trail),cur=t?.state==='running'?trail.at(-1):null;
  document.querySelectorAll('#deepNodes [data-id]').forEach(b=>{
   b.classList.toggle('trace-visited',seen.has(b.dataset.id));
   b.classList.toggle('trace-current',cur===b.dataset.id);
  });
  document.querySelectorAll('#deepWires [data-src]').forEach(e=>{
   const visited=seen.has(e.dataset.src)&&seen.has(e.dataset.dst);
   e.classList.toggle('trace-visited',visited);
   e.classList.toggle('trace-current',visited&&e.dataset.dst===cur);
  });
  if(t?.steps?.length){
   const step=t.steps.at(-1);
   $('deepLivePath').textContent=(t.state==='running'?'ĐANG XỬ LÝ: ':'ĐÃ KẾT THÚC: ')+(domain[t.module]||t.module)+' · '+step.label+' · +'+pretty(step.elapsedMs)+' ms';
  }
 }
 function renderTraces(){
  const list=traceAll();
  $('deepTraceCount').textContent=(last?.inFlight||0)+' đang xử lý · '+(last?.traces?.length||0)+' đã kết thúc (RAM)';
  if(!list.length){
   $('deepTraceList').innerHTML='<p class="deep-empty">Chưa có request ghi dữ liệu kể từ lúc server khởi động.</p>';
   $('deepTraceSteps').innerHTML='<span>Hệ thống đang theo dõi request thật; không chạy mô phỏng khi không có dữ liệu.</span>';
   updateTraceHighlights();return;
  }
  if(!list.some(t=>t.id===focusedTrace))focusedTrace=list[0].id;
  $('deepTraceList').innerHTML=list.slice(0,14).map(t=>{
   const state=t.state==='running'?'Đang xử lý':t.state==='success'?'Hoàn tất':'Thất bại';
   const elapsed=t.durationMs??t.steps?.at(-1)?.elapsedMs??0;
   return '<button type="button" data-trace-id="'+escape(t.id)+'" class="deep-trace-item '+(focusedTrace===t.id?'is-focused':'')+'">'+
    '<span class="deep-trace-indicator '+escape(t.state)+'"></span><span class="deep-trace-name"><strong>'+escape(domain[t.module]||t.module)+'</strong><small>'+escape(t.method+' '+t.route)+'</small></span>'+
    '<span class="deep-trace-duration"><b>'+escape(state)+'</b><small>'+pretty(elapsed)+' ms</small></span></button>';
  }).join('');
  const t=currentTrace();if(!t)return;
  const state=t.readOnly?(t.state==='running'?'ĐANG ĐỌC DỮ LIỆU (KHÔNG CÓ COMMIT GHI)':t.state==='success'?'ĐỌC DỮ LIỆU HOÀN THÀNH':'YÊU CẦU ĐỌC THẤT BẠI'):(t.state==='running'?'CHƯA XÁC NHẬN COMMIT':t.state==='success'?'REQUEST ĐÃ HOÀN THÀNH':'REQUEST LỖI / CÓ THỂ ĐÃ ROLLBACK');
  $('deepTraceSteps').innerHTML='<span class="deep-trace-traceid">TRACE '+escape(t.id.slice(0,8).toUpperCase())+' · '+escape(state)+'</span>'+
   '<div class="deep-trace-chain">'+(t.steps||[]).map((step,i)=>'<div class="deep-trace-step '+(i===t.steps.length-1?'last':'')+'"><b>'+escape(step.node.toUpperCase())+'</b><span>'+escape(step.label)+'</span><time>+'+pretty(step.elapsedMs)+' ms</time></div>').join('')+'</div>'+
   (t.count!=null?'<div class="deep-trace-count">'+(t.readOnly?'Số mục đã truy vấn: ':'Số lượng món được xử lý: ')+'<strong>'+pretty(t.count)+'</strong></div>':'');
  updateTraceHighlights();
 }
 function traceUpdate(data){
  if(!data?.trace?.id)return;
  if(!last)last={events:[],requests:[],metrics:null,active:[],traces:[],inFlight:0,connectedOwners:0};
  hasSnapshot=true;
  const t=data.trace;
  last.active=(last.active||[]).filter(x=>x.id!==t.id);
  last.traces=(last.traces||[]).filter(x=>x.id!==t.id);
  if(t.state==='running')last.active.unshift(t);else last.traces.unshift(t);
  last.traces=last.traces.slice(0,40);last.inFlight=last.active.length;
  if(followLive){
   focusedTrace=t.id;filter=t.module;
   // The live path renderer lights up each actual stage in order. Keep the
   // inspector on the business module instead of jumping to the last stage.
   select(t.module);
  }
  renderMetrics();renderTraces();
  document.dispatchEvent(new CustomEvent('saleshub:trace',{detail:data}));
 }

 function updateFollow(){
  $('deepFollow').setAttribute('aria-pressed',String(followLive));
  $('deepFollow').textContent=followLive?'Theo dõi tự động: BẬT':'Theo dõi tự động: TẮT';
 }
 function receive(data){
  const previous=last;
  last=data;hasSnapshot=true;renderEvents();renderMetrics();renderTraces();
  document.dispatchEvent(new CustomEvent('saleshub:snapshot',{detail:data}));
  if(previous&&followLive&&!focusedTrace){
   const oldDb=new Set(previous.events.map(e=>e.id));
   const oldHttp=new Set(previous.requests.map(e=>e.id));
   const event=data.events.find(e=>!oldDb.has(e.id))||data.requests.find(e=>!oldHttp.has(e.id));
   if(event&&services[event.module]){
    filter=event.module;
    select(event.module);
    $('deepLivePath').textContent='Vừa xử lý: '+(domain[event.module]||event.module)+' · '+(event.action||event.method+' '+event.route)+' · '+clock(event.occurredAt);
   }
  }
 }
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
   receive(await r.json());
  }catch(e){setConnection('Không kết nối: '+e.message,false)}
 }
 function connect(){
  if(typeof EventSource==='undefined'){setConnection('Không hỗ trợ SSE · cập nhật 10s',false);timer=setInterval(fallback,10000);void fallback();return}
  source=new EventSource('/api/admin/architecture/system/live');
  source.addEventListener('system',e=>{try{receive(JSON.parse(e.data));setConnection('Đang kết nối SSE · dữ liệu thực',true);if(timer){clearInterval(timer);timer=null}}catch{}});
  source.addEventListener('trace',e=>{try{traceUpdate(JSON.parse(e.data))}catch{}});
  source.addEventListener('offline',()=>setConnection('DB tạm mất kết nối',false));
  source.onerror=()=>{
   setConnection('SSE gián đoạn · cập nhật qua API',false);
   if(!timer){timer=setInterval(fallback,10000);void fallback()}
   // EventSource handles automatic reconnect; fallback polling continues meanwhile.
  };
 }
 function init(){
  if(!$('deepStage'))return;
  renderGraph();select('orders');updateFollow();renderMetrics();
  $('deepTraceList').addEventListener('click',e=>{const el=e.target.closest('[data-trace-id]');if(!el)return;followLive=false;updateFollow();focusedTrace=el.dataset.traceId;const t=currentTrace();if(t){selected=t.steps?.at(-1)?.node||t.module;filter=t.module;select(selected);renderTraces()}});
  $('deepFollow').addEventListener('click',()=>{followLive=!followLive;updateFollow()});
  $('deepEventItems').addEventListener('click',e=>{const el=e.target.closest('[data-event-module]');if(el&&services[el.dataset.eventModule]){followLive=false;updateFollow();select(el.dataset.eventModule)}});
  document.querySelectorAll('[data-deep-event-view]').forEach(b=>b.addEventListener('click',()=>{
   view=b.dataset.deepEventView;document.querySelectorAll('[data-deep-event-view]').forEach(x=>x.classList.toggle('is-active',x===b));renderEvents()
  }));
  connect();
  window.addEventListener('pagehide',()=>{if(source)source.close();if(timer)clearInterval(timer)});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
