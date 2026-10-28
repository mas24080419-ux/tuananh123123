'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {URL} = require('node:url');
const QRCode = require('qrcode');
const {Pool} = require('pg');
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const PILOT_MODE = process.env.PILOT_MODE === 'true';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!STAFF_PASSWORD || !SESSION_SECRET || (!DATABASE_URL && !PILOT_MODE)) {
  throw Error('Missing STAFF_PASSWORD / SESSION_SECRET / DATABASE_URL (or explicit PILOT_MODE=true).');
}
const mode = DATABASE_URL ? 'postgres' : 'pilot';
const pool = DATABASE_URL ? new Pool({connectionString:DATABASE_URL,ssl:process.env.PG_SSL === 'true' ? {rejectUnauthorized:true}:undefined,max:5,connectionTimeoutMillis:8000}) : null;
if (pool) pool.on('error', () => console.error('PostgreSQL idle connection interrupted; new requests will reconnect.'));
const menuSeed=[
['Phở bò đặc biệt','Món ăn',65000,'kitchen'],['Bún chả Hà Nội','Món ăn',55000,'kitchen'],
['Cơm gà xối mỡ','Món ăn',59000,'kitchen'],['Khoai tây chiên','Ăn nhẹ',35000,'kitchen'],
['Trà đào cam sả','Đồ uống',38000,'bar'],['Cà phê sữa đá','Đồ uống',32000,'bar'],['Nước ép cam','Đồ uống',42000,'bar']
];
let tables=[], menu=[], orders=[], lines=[];
const id=()=>crypto.randomUUID();
const ops=require('./operations')({pool,id});
const createAsyncTtlCache=require('./async-ttl-cache');
const analytics=require('./finance-analytics')({pool});
const paymentRecipient=require('./payment-recipient')({pool});
const core=require('./core')({pool,id,randomToken:()=>crypto.randomBytes(24).toString('hex')});
const staffAccounts=require('./staff-auth')({pool,id});
const areaReceipts=require('./area-receipts')({pool,id});
const lockerService=require('./lockers')({pool,id});
const {areas:serviceAreas,canAccess:canAccessArea,canUseDining}=require('./area-access');
const ownerAccounts=require('./owner-auth')({pool});
const architectureMonitor=require('./architecture-monitor');
const orderLive=require('./order-flow-live')({pool});
const qrPresence=require('./qr-presence')();
const systemFlow=require('./system-flow')({pool,qrPresence});
const token=i=>crypto.createHmac('sha256',SESSION_SECRET).update('qr-table-'+i).digest('hex').slice(0,48);
const authHash=s=>crypto.createHash('sha256').update(s).digest();
const safeEq=(a,b)=>{const x=authHash(a),y=authHash(b);return crypto.timingSafeEqual(x,y)};
const attempts=new Map();
function pilotSeed(){if(tables.length)return;for(let i=1;i<=6;i++)tables.push({id:id(),name:'Bàn '+String(i).padStart(2,'0'),token:token(i),zone:i<=3?'Tầng 1':'Tầng 2',active:true});menu=menuSeed.map(([name,category,price,station])=>({id:id(),name,category,price,station,active:true}));}
async function init(){if(!pool){pilotSeed();return}const c=await pool.connect();try{await c.query('BEGIN');await c.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
let rows=await c.query('SELECT id FROM dining_tables LIMIT 1');if(!rows.rowCount){for(let i=1;i<=6;i++)await c.query('INSERT INTO dining_tables(id,name,token,zone) VALUES($1,$2,$3,$4)',[id(),'Bàn '+String(i).padStart(2,'0'),token(i),i<=3?'Tầng 1':'Tầng 2']);}
rows=await c.query('SELECT id FROM menu_items LIMIT 1');if(!rows.rowCount){for(const [name,category,price,station] of menuSeed)await c.query('INSERT INTO menu_items(id,name,category,price,station) VALUES($1,$2,$3,$4,$5)',[id(),name,category,price,station]);}
await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
const send=(res,status,obj,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(obj))};
const err=(res,status,msg)=>send(res,status,{error:msg});
const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function cookie(req){const m=(req.headers.cookie||'').match(/(?:^|;\s*)sh_session=([^;]+)/);return m?decodeURIComponent(m[1]):null}
function sessionRole(req){
 const v=cookie(req);if(!v)return null;
 const parts=v.split('.');if(parts.length!==2&&parts.length!==3)return null;
 const [exp,role,mac]=parts.length===3?parts:[parts[0],'staff',parts[1]];
 if(!/^\d+$/.test(exp)||!['staff','admin'].includes(role)||!/^[0-9a-f]{64}$/.test(mac||'')||Number(exp)<Date.now())return null;
 const value=parts.length===3?exp+'.'+role:exp;
 const signature=crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('hex');
 return safeEq(mac,signature)?role:null;
}
function loginCookie(role){
 const exp=String(Date.now()+8*60*60*1000);
 const sig=crypto.createHmac('sha256',SESSION_SECRET).update(exp+'.'+role).digest('hex');
 return 'sh_session='+exp+'.'+role+'.'+sig+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';
}
const STAFF_ROLES=['manager','cashier','waiter','kitchen','bar'];
function staffCookie(user){
 const exp=String(Date.now()+8*60*60*1000),version=String(user.version);
 const base=[exp,user.id,user.role,version].join('.');
 const sig=crypto.createHmac('sha256',SESSION_SECRET).update('v2.'+base).digest('hex');
 return 'sh_session=v2.'+base+'.'+sig+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';
}
function ownerCookie(user){
 const expires=String(Date.now()+8*60*60*1000),version=String(user.version);
 const base=['v3',expires,user.id,version].join('.');
 const mac=crypto.createHmac('sha256',SESSION_SECRET).update(base).digest('hex');
 return 'sh_session='+base+'.'+mac+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';
}
async function identity(req){
 if(req._verified)return req._actor;
 req._verified=true;req._actor=null;
 const v=cookie(req);
 if(v?.startsWith('v3.')){
  const parts=v.split('.');
  if(parts.length!==5)return null;
  const [,exp,userId,version,signature]=parts;
  if(!/^\d+$/.test(exp)||Number(exp)<Date.now()||!/^\d+$/.test(version)||!/^[0-9a-f]{64}$/.test(signature))return null;
  const message=['v3',exp,userId,version].join('.');
  const valid=crypto.createHmac('sha256',SESSION_SECRET).update(message).digest('hex');
  if(!safeEq(signature,valid))return null;
  try{const user=await ownerAccounts.current(userId,version);if(user)req._actor={role:'admin',email:user.email,userId:user.id}}catch{console.error('Owner session validation failed')}
  return req._actor;
 }
 if(v?.startsWith('v2.')){
  const parts=v.split('.');
  if(parts.length!==6)return null;
  const [,expires,userId,role,ver,mac]=parts;
  if(!/^\d+$/.test(expires)||Number(expires)<Date.now()||!STAFF_ROLES.includes(role)||!/^\d+$/.test(ver)||!/^[0-9a-f]{64}$/.test(mac))return null;
  const expected=crypto.createHmac('sha256',SESSION_SECRET).update(['v2',expires,userId,role,ver].join('.')).digest('hex');
  if(!safeEq(mac,expected))return null;
  try{const user=await staffAccounts.activeUser(userId,role,ver);if(user)req._actor={role,userId:user.id,username:user.username,displayName:user.displayName,workArea:user.workArea}}catch{console.error('Staff session validation unavailable')}
  return req._actor;
 }
 const role=sessionRole(req);
 if(role==='admin'){
  // Legacy owner cookies are no longer accepted when the email owner exists.
  try{if(await ownerAccounts.exists())return null}catch{return null}
 }
 if(role==='staff')return null;
 if(role)req._actor={role,legacy:true};
 return req._actor;
}
const requireAuth=async(req,res)=>{if(!await identity(req)){err(res,401,'Cần đăng nhập.');return false}systemFlow.mark(req,'auth','Phiên nhân viên đã xác thực');return true};
const requireAdmin=async(req,res)=>{if((await identity(req))?.role!=='admin'){err(res,403,'Chỉ chủ cửa hàng có quyền truy cập.');return false}systemFlow.mark(req,'auth','Phiên chủ cửa hàng đã xác thực');return true};
const canSeeTables=role=>['admin','staff','manager','cashier','waiter'].includes(role);
const canCook=role=>['admin','staff','manager','kitchen','bar'].includes(role);
const {canManageOrders,canConfirmOrderPayment,canChangeOrderItem}=require('./staff-order-permissions');
const input=async req=>{let s='';for await(const ch of req){s+=ch;if(s.length>18000)throw Object.assign(Error('Dữ liệu quá lớn'),{status:413})}try{const data=JSON.parse(s||'{}');systemFlow.mark(req,'validate','JSON đã phân tích cú pháp');if(req._flowTrace)systemFlow.mark(req,req._flowTrace.module,'Bắt đầu xử lý nghiệp vụ');return data}catch{throw Object.assign(Error('JSON không hợp lệ'),{status:400})}};
const sameOrigin=(req,res)=>{if(!['POST','PATCH','PUT','DELETE'].includes(req.method))return true;const origin=req.headers.origin;if(!origin)return true;const host=`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`;if(origin!==host){err(res,403,'Nguồn yêu cầu không hợp lệ.');return false}return true};
const clientIp=req=>(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
function throttle(req,action,max=25){const k=action+':'+clientIp(req);const now=Date.now(),v=attempts.get(k)||{t:now,n:0};if(now-v.t>60000){v.t=now;v.n=0}v.n++;attempts.set(k,v);return v.n<=max}
async function getTables(){return pool?(await pool.query('SELECT id,name,token,zone,active FROM dining_tables ORDER BY name')).rows:tables}
async function getMenu(){
 if(!pool)return menu.filter(x=>x.active);
 // An item without a linked recipe is NOT sellable. For configured items,
 // available_quantity is the limiting whole-number servings across ALL ingredients.
 const sql="SELECT m.id,m.name,m.category,m.price,m.station,m.active, "+
 "CASE WHEN COUNT(r.inventory_item_id)=0 THEN 0 "+
 "ELSE COALESCE(MIN(CASE WHEN i.id IS NULL OR NOT i.active THEN 0 "+
 "ELSE FLOOR(i.quantity/r.quantity_per_unit) END),0) END::integer AS available_quantity, "+
 "(COUNT(r.inventory_item_id)>0) AS inventory_configured "+
 "FROM menu_items m LEFT JOIN inventory_recipes r ON r.menu_item_id=m.id "+
 "LEFT JOIN inventory_items i ON i.id=r.inventory_item_id "+
 "WHERE m.active=true GROUP BY m.id ORDER BY m.category,m.name";
 return (await pool.query(sql)).rows;
}
async function getTable(t){return pool?(await pool.query('SELECT id,name,token,zone,active FROM dining_tables WHERE token=$1 AND active=true',[t])).rows[0]:tables.find(x=>x.token===t&&x.active)}
async function placeOrder(body,flowReq,orderActor=null){if(!body||typeof body.token!=='string'||!Array.isArray(body.items)||!body.items.length||body.items.length>30)throw Object.assign(Error('Đơn không hợp lệ.'),{status:400});
if(!/^[0-9a-f-]{36}$/.test(body.requestId||''))throw Object.assign(Error('Mã gửi lại không hợp lệ.'),{status:400});const t=await getTable(body.token);if(!t)throw Object.assign(Error('Không tìm thấy bàn hoặc QR đã khóa.'),{status:404});
const paymentMethod=body.paymentMethod;
if(!['cash','bank_transfer'].includes(paymentMethod))throw Object.assign(Error('Vui lòng chọn Tiền mặt hoặc Chuyển khoản.'),{status:400});
const note=String(body.note||'').slice(0,160);const m=await getMenu(),lookup=new Map(m.map(x=>[x.id,x]));const items=body.items.map(it=>{const p=lookup.get(it.id);if(!p||!Number.isSafeInteger(it.qty)||it.qty<1||it.qty>20)throw Object.assign(Error('Món hoặc số lượng không hợp lệ.'),{status:400});if(p.available_quantity!==undefined&&p.available_quantity!==null&&Number(p.available_quantity)<it.qty)throw Object.assign(Error('Món '+p.name+' hiện chỉ còn '+p.available_quantity+' phần. Vui lòng cập nhật giỏ hàng.'),{status:409});return {...p,qty:it.qty,note:String(it.note||'').slice(0,160)}});if(items.reduce((s,x)=>s+x.qty,0)>60)throw Object.assign(Error('Quá số lượng một lần gửi.'),{status:400});systemFlow.mark(flowReq,'validate','Token bàn, món và số lượng hợp lệ',items.reduce((s,x)=>s+x.qty,0));
if(!pool){const exists=orders.find(x=>x.table_id===t.id&&x.request_id===body.requestId);if(exists)return {id:exists.id,duplicate:true};const o={id:id(),table_id:t.id,request_id:body.requestId,note,payment_method:paymentMethod,payment_status:'unpaid',created_at:new Date().toISOString()};orders.push(o);for(const it of items)lines.push({id:id(),order_id:o.id,menu_item_id:it.id,name:it.name,quantity:it.qty,unit_price:it.price,station:it.station,note:it.note,status:'new',created_at:o.created_at});return {id:o.id,duplicate:false}}
const c=await pool.connect();try{await c.query('BEGIN');systemFlow.mark(flowReq,'tx','Transaction đã BEGIN');const orderId=id();const o=await c.query('INSERT INTO dining_orders(id,table_id,request_id,note,payment_method) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_id,request_id) DO NOTHING RETURNING id',[orderId,t.id,body.requestId,note,paymentMethod]);if(!o.rowCount){const prev=await c.query('SELECT id FROM dining_orders WHERE table_id=$1 AND request_id=$2',[t.id,body.requestId]);await c.query('COMMIT');systemFlow.mark(flowReq,'pg','RequestId đã tồn tại — không tạo đơn mới');return {id:prev.rows[0].id,duplicate:true}}await c.query("INSERT INTO dining_order_lines(id,order_id,menu_item_id,name,quantity,unit_price,station,note) SELECT r.id,$1,r.menu_item_id,r.name,r.quantity,r.unit_price,r.station,r.note FROM UNNEST($2::uuid[],$3::uuid[],$4::text[],$5::integer[],$6::integer[],$7::text[],$8::text[]) AS r(id,menu_item_id,name,quantity,unit_price,station,note)",[orderId,items.map(()=>id()),items.map(it=>it.id),items.map(it=>it.name),items.map(it=>it.qty),items.map(it=>it.price),items.map(it=>it.station),items.map(it=>it.note)]);systemFlow.mark(flowReq,'orders','Đã ghi đơn và món (chưa COMMIT)');await c.query("INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,'system','order_validated',$2::jsonb)",[orderId,JSON.stringify({checked:'table_menu_quantity_requestId'})]);systemFlow.mark(flowReq,'inventory','Đang kiểm tra và trừ tồn nguyên liệu');await ops.consume(c,orderId);systemFlow.mark(flowReq,'inventory','Đã cập nhật tồn trong transaction');await c.query("INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,'system','inventory_checked',$2::jsonb)",[orderId,JSON.stringify({result:'inventory_rules_processed'})]);await c.query("UPDATE dining_tables SET service_status='occupied' WHERE id=$1 AND service_status='available'",[t.id]);await c.query('INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)',[orderId,orderActor?'staff':'guest','order_created',JSON.stringify({table:t.name,item_count:items.length,payment_method:paymentMethod,staffUserId:orderActor?.userId||null,role:orderActor?.role||null})]);systemFlow.mark(flowReq,'tx','Đang chờ COMMIT');await c.query('COMMIT');systemFlow.mark(flowReq,'pg','PostgreSQL COMMIT thành công');systemFlow.mark(flowReq,'audit','Audit đã được ghi bền vững');invalidateOrderReads();void orderLive.pulse(true);console.log('ORDER_COMMITTED',orderId,t.name,items.length);return {id:orderId,duplicate:false}}catch(e){await c.query('ROLLBACK');systemFlow.mark(flowReq,'tx','ROLLBACK: đơn chưa được lưu');throw e}finally{c.release()}}
async function getOrders(activeOnly=false){if(!pool)return orders.map(o=>({...o,table_name:tables.find(t=>t.id===o.table_id)?.name,items:lines.filter(l=>l.order_id===o.id&&(!activeOnly||['new','preparing','ready'].includes(l.status)))})).filter(o=>!activeOnly||o.items.length).reverse();const fields='SELECT o.id,o.created_at,o.note,o.payment_method,o.payment_status,t.name AS table_name,li.id AS line_id,li.name AS item_name,li.quantity,li.unit_price,li.station,li.note AS item_note,li.status FROM dining_orders o JOIN dining_tables t ON o.table_id=t.id ';
 const sql=activeOnly?fields+"JOIN dining_order_lines li ON li.order_id=o.id WHERE li.status IN ('new','preparing','ready') ORDER BY o.created_at DESC":fields+"LEFT JOIN dining_order_lines li ON li.order_id=o.id WHERE o.id IN (SELECT recent.id FROM dining_orders recent WHERE recent.created_at > now()- interval '7 days' ORDER BY recent.created_at DESC LIMIT 100) OR EXISTS (SELECT 1 FROM dining_order_lines pending WHERE pending.order_id=o.id AND pending.status IN ('new','preparing','ready')) ORDER BY o.created_at DESC";
 const q=await pool.query(sql);const map=new Map();for(const x of q.rows){let o=map.get(x.id);if(!o){o={id:x.id,table_name:x.table_name,note:x.note,payment_method:x.payment_method,payment_status:x.payment_status,created_at:x.created_at,items:[]};map.set(x.id,o)}if(x.line_id)o.items.push({id:x.line_id,name:x.item_name,quantity:x.quantity,unit_price:x.unit_price,station:x.station,note:x.item_note,status:x.status})}return [...map.values()]}
// One short-lived KDS result is shared across polling devices, but only after authentication.
const kdsCache=createAsyncTtlCache(()=>getOrders(true),{ttlMs:900});
const staffOrdersCache=createAsyncTtlCache(()=>getOrders(),{ttlMs:900});
const invalidateOrderReads=()=>{kdsCache.invalidate();staffOrdersCache.invalidate()};
async function updateLine(lineId,status,actor,flowReq){const allowed={new:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['served'],served:[],cancelled:[]};if(!Object.values(allowed).flat().includes(status))throw Object.assign(Error('Trạng thái không hợp lệ.'),{status:400});systemFlow.mark(flowReq,'kds','Đang kiểm tra chuyển trạng thái món');if(!pool){const line=lines.find(x=>x.id===lineId);if(!line)throw Object.assign(Error('Không tìm thấy món.'),{status:404});if(!canChangeOrderItem(actor,line.status,status,line.station))throw Object.assign(Error('Không có quyền chuyển trạng thái món.'),{status:403});if(!allowed[line.status].includes(status))throw Object.assign(Error('Chuyển trạng thái không hợp lệ.'),{status:409});line.status=status;return line}const c=await pool.connect();try{await c.query('BEGIN');systemFlow.mark(flowReq,'tx','Đã BEGIN transaction món');const x=(await c.query('SELECT status,station FROM dining_order_lines WHERE id=$1 FOR UPDATE',[lineId])).rows[0];if(!x)throw Object.assign(Error('Không tìm thấy món.'),{status:404});if(!canChangeOrderItem(actor,x.status,status,x.station))throw Object.assign(Error('Không có quyền chuyển trạng thái món.'),{status:403});if(!allowed[x.status].includes(status))throw Object.assign(Error('Chuyển trạng thái không hợp lệ.'),{status:409});const row=(await c.query('UPDATE dining_order_lines SET status=$2, updated_at=now() WHERE id=$1 RETURNING id,status',[lineId,status])).rows[0];if(status==='cancelled')await ops.restore(c,lineId,x.status);await c.query('INSERT INTO dining_audit(order_id,item_id,actor,action,detail) SELECT order_id,$1,$2,$3,$4::jsonb FROM dining_order_lines WHERE id=$1',[lineId,'staff','item_status_changed',JSON.stringify({from:x.status,to:status,role:actor.role,staffUserId:actor.userId||null})]);systemFlow.mark(flowReq,'tx','Đang COMMIT trạng thái món');await c.query('COMMIT');systemFlow.mark(flowReq,'pg','Đã lưu trạng thái và audit vào PostgreSQL');invalidateOrderReads();void orderLive.pulse(true);return row}catch(e){await c.query('ROLLBACK');systemFlow.mark(flowReq,'tx','ROLLBACK trạng thái món');throw e}finally{c.release()}}

async function orderStatus(orderId,qrToken){
 const t=await getTable(qrToken);if(!t)return null;
 const recipient=await paymentRecipient.publicRecipient();
 if(!pool){
  const o=orders.find(x=>x.id===orderId&&x.table_id===t.id);
  if(!o)return null;
  const orderLines=lines.filter(x=>x.order_id===o.id).map(x=>({name:x.name,quantity:x.quantity,unit_price:x.unit_price,status:x.status,station:x.station,note:x.note||''}));
  return {id:o.id,table_name:t.name,created_at:o.created_at,note:o.note||'',payment_method:o.payment_method||null,payment_status:o.payment_status||'unpaid',total_vnd:orderLines.reduce((s,x)=>s+(x.status==='cancelled'?0:x.quantity*x.unit_price),0),payment_transfer:null,persistent:false,items:orderLines};
 }
 const o=(await pool.query('SELECT id,created_at,note,payment_status,payment_method FROM dining_orders WHERE id=$1 AND table_id=$2',[orderId,t.id])).rows[0];
 if(!o)return null;
 const result=await pool.query('SELECT name,quantity,unit_price,status,station,note FROM dining_order_lines WHERE order_id=$1 ORDER BY created_at,id',[o.id]);
 const amount=result.rows.reduce((s,x)=>s+(x.status==='cancelled'?0:x.quantity*x.unit_price),0);
 const ref='TT6 '+o.id.replace(/-/g,'').slice(0,12).toUpperCase();
 const transfer=o.payment_method==='bank_transfer'&&o.payment_status==='unpaid'&&recipient&&amount>0?
  {recipient,amount,reference:ref,qrUrl:paymentRecipient.qrUrl(recipient,amount,ref)}:null;
 return {id:o.id,table_name:t.name,created_at:o.created_at,note:o.note||'',payment_method:o.payment_method,payment_status:o.payment_status,total_vnd:amount,payment_transfer:transfer,persistent:true,items:result.rows};
}
async function history(limit,offset){
 if(!pool){const all=await getOrders();return all.slice(offset,offset+limit).map(x=>({...x,payment_status:x.payment_status||'unpaid',payment_method:x.payment_method||null}))}
 const q=await pool.query('SELECT o.id,o.created_at,o.note,o.payment_status,o.payment_method,t.name AS table_name,COALESCE(SUM(CASE WHEN li.status<>$3 THEN li.quantity*li.unit_price ELSE 0 END),0)::bigint AS total_vnd,COUNT(li.id)::integer AS line_count FROM dining_orders o JOIN dining_tables t ON o.table_id=t.id LEFT JOIN dining_order_lines li ON li.order_id=o.id GROUP BY o.id,t.name ORDER BY o.created_at DESC LIMIT $1 OFFSET $2',[limit,offset,'cancelled']);
 return q.rows;
}

const VI_ZONE = 'Asia/Ho_Chi_Minh';
function adminDateRange(searchParams) {
 const today = new Intl.DateTimeFormat('sv-SE',{timeZone:VI_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const from=searchParams.get('from')||today.slice(0,7)+'-01',to=searchParams.get('to')||today;
 const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>366*86400000)throw Object.assign(Error('Khoảng ngày không hợp lệ hoặc vượt 366 ngày.'),{status:400});
 return {from,to};
}
function pilotMoney(orderId){return lines.filter(x=>x.order_id===orderId&&x.status!=='cancelled').reduce((v,l)=>v+l.quantity*l.unit_price,0)}
function inAdminRange(date,from,to){
 const d=new Intl.DateTimeFormat('sv-SE',{timeZone:VI_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
 return d>=from&&d<=to;
}
async function adminReport(from,to){
 if(!pool){
  const selection=orders.filter(o=>inAdminRange(o.created_at,from,to));
  const paid=orders.filter(o=>o.payment_status==='paid'&&o.paid_at&&inAdminRange(o.paid_at,from,to));
  const total=arr=>arr.reduce((sum,o)=>sum+pilotMoney(o.id),0);
  const collected=arr=>arr.reduce((sum,o)=>sum+Number(o.paid_amount||0),0);
  const outstanding=selection.filter(o=>o.payment_status==='unpaid');
  const top=new Map();
  for(const l of lines.filter(l=>l.status!=='cancelled'&&selection.some(o=>o.id===l.order_id))){
   const row=top.get(l.name)||{name:l.name,quantity:0,amount:0};row.quantity+=l.quantity;row.amount+=l.quantity*l.unit_price;top.set(l.name,row);
  }
  return {summary:{order_count:selection.length,order_value:total(selection),unpaid_orders:outstanding.length,outstanding:total(outstanding),paid_orders:paid.length,collected:collected(paid),paid_cash:collected(paid.filter(o=>o.payment_method==='cash')),paid_transfer:collected(paid.filter(o=>o.payment_method==='bank_transfer')),paid_unknown:collected(paid.filter(o=>!o.payment_method))},
    orders:selection.slice().reverse().slice(0,100).map(o=>({id:o.id,created_at:o.created_at,table_name:tables.find(t=>t.id===o.table_id)?.name||'',payment_method:o.payment_method,payment_status:o.payment_status,paid_at:o.paid_at||null,paid_amount:o.paid_amount||null,total_vnd:pilotMoney(o.id),line_count:lines.filter(l=>l.order_id===o.id).length})),
    top_items:[...top.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,10),daily:[],mode};
 }
 const params=[from,to];
 const volume=await pool.query(`
 SELECT count(*)::int AS order_count,coalesce(sum(x.amount),0)::bigint AS order_value,
 count(*) FILTER(WHERE x.payment_status='unpaid')::int AS unpaid_orders,
 coalesce(sum(x.amount) FILTER(WHERE x.payment_status='unpaid'),0)::bigint AS outstanding
 FROM (SELECT o.id,o.payment_status,
 coalesce((SELECT sum(l.quantity*l.unit_price) FROM dining_order_lines l WHERE l.order_id=o.id AND l.status<>'cancelled'),0)::bigint AS amount
 FROM dining_orders o WHERE (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date) x`,params);
 const paid=await pool.query(`
 SELECT count(*)::int AS paid_orders,
 coalesce(sum(coalesce(o.paid_amount,(SELECT sum(l.quantity*l.unit_price) FROM dining_order_lines l WHERE l.order_id=o.id AND l.status<>'cancelled'),0)),0)::bigint AS collected,
 coalesce(sum(coalesce(o.paid_amount,0)) FILTER(WHERE o.payment_method='cash'),0)::bigint AS paid_cash,
 coalesce(sum(coalesce(o.paid_amount,0)) FILTER(WHERE o.payment_method='bank_transfer'),0)::bigint AS paid_transfer,
 coalesce(sum(coalesce(o.paid_amount,0)) FILTER(WHERE o.payment_method IS NULL),0)::bigint AS paid_unknown
 FROM dining_orders o WHERE o.payment_status='paid'
 AND (o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date`,params);
 const recent=await pool.query(`
 SELECT o.id,o.created_at,t.name AS table_name,o.payment_method,o.payment_status,o.paid_at,o.paid_amount,
 coalesce((SELECT sum(l.quantity*l.unit_price) FROM dining_order_lines l WHERE l.order_id=o.id AND l.status<>'cancelled'),0)::bigint AS total_vnd,
 (SELECT count(*)::int FROM dining_order_lines l WHERE l.order_id=o.id) AS line_count
 FROM dining_orders o JOIN dining_tables t ON o.table_id=t.id
 WHERE (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ORDER BY o.created_at DESC LIMIT 100`,params);
 const best=await pool.query(`
 SELECT l.name,sum(l.quantity)::int AS quantity,sum(l.quantity*l.unit_price)::bigint AS amount
 FROM dining_order_lines l JOIN dining_orders o ON o.id=l.order_id
 WHERE l.status<>'cancelled' AND (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY l.name ORDER BY quantity DESC,l.name LIMIT 10`,params);
 const created=await pool.query(`
 SELECT to_char(o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day,count(*)::int AS orders
 FROM dining_orders o WHERE (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY day ORDER BY day`,params);
 const received=await pool.query(`
 SELECT to_char(o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day,
 coalesce(sum(o.paid_amount),0)::bigint AS collected
 FROM dining_orders o WHERE o.payment_status='paid'
 AND (o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY day ORDER BY day`,params);
 const dayMap=new Map();
 for(const r of created.rows)dayMap.set(r.day,{day:r.day,orders:r.orders,collected:0});
 for(const r of received.rows){const d=dayMap.get(r.day)||{day:r.day,orders:0,collected:0};d.collected=Number(r.collected);dayMap.set(r.day,d)}
 return {summary:{...volume.rows[0],...paid.rows[0]},orders:recent.rows,top_items:best.rows,daily:[...dayMap.values()].sort((a,b)=>a.day.localeCompare(b.day)),mode};
}
async function confirmPayment(orderId,providedMethod,actor={role:'admin'}){
 if(providedMethod!==undefined&&!['cash','bank_transfer'].includes(providedMethod))throw Object.assign(Error('Phương thức thanh toán không hợp lệ.'),{status:400});
 if(!pool){
  const o=orders.find(o=>o.id===orderId);
  if(!o)throw Object.assign(Error('Không tìm thấy đơn hàng.'),{status:404});
  if(o.payment_status==='paid')return {id:orderId,amount:o.paid_amount,already:true};
  if(o.payment_status!=='unpaid')throw Object.assign(Error('Đơn không còn ở trạng thái chưa thanh toán.'),{status:409});
  const actualMethod=o.payment_method||providedMethod;
  if(!['cash','bank_transfer'].includes(actualMethod))throw Object.assign(Error('Vui lòng xác định phương thức thanh toán cho đơn cũ.'),{status:409});
  if(o.payment_method&&providedMethod&&o.payment_method!==providedMethod)throw Object.assign(Error('Không thể thay đổi phương thức thanh toán đã đặt.'),{status:409});
  o.payment_method=actualMethod;
  const amount=pilotMoney(o.id);if(amount<=0)throw Object.assign(Error('Đơn có giá trị không hợp lệ.'),{status:409});
  o.payment_status='paid';o.paid_amount=amount;o.paid_at=new Date().toISOString();
  return {id:orderId,amount,already:false};
 }
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const o=(await c.query('SELECT id,payment_method,payment_status,paid_amount FROM dining_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o)throw Object.assign(Error('Không tìm thấy đơn hàng.'),{status:404});
  if(o.payment_status==='paid'){await c.query('COMMIT');return {id:orderId,amount:o.paid_amount,already:true}}
  if(o.payment_status!=='unpaid')throw Object.assign(Error('Đơn không còn ở trạng thái chưa thanh toán.'),{status:409});
  const actualMethod=o.payment_method||providedMethod;
  if(!['cash','bank_transfer'].includes(actualMethod))throw Object.assign(Error('Vui lòng xác định phương thức thu tiền cho đơn cũ.'),{status:409});
  if(o.payment_method&&providedMethod&&o.payment_method!==providedMethod)throw Object.assign(Error('Phương thức thu tiền không khớp đơn hàng.'),{status:409});
  const q=await c.query("SELECT coalesce(sum(quantity*unit_price),0)::bigint AS amount FROM dining_order_lines WHERE order_id=$1 AND status<>'cancelled'",[orderId]);
  const amount=Number(q.rows[0].amount);
  if(!Number.isSafeInteger(amount)||amount<=0)throw Object.assign(Error('Giá trị đơn không hợp lệ.'),{status:409});
  await c.query("UPDATE dining_orders SET payment_status='paid',paid_amount=$2,paid_at=now(),payment_method=$3 WHERE id=$1",[orderId,amount,actualMethod]);
  await c.query("INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,'staff','payment_confirmed',$2::jsonb)",[orderId,JSON.stringify({role:actor.role,staffUserId:actor.userId||null,payment_method:actualMethod,amount,method_filled_for_legacy_order:!o.payment_method})]);
  await c.query('COMMIT');
  invalidateOrderReads();
  return {id:orderId,amount,already:false};
 } catch(e) {await c.query('ROLLBACK');throw e} finally {c.release()}
}

const serveStatic=require('./static-files')(path.join(__dirname,'public'));
async function route(req,res){for(const [k,v]of Object.entries(securityHeaders))res.setHeader(k,v);const u=new URL(req.url,'http://localhost');const p=u.pathname;
if(!sameOrigin(req,res))return;
if(req.method==='GET'&&p==='/api/health'){let db='pilot';if(pool){try{await pool.query('SELECT 1');db='ready'}catch{db='unavailable'}}return send(res,db==='unavailable'?503:200,{ok:db!=='unavailable',mode,database:db,pilot:mode==='pilot',notice:mode==='pilot'?'BẢN THỬ NGHIỆM: đơn hàng lưu RAM và bị xóa khi server khởi động lại. Không dùng vận hành thật.':'Dữ liệu được lưu trên PostgreSQL.'})}
// Available only on the isolated staging branch with the explicit staging flag.
// The DB must contain an independent marker before any load generation starts.
if(req.method==='GET'&&p==='/api/loadtest/identity'&&process.env.SALES_STAGING==='true'){
 if(!pool)return err(res,503,'Staging requires PostgreSQL.');
 const check=await pool.query("SELECT current_database() AS database,EXISTS(SELECT 1 FROM loadtest_identity WHERE marker='saleshub-isolated-neon-staging-20261028') AS isolated");
 const value=check.rows[0];
 if(value.database!=='saleshub_loadtest'||value.isolated!==true)return err(res,503,'Refusing load test against a non-staging database.');
 return send(res,200,{isolated:true,environment:'staging',database:value.database});
}
if(req.method==='POST'&&p==='/api/login')return err(res,410,'Hãy dùng tên đăng nhập và mật khẩu riêng do chủ cửa hàng cấp.');
if(req.method==='POST'&&p==='/api/admin/login'){
 if(!throttle(req,'admin-login',6))return err(res,429,'Đăng nhập quá nhiều lần. Hãy thử lại sau.');
 const b=await input(req);
 // Once owner email is configured, all owner logins require verified email.
 if(await ownerAccounts.exists()){
  const owner=await ownerAccounts.login(b.email,b.password);
  return send(res,200,{ok:true,role:'admin',email:owner.email},{'Set-Cookie':ownerCookie(owner)});
 }
 // Transitional fallback only if no email owner account has been provisioned.
 if(!ADMIN_PASSWORD)return err(res,503,'Chưa cấu hình tài khoản quản trị.');
 if(!safeEq(String(b.password||''),ADMIN_PASSWORD))return err(res,401,'Email hoặc mật khẩu không chính xác.');
 // First successful verified legacy login with the designated owner email activates
 // its scrypt credentials atomically; no raw password is ever stored in PostgreSQL.
 if(pool&&String(b.email||'').trim().toLowerCase()==='mas24080419@hsb.edu.vn'){
  const owner=await ownerAccounts.activate(b.email,b.password);
  return send(res,200,{ok:true,role:'admin',email:owner.email},{'Set-Cookie':ownerCookie(owner)});
 }
 return send(res,200,{ok:true,role:'admin'},{'Set-Cookie':loginCookie('admin')});
}
if(req.method==='POST'&&p==='/api/admin/activate-owner'){
 if(!throttle(req,'owner-first-activation',5))return err(res,429,'Thao tác quá nhiều lần.');
 const actor=await identity(req);
 if(actor?.role!=='admin'||!actor.legacy)return err(res,403,'Chỉ phiên quản trị hiện tại được kích hoạt email lần đầu.');
 if(await ownerAccounts.exists())return err(res,409,'Tài khoản email đã được kích hoạt.');
 const b=await input(req),owner=await ownerAccounts.activate(b.email,b.newPassword);
 return send(res,201,{ok:true,role:'admin',email:owner.email},{'Set-Cookie':ownerCookie(owner)});
}
if(req.method==='POST'&&p==='/api/admin/change-password'){
 if(!throttle(req,'owner-password-change',8))return err(res,429,'Thao tác quá nhiều. Hãy thử lại sau.');
 const actor=await identity(req);
 if(actor?.role!=='admin'||!actor.userId)return err(res,401,'Cần đăng nhập tài khoản quản trị bằng email.');
 const body=await input(req);
 const changed=await ownerAccounts.changePassword(actor.userId,body.currentPassword,body.newPassword);
 return send(res,200,{ok:true,message:'Đổi mật khẩu thành công. Mọi phiên cũ đã hết hiệu lực.'},{'Set-Cookie':ownerCookie(changed)});
}
if(req.method==='POST'&&p==='/api/users/login'){
 if(!throttle(req,'staff-user-login',8))return err(res,429,'Đăng nhập quá nhiều lần.');
 const b=await input(req),user=await staffAccounts.login(b.username,b.password);
 return send(res,200,{ok:true,role:user.role,displayName:user.displayName,workArea:user.workArea},{'Set-Cookie':staffCookie(user)});
}
if(req.method==='POST'&&p==='/api/logout'){return send(res,200,{ok:true},{'Set-Cookie':'sh_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'})}
// Sessions represent open QR-menu tabs, not camera scans.
if(req.method==='POST'&&p==='/api/qr/presence'){
 if(!pool)return err(res,503,'Giám sát QR cần PostgreSQL.');
 return send(res,200,await qrPresence.heartbeat(await input(req),getTable));
}
if(req.method==='POST'&&p==='/api/qr/leave')return send(res,200,qrPresence.leave(await input(req)));
if(req.method==='GET'&&p==='/api/admin/qr/presence'){
 if(!await requireAdmin(req,res))return;
 return send(res,200,qrPresence.snapshot());
}
if(req.method==='GET'&&p==='/api/admin/architecture'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'architecture-read',50))return err(res,429,'Làm mới giám sát quá nhanh.');
 return send(res,200,{model:architectureMonitor.model,monitor:await architectureMonitor.snapshot(pool)});
}
if(req.method==='GET'&&p==='/api/admin/architecture/recent'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'architecture-orders',40))return err(res,429,'Làm mới luồng đơn quá nhanh.');
 return send(res,200,await orderLive.recent());
}
if(req.method==='GET'&&p==='/api/admin/architecture/live'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'architecture-stream',15))return err(res,429,'Mở luồng giám sát quá nhanh.');
 return orderLive.attach(req,res,async()=>{req._verified=false;return (await identity(req))?.role==='admin'});
}
if(req.method==='GET'&&p==='/api/admin/architecture/system/recent'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'architecture-system-read',35))return err(res,429,'Làm mới nhật ký quá nhanh.');
 return send(res,200,await systemFlow.recent());
}
if(req.method==='GET'&&p==='/api/admin/architecture/system/live'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'architecture-system-stream',12))return err(res,429,'Mở quá nhiều kết nối.');
 return systemFlow.attach(req,res,async()=>{req._verified=false;return (await identity(req))?.role==='admin'});
}
if(req.method==='GET'&&p==='/api/me'){const a=await identity(req);return send(res,200,{staff:!!a,role:a?.role||null,username:a?.username||null,email:a?.email||null,needsOwnerSetup:Boolean(a?.role==='admin'&&a?.legacy),displayName:a?.displayName||null,workArea:a?.workArea||null})}
if(req.method==='GET'&&p.startsWith('/api/menu/')){const t=await getTable(p.slice('/api/menu/'.length));if(!t)return err(res,404,'QR không hợp lệ.');return send(res,200,{table:{name:t.name,zone:t.zone},items:await getMenu(),mode})}
if(req.method==='GET'&&p==='/api/payment/recipient'){
 const table=await getTable(u.searchParams.get('token')||'');
 if(!table)return err(res,404,'QR bàn không hợp lệ hoặc đã khóa.');
 const recipient=await paymentRecipient.publicRecipient();
 return send(res,200,{configured:Boolean(recipient),recipient});
}
if(req.method==='GET'&&p==='/api/admin/payment-banks'){
 if(!await requireAdmin(req,res))return;
 return send(res,200,await paymentRecipient.banks());
}
if(p==='/api/admin/payment-settings'){
 if(!await requireAdmin(req,res))return;
 if(req.method==='GET')return send(res,200,{payment:await paymentRecipient.get()});
 if(req.method==='PUT'){
  if(!throttle(req,'merchant-bank',10))return err(res,429,'Thao tác cấu hình quá nhanh.');
  return send(res,200,{payment:await paymentRecipient.set(await input(req))});
 }
 return err(res,405,'Phương thức không được hỗ trợ.');
}
if(req.method==='POST'&&p==='/api/orders'){if(!throttle(req,'orders',25))return err(res,429,'Gửi món quá nhanh.');const a=await placeOrder(await input(req),req);return send(res,a.duplicate?200:201,a)}
 if(req.method==='GET'&&p==='/api/staff/menu'){
  if(!await requireAuth(req,res))return;
  if(!canManageOrders(await identity(req)))return err(res,403,'Không có quyền gọi món.');
  return send(res,200,{items:await getMenu()});
 }
 if(p==='/api/staff/orders'){
  if(!await requireAuth(req,res))return;
  const actor=await identity(req);
  if(!canManageOrders(actor))return err(res,403,'Không có quyền quản lý đơn.');
  systemFlow.mark(req,'auth','Quyền gọi món nhân viên đã được xác minh');
  if(req.method==='GET'){
   if(!throttle(req,'staff-orders-read',120))return err(res,429,'Làm mới quá nhanh.');
   const all=await staffOrdersCache.get();
   return send(res,200,{orders:all.slice(0,100).map(o=>({...o,total_vnd:o.items.reduce((s,i)=>s+(i.status==='cancelled'?0:Number(i.unit_price)*Number(i.quantity)),0)}))});
  }
  if(req.method==='POST'){
   if(!throttle(req,'staff-orders-create',35))return err(res,429,'Gọi món quá nhanh.');
   const order=await placeOrder(await input(req),req,actor);
   return send(res,order.duplicate?200:201,order);
  }
  return err(res,405,'Phương thức không hỗ trợ.');
 }
 if(req.method==='POST'&&/^\/api\/staff\/orders\/[0-9a-f-]{36}\/confirm-payment$/.test(p)){
  if(!await requireAuth(req,res))return;
  const actor=await identity(req);
  if(!canConfirmOrderPayment(actor))return err(res,403,'Chỉ Thu ngân hoặc Quản lý được xác nhận thanh toán.');
  systemFlow.mark(req,'auth','Đã xác minh quyền xác nhận thanh toán');
  if(!throttle(req,'staff-payment',40))return err(res,429,'Xác nhận quá nhanh.');
  const b=await input(req);
  if(b.confirm!==true)return err(res,400,'Hãy xác nhận đã nhận đủ tiền.');
  systemFlow.mark(req,'finance','Đang xác nhận thanh toán đơn hàng');
  const payment=await confirmPayment(p.split('/')[4],b.paymentMethod,actor);
  systemFlow.mark(req,'pg',payment.already?'Đơn đã thu tiền từ trước':'Thanh toán đã lưu PostgreSQL');
  return send(res,200,{payment});
 }




