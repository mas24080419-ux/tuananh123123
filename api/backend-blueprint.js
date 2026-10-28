'use strict';
// Read-only source-derived architecture blueprint. Never expose runtime env, credentials,
// customer records or phone numbers; the schema is parsed from this repository's SQL.
const fs=require('node:fs'),path=require('node:path');
function splitSqlColumns(body){
 const parts=[];let depth=0,quote=false,start=0;
 for(let i=0;i<body.length;i++){
  const ch=body[i];
  if(ch==="'"){if(quote&&body[i+1]==="'"){i++;continue}quote=!quote;continue}
  if(quote)continue;
  if(ch==='(')depth++;
  else if(ch===')')depth--;
  else if(ch===','&&depth===0){parts.push(body.slice(start,i).trim());start=i+1}
 }
 parts.push(body.slice(start).trim());return parts.filter(Boolean);
}
function column(def){
 const m=/^([a-z][a-z0-9_]*)\s+(uuid|text|integer|int|bigint|boolean|timestamptz|numeric\(\d+,\d+\)|varchar\(\d+\)|jsonb)(?=\s|$)/i.exec(def);
 if(!m)return null;
 const ref=/\bREFERENCES\s+([a-z_]+)\(([a-z_]+)\)/i.exec(def);
 return {name:m[1],type:m[2].toLowerCase(),pk:/\bPRIMARY KEY\b/i.test(def),unique:/\bUNIQUE\b/i.test(def),
  required:/\bNOT NULL\b/i.test(def),references:ref?{table:ref[1],column:ref[2]}:null};
}
const domain=name=>/^dining_|^menu_items$/.test(name)?'dining':/^inventory_/.test(name)?'stock':
 /^finance_|^merchant_payment/.test(name)?'finance':/^lockers$|^locker_|^area_receipts$|^float_receipt/.test(name)?'rental':
 /^staff_users$|^owner_accounts$/.test(name)?'access':/^pos_audit$/.test(name)?'audit':'legacy';
