'use strict';
// Verified logical architecture of the current SalesHub monolith, NOT microservices.
// Coordinates are presentation metadata for the interactive operations map.
const nodes=[
 {id:'guest',name:'Khách / QR tại bàn',group:'client',x:35,y:95,w:205,sub:'Trình duyệt web · mã QR',tag:'PUBLIC',detail:'Khách mở trang /t/:token, xem thực đơn hợp lệ và gửi yêu cầu gọi món bằng requestId để chống gửi lặp.',routes:['GET /api/menu/:token','POST /api/orders','GET /api/order-status/:id'],data:['Token bàn','Mã món và số lượng','Request ID']},
 {id:'staff',name:'Nhân viên / Bếp / Bar',group:'client',x:35,y:325,w:205,sub:'Tài khoản theo vị trí',tag:'STAFF',detail:'Nhân viên phục vụ và khu bếp/bar truy cập API trong phạm vi quyền được cấp, cập nhật tiến trình chế biến hoặc dịch vụ theo khu vực.',routes:['GET /api/kds','PATCH /api/items/:id','GET /api/lockers'],data:['Session nhân viên','Trạng thái món','Khu vực phân công']},
 {id:'owner',name:'Chủ cửa hàng',group:'client',x:35,y:567,w:205,sub:'Tài khoản chủ · quản trị',tag:'OWNER',detail:'Chủ cửa hàng quản lý thực đơn, thu chi, nhân sự, báo cáo và sơ đồ này. Truy vấn quản trị được xác thực ở backend.',routes:['GET /api/admin/core/catalog','GET /api/admin/analytics','GET /api/admin/architecture'],data:['Phiên chủ cửa hàng','Cấu hình nghiệp vụ']},
 {id:'http',name:'Render / HTTP API',group:'gateway',x:309,y:322,w:215,sub:'Node.js · một web service',tag:'HTTP',detail:'Một tiến trình ứng dụng xử lý giao diện tĩnh và HTTP API. Không có lớp gateway/nginx độc lập được chứng minh trong repository.',routes:['api/server.js','api/static-files.js'],data:['HTTPS từ trình duyệt','JSON API','Cookie phiên'],health:'app'},
 {id:'auth',name:'Xác thực & phân quyền',group:'gateway',x:309,y:560,w:215,sub:'Session · RBAC · khu vực',tag:'RBAC',detail:'Backend xác minh cookie phiên chủ/nhân viên, quyền theo vai trò và khu vực; token QR bàn được kiểm tra riêng ở luồng khách.',routes:['identity()','requireAdmin()','requireAuth()','area-access.js'],data:['Cookie HttpOnly','Vai trò & khu vực','Quyền truy cập']},
 {id:'orders',name:'Đơn gọi món QR',group:'module',x:590,y:101,w:225,sub:'Đặt món · chống gửi trùng',tag:'ORDER',detail:'POST /api/orders tạo đơn và từng món trong transaction PostgreSQL, chống trùng bằng khóa (table_id, request_id), trừ kho theo công thức và ghi dining_audit.',routes:['POST /api/orders','GET /api/order-status/:id'],data:['dining_orders','dining_order_lines','dining_audit']},
 {id:'kds',name:'Bếp / Bar xử lý món',group:'module',x:850,y:101,w:225,sub:'Nhận và đổi trạng thái món',tag:'KDS',detail:'GET /api/kds lấy các món thuộc vai trò. PATCH /api/items/:id thay đổi new → preparing → ready → served hoặc cancelled; hủy có logic hoàn tồn.',routes:['GET /api/kds','PATCH /api/items/:id'],data:['dining_order_lines','dining_audit','inventory_movements']},
 {id:'inventory',name:'Kho & công thức',group:'module',x:590,y:312,w:225,sub:'Tồn kho · nhập xuất · định mức',tag:'STOCK',detail:'Các bảng inventory_items, recipes và movements phục vụ theo dõi, trừ kho khi gọi món và nhập hàng. Ngưỡng tồn kho là cảnh báo, không phải dự báo.',routes:['GET /api/admin/inventory','POST /api/admin/inventory/movements'],data:['inventory_items','inventory_recipes','inventory_movements']},
 {id:'finance',name:'Thu–chi & đối soát',group:'module',x:850,y:312,w:225,sub:'Giao dịch · xác nhận thanh toán',tag:'LEDGER',detail:'Ghi finance_entries thủ công hoặc từ nhập kho; thanh toán đơn hàng được xác nhận riêng trên dining_orders. Báo cáo phân biệt các nguồn để tránh đếm trùng.',routes:['POST /api/admin/finance/entries','POST /api/admin/orders/:id/confirm-payment','GET /api/admin/analytics'],data:['finance_entries','dining_orders','register_shifts']},
 {id:'rental',name:'Phao & tủ đồ',group:'module',x:590,y:526,w:225,sub:'Thuê đồ · thu tiền dịch vụ',tag:'RENTAL',detail:'Dịch vụ tủ A1–A30, B1–B30, cho thuê phao và thu tiền theo khu vực; ghi các bản ghi nhận dịch vụ cùng lịch sử giao dịch.',routes:['GET /api/lockers','POST /api/lockers/:code/rent','POST /api/area/receipts'],data:['lockers','locker_rentals','area_receipts','float_receipt_details']},
 {id:'backoffice',name:'Thực đơn / Bàn / Nhân sự',group:'module',x:850,y:526,w:225,sub:'Quản trị & điều phối',tag:'CORE',detail:'Quản lý danh mục món, QR bàn, nhân viên, ca thu ngân và nhật ký; API quản trị yêu cầu vai trò chủ. Mục đặt bàn đã gỡ khỏi giao diện.',routes:['/api/admin/core/catalog','/api/admin/core/tables','/api/admin/users'],data:['menu_items','dining_tables','staff_users','pos_audit']},
 {id:'postgres',name:'PostgreSQL',group:'storage',x:1160,y:245,w:224,sub:'Một CSDL dùng chung',tag:'5432',detail:'CSDL giao dịch duy nhất được cấu hình bằng DATABASE_URL. Các bảng đơn hàng, kho, thu–chi, nhân viên và thuê đồ đều thuộc cùng PostgreSQL.',routes:['api/schema.sql','DATABASE_URL (bí mật, không hiển thị)'],data:['dining_*','inventory_*','finance_entries','locker_*'],health:'database'},
 {id:'audit',name:'Nhật ký & đối soát',group:'observe',x:1160,y:485,w:224,sub:'Bảng audit trong PostgreSQL',tag:'AUDIT',detail:'dining_audit ghi hành động trên đơn; pos_audit ghi thay đổi quản trị. Đây là nhật ký nghiệp vụ, chưa phải distributed tracing hoặc giám sát lỗi toàn diện.',routes:['dining_audit','pos_audit'],data:['Sự kiện đơn hàng','Thay đổi quản trị'],health:'audit'},
 {id:'transfer',name:'QR chuyển khoản',group:'external',x:1160,y:677,w:224,sub:'Hiển thị thông tin ngân hàng',tag:'MANUAL',detail:'Cấu hình QR thanh toán cho khách; việc xác nhận đã nhận tiền do quy trình nhân viên/chủ cửa hàng thực hiện. Không giả định có cổng thanh toán tự động.',routes:['GET /api/payment/recipient','/api/admin/payment-settings'],data:['merchant_payment_settings','Xác nhận thanh toán thủ công']}
];
const edge=(from,to,group,label,detail)=>({id:from+'-'+to,from,to,group,label,detail});
const edges=[
 edge('guest','http','ingress','HTTPS / QR','Khách chỉ gửi request từ mã QR bàn đã xác thực theo token.'),
 edge('staff','http','ingress','HTTPS / Session','Nhân viên gọi API theo khu vực quyền.'),
 edge('owner','http','ingress','HTTPS / Owner','Chủ cửa hàng truy cập các API quản trị.'),
 edge('http','auth','access','Cookie / RBAC','Các API cần đăng nhập được xác minh quyền tại server.'),
 edge('http','orders','dining','POST /api/orders','Yêu cầu khách gửi món được kiểm tra table token, số lượng và requestId.'),
 edge('auth','kds','dining','KDS / Role','Chỉ đúng nhân viên được xem/chuyển trạng thái món.'),
 edge('orders','kds','dining','Tạo món cần chế biến','Đơn ghi xuống PostgreSQL rồi KDS tải về qua API.'),
 edge('orders','inventory','inventory','Trừ định mức','Mỗi đơn ghi cùng transaction với việc trừ nguyên liệu theo recipe.'),
 edge('auth','inventory','inventory','Quản lý kho','Chủ cửa hàng nhập/xuất, đặt ngưỡng tồn.'),
 edge('auth','finance','finance','Thu–chi','Chủ cửa hàng xem/sửa thu chi; thanh toán đơn là quy trình riêng.'),
 edge('inventory','finance','finance','Chi nhập hàng','Mua nguyên liệu phát sinh khoản chi theo transaction.'),
 edge('auth','rental','rental','Phân quyền khu vực','Nhân viên khu vực phao/tủ đồ được thao tác theo quyền.'),
 edge('auth','backoffice','access','Cấu hình','Chỉ chủ cửa hàng được quản trị thông tin cốt lõi.'),
 edge('orders','postgres','dining','COMMIT đơn','Lưu đơn, dòng món và audit trong PostgreSQL.'),
 edge('kds','postgres','dining','Trạng thái món','Đọc/ghi trạng thái và audit theo transaction.'),
 edge('inventory','postgres','inventory','Đọc/ghi tồn kho','Tồn, công thức và movements trên PostgreSQL.'),
 edge('finance','postgres','finance','Sổ giao dịch','Thu chi, thanh toán và ca thu ngân.'),
 edge('rental','postgres','rental','Phiếu thuê','Giao dịch tủ đồ, phao và doanh thu.'),
 edge('backoffice','postgres','access','Quản trị','Sửa món/bàn/nhân sự với audit.'),
 edge('postgres','audit','audit','Audit tables','Nhật ký là bảng trong cùng PostgreSQL, không phải database riêng.'),
 edge('finance','transfer','finance','Thông tin QR','QR chuyển khoản hiển thị, không kết luận tiền tự động về tài khoản.')
];
const flows=[
 {id:'all',name:'Tất cả',color:'#7e9ace',description:'Bản đồ các khối logic; các mô-đun cùng chạy trong một ứng dụng Node.js.'},
 {id:'dining',name:'Gọi món & Bếp',color:'#48c6d7',description:'Quét QR → tạo đơn có requestId → PostgreSQL → bếp/bar → đổi trạng thái.'},
 {id:'inventory',name:'Kho',color:'#efbc63',description:'Tạo đơn → trừ kho theo công thức; quản trị nhập/xuất và ngưỡng tồn.'},
 {id:'finance',name:'Thu–chi',color:'#70d5ae',description:'Thu chi và xác nhận thanh toán được lưu riêng; mua hàng tự phát sinh chi.'},
 {id:'rental',name:'Phao & tủ đồ',color:'#bc9efb',description:'Nhân viên được phân quyền → phiếu thuê → ghi giao dịch trong PostgreSQL.'},
 {id:'access',name:'Phân quyền',color:'#88b7ef',description:'Phiên đăng nhập và kiểm tra role ở backend; không tự nâng quyền qua giao diện.'},
 {id:'audit',name:'Nhật ký',color:'#e4a66e',description:'Bản ghi audit trong PostgreSQL; chưa phải ghi trace từng HTTP request.'}
];
const model=Object.freeze({version:'2026-10-28',title:'SalesHub / Kiến trúc thực tế',implementation:'Single Node.js service on Render + PostgreSQL',nodes,edges,flows});
const query=`SELECT
 (SELECT count(*)::int FROM dining_orders WHERE created_at >= now()-interval '24 hours') AS "orders24h",
 (SELECT count(*)::int FROM dining_order_lines WHERE status IN ('new','preparing')) AS "pendingKitchen",
 (SELECT count(*)::int FROM inventory_items WHERE active=true AND quantity<=reorder_level) AS "lowStock",
 (SELECT count(*)::int FROM locker_rentals WHERE ended_at IS NULL) AS "occupiedLockers",
 (SELECT count(*)::int FROM finance_entries WHERE created_at >= now()-interval '24 hours') AS "financeEntries24h",
 (SELECT count(*)::int FROM pos_audit WHERE created_at >= now()-interval '24 hours') AS "adminActions24h",
 (SELECT count(*)::int FROM dining_audit WHERE created_at >= now()-interval '24 hours') AS "orderEvents24h",
 (SELECT count(*)::int FROM dining_orders WHERE payment_status='unpaid') AS "unpaidOrders",
 (SELECT max(created_at) FROM dining_orders) AS "latestOrderAt"`;
async function snapshot(pool,clock=()=>new Date().toISOString()){
 const checkedAt=clock();
 if(!pool)return {checkedAt,app:'ready',database:'pilot',stats:null,dbLatencyMs:null,measurement:'unavailable',note:'Đang ở chế độ pilot; không có số liệu PostgreSQL thực.'};
 const start=process.hrtime.bigint();
 try{
  const result=await pool.query({text:query,query_timeout:4000});
  const dbLatencyMs=Math.round(Number(process.hrtime.bigint()-start)/1e6);
  return {checkedAt,app:'ready',database:'ready',stats:result.rows[0],dbLatencyMs,measurement:'database-query',note:'Số liệu tổng hợp từ PostgreSQL tại thời điểm kiểm tra. Không phải trace trực tiếp từng yêu cầu.'};
 }catch(e){
  console.error('architecture monitor query failed:',e.message);
  return {checkedAt,app:'ready',database:'unavailable',stats:null,dbLatencyMs:null,measurement:'failed',note:'Không truy vấn được thống kê PostgreSQL. Kiểm tra Render Logs và kết nối CSDL.'};
 }
}
module.exports={model,snapshot};