if(p==='/api/admin/users'||/^\/api\/admin\/users\/[0-9a-f-]{36}$/.test(p)){
 if(!await requireAdmin(req,res))return;
 if(req.method==='GET'&&p==='/api/admin/users')return send(res,200,{users:await staffAccounts.list()});
 if(req.method==='POST'&&p==='/api/admin/users'){
  if(!throttle(req,'staff-create',15))return err(res,429,'Thao tác quá nhanh.');
  return send(res,201,{user:await staffAccounts.create(await input(req))});
 }
 if(req.method==='PATCH'){
  if(!throttle(req,'staff-update',20))return err(res,429,'Thao tác quá nhanh.');
  return send(res,200,{user:await staffAccounts.modify(p.split('/')[4],await input(req))});
 }
}

if(p.startsWith('/api/admin/core/')){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'core-'+req.method,80))return err(res,429,'Quá nhiều thao tác quản trị.');
 const seg=p.split('/').filter(Boolean),domain=seg[3],resourceId=seg[4],action=seg[5];
 const body=['POST','PATCH','PUT'].includes(req.method)?await input(req):{};
 const method=req.method;
 const ok=(obj,status=200)=>send(res,status,obj);
 if(domain==='catalog'){
  if(method==='GET'&&!resourceId)return ok({items:await core.catalog()});
  if(method==='POST'&&!resourceId)return ok({item:await core.saveMenu(body)},201);
  if(method==='PATCH'&&resourceId&&!action)return ok({item:await core.saveMenu(body,resourceId)});
  if(method==='PATCH'&&resourceId&&action==='availability')return ok({item:await core.menuAvailability(resourceId,body.active)});
 }
 if(domain==='tables'){
  if(method==='GET'&&!resourceId)return ok({tables:await core.allTables()});
  if(method==='POST'&&!resourceId)return ok({table:await core.createTable(body)},201);
  if(method==='PATCH'&&resourceId&&!action)return ok({table:await core.updateTable(resourceId,body)});
  if(method==='POST'&&resourceId&&action==='rotate-qr'){
   if(body.confirm!==true)return err(res,400,'Phải xác nhận thay mã QR của bàn.');
   return ok({table:await core.rotateTableToken(resourceId)});
  }
 }
 if(domain==='suppliers'){
  if(method==='GET'&&!resourceId)return ok({suppliers:await core.suppliers()});
  if(method==='POST'&&!resourceId)return ok({supplier:await core.saveSupplier(body)},201);
  if(method==='PATCH'&&resourceId)return ok({supplier:await core.saveSupplier(body,resourceId)});
 }
 if(domain==='customers'){
  if(method==='GET'&&!resourceId)return ok({customers:await core.customers(u.searchParams.get('limit')||100)});
  if(method==='POST'&&!resourceId)return ok({customer:await core.saveCustomer(body)},201);
  if(method==='PATCH'&&resourceId)return ok({customer:await core.saveCustomer(body,resourceId)});
 }
 if(domain==='reservations'){
  if(method==='GET'&&!resourceId){
   const from=u.searchParams.get('from'),to=u.searchParams.get('to');
   if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>366*86400000)return err(res,400,'Khoảng thời gian đặt bàn không hợp lệ');
   return ok({reservations:await core.reservations(from,to)});
  }
  if(method==='POST'&&!resourceId)return ok({reservation:await core.makeReservation(body)},201);
  if(method==='PATCH'&&resourceId&&action==='status')return ok({reservation:await core.setReservationStatus(resourceId,body.status)});
 }
 if(domain==='shift'){
  if(method==='GET'&&!resourceId)return ok({shift:await core.currentShift()});
  if(method==='POST'&&!resourceId&&body.action==='open')return ok({shift:await core.openShift(body.openingCash)},201);
  if(method==='POST'&&!resourceId&&body.action==='close'){
   if(body.confirm!==true)return err(res,400,'Cần xác nhận kiểm đếm tiền trước khi đóng ca.');
   return ok({shift:await core.closeShift(body.countedCash,body.note)});
  }
 }
 if(domain==='audit'&&method==='GET'&&!resourceId)return ok({events:await core.recentAudit(Number(u.searchParams.get('limit'))||100)});
 return err(res,404,'Không tồn tại chức năng quản trị này.');
}