const legacy=new Set(['suppliers','customers','table_reservations','register_shifts']);
function schemaModel(sql){
 const tables=[],map=new Map(),relations=[];
 const ddl=/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/g;
 for(const m of sql.matchAll(ddl)){
  const table={name:m[1],domain:domain(m[1]),legacy:legacy.has(m[1]),columns:[],indexes:[],constraints:[]};
  for(const def of splitSqlColumns(m[2])){
   const col=column(def);if(col)table.columns.push(col);
   else if(/^(PRIMARY KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(def))table.constraints.push(def.replace(/\s+/g,' ').slice(0,160));
  }
  tables.push(table);map.set(table.name,table);
 }
 for(const m of sql.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN IF NOT EXISTS\s+([\s\S]*?);/gi)){
  const table=map.get(m[1]);if(!table)continue;
  const col=column(m[2].replace(/\s+/g,' '));
  if(col&&!table.columns.some(x=>x.name===col.name))table.columns.push(col);
 }
 for(const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX IF NOT EXISTS\s+([a-z0-9_]+)\s+ON\s+([a-z_]+)\s*\(([\s\S]*?)\)\s*(?:WHERE[^;]+)?;/gi)){
  const table=map.get(m[3]);
  if(table)table.indexes.push({name:m[2],unique:Boolean(m[1])});
 }
 for(const t of tables)for(const c of t.columns)if(c.references){
  relations.push({from:t.name,column:c.name,to:c.references.table,targetColumn:c.references.column,kind:'FK'});
 }
 return {tables,relations,tableCount:tables.length,relationCount:relations.length,
  warning:'Danh sách lấy từ schema.sql, không phải kiểm tra toàn bộ bảng runtime. Bảng cũ được gắn nhãn legacy; mật khẩu, dữ liệu khách hàng và nội dung bản ghi không được xuất ra.'};
}
// Exact code paths and boundaries; a node is a logical step, not a separate deployed service.
const blocks=[
 ['qr','QR tại bàn','client','orders','/t/:token','Khách mở trang thực đơn bằng token bàn',0,0],
 ['guestcart','Giỏ khách (RAM)','client','orders','POST /api/qr/presence','Chọn món trước khi gửi; không trừ kho',0,1],
 ['staffui','App nhân viên','client','stafforder','/staff/orders','Phục vụ, thu ngân, quản lý gọi món',0,2],
 ['staffcart','Giỏ nhân viên (RAM)','client','stafforder','POST /api/staff/order-presence','Phiên chọn món xác thực, chưa phải đơn',0,3],
 ['kitchenui','Màn hình Bếp / Bar','client','kds','/staff?kds=1','Nhận và thay đổi trạng thái từng món',0,4],
 ['lockerui','Nhân viên phao / tủ','client','rental','/staff/lockers','Thuê tủ/phao và dịch vụ khu vực',0,5],
 ['ownerui','Chủ cửa hàng','client','admin','/admin','Quản lý tổng thể, báo cáo, sơ đồ',0,6],
 ['router','Render + HTTP Router','gateway','all','api/server.js','Một tiến trình Node.js phục vụ web và API',1,0],
 ['origin','Same Origin & giới hạn','gateway','access','sameOrigin() · throttle()','Kiểm tra origin, nhóm giới hạn theo IP',1,1],
 ['auth','Cookie HMAC / RBAC','gateway','access','identity() · requireAuth()','Phiên HMAC, active, auth_version, work_area',1,2],
 ['validate','Input / Token / Giá','gateway','orders','input() · placeOrder()','Giá lấy server; token bàn, món, số lượng',1,3],
 ['staffperm','Quyền xử lý món','gateway','stafforder','staff-order-permissions.js','Quyền gọi món, cập nhật và thu tiền riêng biệt',1,4],
 ['presence','Presence QR + NV','runtime','observe','qr-presence.js · staff-order-presence.js','Phiên tạm RAM và TTL, không phải đơn',2,0],
 ['orderengine','Order Engine','module','orders','placeOrder() · POST /api/orders','QR và nhân viên dùng chung nghiệp vụ',2,1],
 ['dedupe','Idempotency','module','orders','UNIQUE(table_id,request_id)','Không tạo đơn trùng khi gửi lại',2,2],
 ['recipe','Công thức món','module','stock','operations.js → consume()','Gộp lượng nguyên liệu cho từng đơn',2,3],
 ['kds','KDS & trạng thái món','module','kds','GET /api/kds · PATCH /api/items/:id','new → preparing → ready → served; hủy có điều kiện',2,4],
 ['payment','Xác nhận thanh toán','module','finance','POST /api/staff/orders/:id/confirm-payment','Chỉ vai trò được cấp; không tự xác nhận QR bank',2,5],
 ['rental','Phao / Tủ / Tắm','module','rental','lockers.js · area-receipts.js','Giá server, khóa tủ, phiếu dịch vụ',2,6],
 ['admin','Danh mục / Nhân sự','module','admin','core.js · staff-auth.js','Quản lý món, bàn, người dùng',2,7],
 ['begin','BEGIN / Pool','tx','orders','pg Pool max=5','Mượn kết nối và mở transaction',3,0],
 ['insertorder','Ghi đơn & dòng món','tx','orders','dining_orders / dining_order_lines','Ghi theo lô, vẫn chưa COMMIT',3,1],
 ['stocklock','FOR UPDATE tồn kho','tx','stock','inventory_items FOR UPDATE','Khóa từng nguyên liệu, kiểm tra tồn đủ',3,2],
 ['stockwrite','Trừ tồn & movements','tx','stock','UPDATE inventory_items','Trừ kho, ghi lịch sử theo lô',3,3],
 ['auditwrite','Audit nghiệp vụ','tx','audit','dining_audit / pos_audit','Ghi mốc xác nhận, cập nhật món và quyền',3,4],
 ['commit','COMMIT / ROLLBACK','tx','orders','PostgreSQL ACID','Thành công mới bền vững; lỗi hoàn nguyên',3,5],
 ['pool','PostgreSQL / Neon','storage','database','DATABASE_URL · schema.sql','Một PostgreSQL chung, không có message broker',4,0],
 ['orderdb','Bảng đơn & dòng','storage','orders','dining_orders / dining_order_lines','Trạng thái, payment_status và requestId',4,1],
 ['stockdb','Bảng kho / recipe','storage','stock','inventory_*','Tồn, công thức và biến động',4,2],
 ['moneydb','Bảng thu–chi','storage','finance','finance_entries','Phiếu thu chi, doanh thu dịch vụ',4,3],
 ['rentaldb','Bảng dịch vụ','storage','rental','locker_* / area_receipts','Tủ A1–B30, phao và phiếu thu',4,4],
 ['authdb','Tài khoản','storage','access','staff_users / owner_accounts','Hash salt và auth_version, không đọc mật khẩu',4,5],
 ['businessaudit','Audit đã COMMIT','observe','audit','dining_audit / pos_audit','Sự kiện đã lưu trong PostgreSQL',5,0],
 ['httptrace','HTTP telemetry RAM','observe','observe','processing-telemetry.js','Trace các mốc thực, mất khi restart',5,1],
 ['sse','SSE live feed','observe','observe','GET /api/admin/architecture/system/live','Snapshot ~4s, giới hạn phiên, owner only',5,2],
 ['architecture','Sơ đồ kỹ thuật','observe','observe','/admin/architecture','Tất cả theo dõi đồng thời, chọn để drill-down',5,3]
].map(([id,label,lane,domain,source,description,col,row])=>({id,label,lane,domain,source,description,col,row}));
const connects=[
 ['qr','guestcart'],['staffui','staffcart'],['guestcart','router'],['staffcart','router'],
 ['kitchenui','router'],['lockerui','router'],['ownerui','router'],['router','origin'],
 ['origin','auth'],['origin','validate'],['router','presence'],['auth','staffperm'],
 ['validate','orderengine'],['staffperm','orderengine'],['orderengine','dedupe'],
 ['dedupe','begin'],['begin','insertorder'],['insertorder','recipe'],['recipe','stocklock'],
 ['stocklock','stockwrite'],['stockwrite','auditwrite'],['auditwrite','commit'],
 ['commit','pool'],['pool','orderdb'],['pool','stockdb'],['pool','moneydb'],
 ['pool','rentaldb'],['pool','authdb'],['auth','kds'],['auth','payment'],
 ['auth','rental'],['auth','admin'],['kds','begin'],['payment','begin'],
 ['rental','begin'],['admin','begin'],['pool','businessaudit'],['router','httptrace'],
 ['presence','sse'],['businessaudit','sse'],['httptrace','sse'],['sse','architecture']
].map(([from,to])=>({from,to}));
const orderSteps=[
 ['1','Thiết bị đọc thực đơn','Khách GET /api/menu/:token hoặc nhân viên GET /api/staff/menu','guest'],
 ['2','Giỏ hàng tạm trên trình duyệt','Presence chỉ báo số phần/tình trạng; chưa có đơn, chưa trừ tồn','cart'],
 ['3','Nhấn Gửi đơn','POST /api/orders hoặc POST /api/staff/orders, requestId duy nhất','http'],
 ['4','Kiểm tra quyền & giới hạn','Same Origin / throttling; nếu nhân viên xác minh cookie/role','auth'],
 ['5','Kiểm tra đầu vào','Token bàn còn hiệu lực; JSON, món active, quantity 1–20, tối đa 60 phần','validate'],
 ['6','Giá, khả dụng từ server','Menu price lấy từ DB, available_quantity theo công thức và tồn','validate'],
 ['7','Mượn kết nối & BEGIN','Pool cấp connection; mọi thao tác tiếp theo cùng transaction','tx'],
 ['8','Chống tạo trùng','INSERT dining_orders ON CONFLICT(table_id,request_id) DO NOTHING','orders'],
 ['9','Ghi từng món theo lô','INSERT dining_order_lines ... UNNEST, chưa COMMIT','orders'],
 ['10','Audit kiểm tra','Ghi dining_audit: order_validated','audit'],
 ['11','Truy xuất định mức','LEFT JOIN inventory_recipes từ các món của đơn','inventory'],
 ['12','Kiểm tra món có recipe','Thiếu công thức thì trả 409 và ROLLBACK','inventory'],
 ['13','Gộp nguyên liệu','SUM số lượng x định mức theo inventory_item_id','inventory'],
 ['14','Khóa tồn kho','SELECT inventory_items FOR UPDATE theo thứ tự ID','inventory'],
 ['15','Kiểm tra đủ tồn','Thiếu nguyên liệu, ngừng cả đơn và ROLLBACK','inventory'],
 ['16','Trừ nguyên liệu','UPDATE inventory_items.quantity; INSERT movements theo lô','inventory'],
 ['17','Đánh dấu bàn đang phục vụ','UPDATE dining_tables.service_status nếu đang available','orders'],
 ['18','Audit tạo đơn','Ghi inventory_checked + order_created, phân biệt guest/staff','audit'],
 ['19','COMMIT thành công','Dữ liệu đơn + kho + audit được lưu đồng thời','pg'],
 ['20','Phát tín hiệu đơn','Invalidate cache KDS, pulse SSE; Bếp/Bar truy vấn món mới','stream'],
 ['21','Bếp / Bar xử lý','GET /api/kds → PATCH /api/items/:id; quy tắc trạng thái','kds'],
 ['22','Hủy hợp lệ / hoàn nguyên liệu','Hủy món new có restore movements theo transaction riêng','inventory'],
 ['23','Nhân viên xác nhận đã thu tiền','Cập nhật payment_status, không tự xác nhận chuyển khoản','finance'],
 ['24','Mọi yêu cầu lỗi','ROLLBACK khi transaction thất bại; 4xx/5xx tùy nguyên nhân','tx']
].map(([number,label,description,node])=>({number,label,description,node}));
let cache=null;
function getModel(){
 if(cache)return cache;
 const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
 cache={version:'2026-10-28-blueprint-v1',architecture:{kind:'single-node-service',platform:'Render Node.js + Neon PostgreSQL',blocks,connects,orderSteps},
  schema:schemaModel(sql),observability:{live:'SSE trace HTTP RAM',durable:'PostgreSQL business audits',presence:'QR & nhân viên: RAM TTL'}};
 return cache;
}
module.exports={schemaModel,getModel};