if(req.method==='GET'&&p==='/api/admin/operations'){
 if(!await requireAdmin(req,res))return;
 const range=adminDateRange(u.searchParams);
 return send(res,200,{...await ops.overview(range.from,range.to),range});
}
if(req.method==='GET'&&p==='/api/admin/inventory'){
 if(!await requireAdmin(req,res))return;
 systemFlow.mark(req,'inventory','Đang đọc bảng tồn kho và biến động');const inventory=await ops.inventoryDashboard();systemFlow.mark(req,'pg','SELECT tồn kho hoàn thành');return send(res,200,inventory);
}
const thresholdAction=p.match(/^\/api\/admin\/inventory\/items\/([0-9a-f-]{36})\/reorder$/i);
if(req.method==='PATCH'&&thresholdAction){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'reorder',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang ghi thay đổi ngưỡng tồn');const item=await ops.updateReorderLevel(thresholdAction[1],data);systemFlow.mark(req,'pg','Thay đổi ngưỡng đã COMMIT');return send(res,200,{item});
}
if(req.method==='POST'&&p==='/api/admin/inventory/items'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'inventory',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang ghi nguyên liệu');const item=await ops.createItem(data);systemFlow.mark(req,'pg','Nguyên liệu đã lưu vào PostgreSQL');return send(res,201,{item});
}
if(req.method==='PUT'&&p==='/api/admin/inventory/recipes'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'recipe',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang lưu công thức');const recipe=await ops.setRecipe(data);systemFlow.mark(req,'pg','Công thức đã COMMIT');return send(res,200,{recipe});
}
if(req.method==='POST'&&p==='/api/admin/inventory/movements'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'movement',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang cập nhật tồn và phiếu nhập/xuất');const movement=await ops.move(data);systemFlow.mark(req,'pg','Biến động kho đã COMMIT');return send(res,201,{movement});
}
if(req.method==='POST'&&p==='/api/admin/finance/entries'){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'finance',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang ghi sổ thu–chi');const entry=await ops.entry(data);systemFlow.mark(req,'pg','Phiếu thu–chi đã COMMIT');return send(res,201,{entry});
}
if(req.method==='GET'&&p==='/api/admin/analytics'){
 if(!await requireAdmin(req,res))return;
 const range=adminDateRange(u.searchParams);
 systemFlow.mark(req,'finance','Đang tính tổng hợp thu–chi');const report=await analytics.overview(range.from,range.to);systemFlow.mark(req,'pg','Đọc dữ liệu báo cáo hoàn thành');return send(res,200,report);
}
if(req.method==='GET'&&p==='/api/admin/summary'){
 if(!await requireAdmin(req,res))return;
 const range=adminDateRange(u.searchParams);
 systemFlow.mark(req,'finance','Đang tổng hợp báo cáo');const summary=await adminReport(range.from,range.to);systemFlow.mark(req,'pg','Đọc dữ liệu tổng hợp hoàn thành');return send(res,200,{...summary,range});
}
if(req.method==='POST'&&/^\/api\/admin\/orders\/[0-9a-f-]{36}\/confirm-payment$/.test(p)){
 if(!await requireAdmin(req,res))return;
 if(!throttle(req,'admin-payment',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);
 if(data.confirm!==true)return err(res,400,'Cần xác nhận đã thực sự nhận đủ tiền.');
 systemFlow.mark(req,'tx','Đang xác nhận thanh toán');const payment=await confirmPayment(p.split('/')[4],data.paymentMethod);systemFlow.mark(req,'pg','Xác nhận tiền đã COMMIT');return send(res,200,{payment});
}
if(p==='/api/lockers'&&req.method==='GET'){
 if(!await requireAuth(req,res))return;
 systemFlow.mark(req,'rental','Đang tải tủ đang thuê và tủ trống');const lockers=await lockerService.list(await identity(req));systemFlow.mark(req,'pg','Đọc trạng thái tủ hoàn thành');return send(res,200,lockers);
}
const lockerAction=p.match(/^\/api\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/(rent|release|collect)$/);
if(lockerAction&&req.method==='POST'){
 if(!await requireAuth(req,res))return;
 const actor=await identity(req);
 if(!canAccessArea(actor,'equipment'))return err(res,403,'Không có quyền quản lý tủ đồ.');
 if(!throttle(req,'locker-action',40))return err(res,429,'Thao tác quá nhanh.');
 const data=await input(req);systemFlow.mark(req,'tx','Đang xử lý giao dịch thuê/trả tủ');const result=await lockerService[lockerAction[2]](actor,lockerAction[1],data);systemFlow.mark(req,'pg','Giao dịch tủ đã COMMIT');
 return send(res,200,result);
}
if(p==='/api/area/receipts'){
 if(!await requireAuth(req,res))return;
 const actor=await identity(req),area=u.searchParams.get('area')||actor.workArea;
 if(!canAccessArea(actor,area))return err(res,403,'Không có quyền truy cập khu vực này.');
 if(req.method==='GET')return send(res,200,await areaReceipts.list(actor,area));
 if(req.method==='POST'){
  if(!throttle(req,'area-receipt',30))return err(res,429,'Thao tác quá nhanh.');
  const data=await input(req);systemFlow.mark(req,'tx','Đang tạo phiếu thu dịch vụ');const receipt=await areaReceipts.create(actor,area,data);systemFlow.mark(req,'pg','Phiếu thu dịch vụ đã COMMIT');return send(res,201,receipt);
 }
 return err(res,405,'Phương thức không được hỗ trợ.');
}
if(req.method==='GET'&&p==='/api/tables'){if(!await requireAuth(req,res))return;if(!canUseDining(await identity(req))||!canSeeTables((await identity(req)).role))return err(res,403,'Vai trò này không được xem mã QR bàn.');return send(res,200,{tables:await getTables()})}
if(req.method==='GET'&&p==='/api/order-status'){return err(res,400,'Vui lòng cung cấp mã đơn.')}if(req.method==='GET'&&p.startsWith('/api/order-status/')){if(!throttle(req,'status',120))return err(res,429,'Quá nhiều lần kiểm tra');const oid=p.split('/').at(-1);if(!/^[0-9a-f-]{36}$/.test(oid))return err(res,400,'Mã đơn không hợp lệ');const data=await orderStatus(oid,u.searchParams.get('token'));return data?send(res,200,data):err(res,404,'Không tìm thấy đơn, hãy hỏi nhân viên trước khi gửi lại')}
if(req.method==='GET'&&p==='/api/history'){if(!await requireAdmin(req,res))return;const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(u.searchParams.get('offset'))||0));return send(res,200,{orders:await history(limit,offset),persistent:!!pool})}
if(req.method==='GET'&&p==='/api/kds'){if(!await requireAuth(req,res))return;
 const actor=await identity(req);
 if(!canUseDining(actor))return err(res,403,'Không có quyền xem đơn Bếp/Bar.');
 systemFlow.mark(req,'kds','Đang truy vấn hàng đợi Bếp / Bar');const fetchedOrders=await kdsCache.get();systemFlow.mark(req,'pg','SELECT danh sách đơn và món hoàn thành');const visible=fetchedOrders.map(o=>({...o,
  payment_method:canSeeTables(actor.role)?o.payment_method:null,
  payment_status:canSeeTables(actor.role)?o.payment_status:null,
  items:o.items.filter(line=>actor.role==='kitchen'?line.station==='kitchen':actor.role==='bar'?line.station==='bar':true)
  .map(({unit_price,...line})=>line)})).filter(o=>o.items.length);
 systemFlow.mark(req,'kds','Đã lọc danh sách theo trạm chế biến',visible.reduce((n,o)=>n+o.items.length,0));return send(res,200,{orders:visible})}
if(req.method==='PATCH'&&/^\/api\/items\/[0-9a-f-]{36}$/.test(p)){if(!await requireAuth(req,res))return;const a=await identity(req);if(!canUseDining(a)||!(canCook(a.role)||canManageOrders(a)))return err(res,403,'Vai trò này không được cập nhật món.');const b=await input(req);return send(res,200,{item:await updateLine(p.split('/').at(-1),b.status,a,req)})}
if(req.method==='GET'&&/^\/qr\/[0-9a-f]{48}\.svg$/.test(p)){if(!await requireAuth(req,res))return;if(!canUseDining(await identity(req))||!canSeeTables((await identity(req)).role))return err(res,403,'Không có quyền lấy QR bàn.');const t=p.slice(4,-4);if(!(await getTable(t)))return err(res,404,'Không tìm thấy bàn.');const origin=`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`;const svg=await QRCode.toString(origin+'/t/'+t,{type:'svg',margin:2,width:320,errorCorrectionLevel:'M'});res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});res.end(svg);return}
if(req.method==='GET'&&p==='/admin/architecture'&&(await identity(req))?.role!=='admin'){
 res.writeHead(302,{'Location':'/admin','Cache-Control':'no-store'});res.end();return;
}
if(await serveStatic(req,res,p))return;
err(res,404,'Không có tài nguyên.');}
async function main(){
 await init();
 // Owner's initial credential is injected once through Render's secret settings,
 // hashed with per-account salt inside the application, then discarded from RAM.
 if(pool){
  const email=process.env.OWNER_BOOTSTRAP_EMAIL;
  const secret=process.env.OWNER_BOOTSTRAP_PASSWORD;
  delete process.env.OWNER_BOOTSTRAP_PASSWORD;
  if(email&&secret&&!await ownerAccounts.exists()){
   await ownerAccounts.activate(email,secret);
   console.log('Owner email account securely initialized.');
  }
 }
 http.createServer((req,res)=>{systemFlow.trackRequest(req,res);return route(req,res).catch(e=>{console.error('request failed',e.message);err(res,e.status||500,e.status?e.message:'Lỗi máy chủ')})}).listen(PORT,'0.0.0.0',()=>console.log(`SalesHub ${mode} listening ${PORT}`))}main().catch(e=>{console.error('startup failed',e.message);process.exit(1)});
