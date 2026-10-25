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
function session(req){const v=cookie(req);if(!v)return false;const [exp,mac]=v.split('.');if(!/^\d+$/.test(exp)||!mac||Number(exp)<Date.now())return false;const good=crypto.createHmac('sha256',SESSION_SECRET).update(exp).digest('hex');return safeEq(mac,good)}
const requireAuth=(req,res)=>{if(!session(req)){err(res,401,'Cần đăng nhập nhân viên.');return false}return true};
const input=async req=>{let s='';for await(const ch of req){s+=ch;if(s.length>18000)throw Object.assign(Error('Dữ liệu quá lớn'),{status:413})}try{return JSON.parse(s||'{}')}catch{throw Object.assign(Error('JSON không hợp lệ'),{status:400})}};
const sameOrigin=(req,res)=>{if(!['POST','PATCH','PUT','DELETE'].includes(req.method))return true;const origin=req.headers.origin;if(!origin)return true;const host=`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`;if(origin!==host){err(res,403,'Nguồn yêu cầu không hợp lệ.');return false}return true};
const clientIp=req=>(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
function throttle(req,action,max=25){const k=action+':'+clientIp(req);const now=Date.now(),v=attempts.get(k)||{t:now,n:0};if(now-v.t>60000){v.t=now;v.n=0}v.n++;attempts.set(k,v);return v.n<=max}
async function getTables(){return pool?(await pool.query('SELECT id,name,token,zone,active FROM dining_tables ORDER BY name')).rows:tables}
async function getMenu(){return pool?(await pool.query('SELECT id,name,category,price,station,active FROM menu_items WHERE active=true ORDER BY category,name')).rows:menu.filter(x=>x.active)}
async function getTable(t){return pool?(await pool.query('SELECT id,name,token,zone,active FROM dining_tables WHERE token=$1 AND active=true',[t])).rows[0]:tables.find(x=>x.token===t&&x.active)}
async function placeOrder(body){if(!body||typeof body.token!=='string'||!Array.isArray(body.items)||!body.items.length||body.items.length>30)throw Object.assign(Error('Đơn không hợp lệ.'),{status:400});
if(!/^[0-9a-f-]{36}$/.test(body.requestId||''))throw Object.assign(Error('Mã gửi lại không hợp lệ.'),{status:400});const t=await getTable(body.token);if(!t)throw Object.assign(Error('Không tìm thấy bàn hoặc QR đã khóa.'),{status:404});
const note=String(body.note||'').slice(0,160);const m=await getMenu(),lookup=new Map(m.map(x=>[x.id,x]));const items=body.items.map(it=>{const p=lookup.get(it.id);if(!p||!Number.isSafeInteger(it.qty)||it.qty<1||it.qty>20)throw Object.assign(Error('Món hoặc số lượng không hợp lệ.'),{status:400});return {...p,qty:it.qty,note:String(it.note||'').slice(0,160)}});if(items.reduce((s,x)=>s+x.qty,0)>60)throw Object.assign(Error('Quá số lượng một lần gửi.'),{status:400});
if(!pool){const exists=orders.find(x=>x.table_id===t.id&&x.request_id===body.requestId);if(exists)return {id:exists.id,duplicate:true};const o={id:id(),table_id:t.id,request_id:body.requestId,note,created_at:new Date().toISOString()};orders.push(o);for(const it of items)lines.push({id:id(),order_id:o.id,menu_item_id:it.id,name:it.name,quantity:it.qty,unit_price:it.price,station:it.station,note:it.note,status:'new',created_at:o.created_at});return {id:o.id,duplicate:false}}
const c=await pool.connect();try{await c.query('BEGIN');const orderId=id();const o=await c.query('INSERT INTO dining_orders(id,table_id,request_id,note) VALUES($1,$2,$3,$4) ON CONFLICT(table_id,request_id) DO NOTHING RETURNING id',[orderId,t.id,body.requestId,note]);if(!o.rowCount){const prev=await c.query('SELECT id FROM dining_orders WHERE table_id=$1 AND request_id=$2',[t.id,body.requestId]);await c.query('COMMIT');return {id:prev.rows[0].id,duplicate:true}}for(const it of items)await c.query('INSERT INTO dining_order_lines(id,order_id,menu_item_id,name,quantity,unit_price,station,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(),orderId,it.id,it.name,it.qty,it.price,it.station,it.note]);await c.query('INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)',[orderId,'guest','order_created',JSON.stringify({table:t.name,item_count:items.length})]);await c.query('COMMIT');console.log('ORDER_COMMITTED',orderId,t.name,items.length);return {id:orderId,duplicate:false}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
async function getOrders(){if(!pool)return orders.map(o=>({...o,table_name:tables.find(t=>t.id===o.table_id)?.name,items:lines.filter(l=>l.order_id===o.id)})).reverse();const q=await pool.query('SELECT o.id,o.created_at,o.note,t.name AS table_name,li.id AS line_id,li.name AS item_name,li.quantity,li.unit_price,li.station,li.note AS item_note,li.status FROM dining_orders o JOIN dining_tables t ON o.table_id=t.id LEFT JOIN dining_order_lines li ON li.order_id=o.id WHERE o.created_at > now()- interval \'7 days\' OR EXISTS (SELECT 1 FROM dining_order_lines pending WHERE pending.order_id=o.id AND pending.status IN (\'new\',\'preparing\',\'ready\')) ORDER BY o.created_at DESC');const map=new Map();for(const x of q.rows){let o=map.get(x.id);if(!o){o={id:x.id,table_name:x.table_name,note:x.note,created_at:x.created_at,items:[]};map.set(x.id,o)}if(x.line_id)o.items.push({id:x.line_id,name:x.item_name,quantity:x.quantity,unit_price:x.unit_price,station:x.station,note:x.item_note,status:x.status})}return [...map.values()]}
async function updateLine(lineId,status){const allowed={new:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['served'],served:[],cancelled:[]};if(!Object.values(allowed).flat().includes(status))throw Object.assign(Error('Trạng thái không hợp lệ.'),{status:400});if(!pool){const line=lines.find(x=>x.id===lineId);if(!line)throw Object.assign(Error('Không tìm thấy món.'),{status:404});if(!allowed[line.status].includes(status))throw Object.assign(Error('Chuyển trạng thái không hợp lệ.'),{status:409});line.status=status;return line}const c=await pool.connect();try{await c.query('BEGIN');const x=(await c.query('SELECT status FROM dining_order_lines WHERE id=$1 FOR UPDATE',[lineId])).rows[0];if(!x)throw Object.assign(Error('Không tìm thấy món.'),{status:404});if(!allowed[x.status].includes(status))throw Object.assign(Error('Chuyển trạng thái không hợp lệ.'),{status:409});const row=(await c.query('UPDATE dining_order_lines SET status=$2, updated_at=now() WHERE id=$1 RETURNING id,status',[lineId,status])).rows[0];await c.query('INSERT INTO dining_audit(order_id,item_id,actor,action,detail) SELECT order_id,$1,$2,$3,$4::jsonb FROM dining_order_lines WHERE id=$1',[lineId,'staff','item_status_changed',JSON.stringify({from:x.status,to:status})]);await c.query('COMMIT');return row}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}

async function orderStatus(orderId,qrToken){
 const t=await getTable(qrToken);if(!t)return null;
 if(!pool){const o=orders.find(x=>x.id===orderId&&x.table_id===t.id);if(!o)return null;return {id:o.id,table_name:t.name,created_at:o.created_at,persistent:false,items:lines.filter(x=>x.order_id===o.id).map(x=>({name:x.name,quantity:x.quantity,status:x.status,station:x.station}))}}
 const o=(await pool.query('SELECT id,created_at FROM dining_orders WHERE id=$1 AND table_id=$2',[orderId,t.id])).rows[0];if(!o)return null;
 const result=await pool.query('SELECT name,quantity,status,station FROM dining_order_lines WHERE order_id=$1 ORDER BY created_at,id',[o.id]);
 return {id:o.id,table_name:t.name,created_at:o.created_at,persistent:true,items:result.rows};
}
async function history(limit,offset){
 if(!pool){const all=await getOrders();return all.slice(offset,offset+limit).map(x=>({...x,payment_status:'unpaid'}))}
 const q=await pool.query('SELECT o.id,o.created_at,o.note,o.payment_status,t.name AS table_name,COALESCE(SUM(CASE WHEN li.status<>$3 THEN li.quantity*li.unit_price ELSE 0 END),0)::bigint AS total_vnd,COUNT(li.id)::integer AS line_count FROM dining_orders o JOIN dining_tables t ON o.table_id=t.id LEFT JOIN dining_order_lines li ON li.order_id=o.id GROUP BY o.id,t.name ORDER BY o.created_at DESC LIMIT $1 OFFSET $2',[limit,offset,'cancelled']);
 return q.rows;
}
const publicDir=path.join(__dirname,'public');const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml; charset=utf-8'};
function staticPage(req,res,p){const file=path.join(publicDir,p);if(!file.startsWith(publicDir+path.sep))return err(res,404,'Không tìm thấy trang.');fs.readFile(file,(e,data)=>{if(e)return err(res,404,'Không tìm thấy trang.');res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'text/plain','Cache-Control':'no-store'});res.end(data)})}
async function route(req,res){for(const [k,v]of Object.entries(securityHeaders))res.setHeader(k,v);const u=new URL(req.url,'http://localhost');const p=u.pathname;
if(!sameOrigin(req,res))return;
if(req.method==='GET'&&p==='/api/health'){let db='pilot';if(pool){try{await pool.query('SELECT 1');db='ready'}catch{db='unavailable'}}return send(res,db==='unavailable'?503:200,{ok:db!=='unavailable',mode,database:db,pilot:mode==='pilot',notice:mode==='pilot'?'BẢN THỬ NGHIỆM: đơn hàng lưu RAM và bị xóa khi server khởi động lại. Không dùng vận hành thật.':'Dữ liệu được lưu trên PostgreSQL.'})}
if(req.method==='POST'&&p==='/api/login'){if(!throttle(req,'login',8))return err(res,429,'Đăng nhập quá nhiều lần.');const b=await input(req);if(!safeEq(String(b.password||''),STAFF_PASSWORD))return err(res,401,'Mật khẩu không chính xác.');const exp=String(Date.now()+8*60*60*1000),sig=crypto.createHmac('sha256',SESSION_SECRET).update(exp).digest('hex');return send(res,200,{ok:true},{'Set-Cookie':`sh_session=${exp}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`})}
if(req.method==='POST'&&p==='/api/logout'){return send(res,200,{ok:true},{'Set-Cookie':'sh_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'})}
if(req.method==='GET'&&p==='/api/me')return send(res,200,{staff:session(req)});
if(req.method==='GET'&&p.startsWith('/api/menu/')){const t=await getTable(p.slice('/api/menu/'.length));if(!t)return err(res,404,'QR không hợp lệ.');return send(res,200,{table:{name:t.name,zone:t.zone},items:await getMenu(),mode})}
if(req.method==='POST'&&p==='/api/orders'){if(!throttle(req,'orders',25))return err(res,429,'Gửi món quá nhanh.');const a=await placeOrder(await input(req));return send(res,a.duplicate?200:201,a)}
if(req.method==='GET'&&p==='/api/tables'){if(!requireAuth(req,res))return;return send(res,200,{tables:await getTables()})}
if(req.method==='GET'&&p==='/api/order-status'){return err(res,400,'Vui lòng cung cấp mã đơn.')}if(req.method==='GET'&&p.startsWith('/api/order-status/')){if(!throttle(req,'status',120))return err(res,429,'Quá nhiều lần kiểm tra');const oid=p.split('/').at(-1);if(!/^[0-9a-f-]{36}$/.test(oid))return err(res,400,'Mã đơn không hợp lệ');const data=await orderStatus(oid,u.searchParams.get('token'));return data?send(res,200,data):err(res,404,'Không tìm thấy đơn, hãy hỏi nhân viên trước khi gửi lại')}
if(req.method==='GET'&&p==='/api/history'){if(!requireAuth(req,res))return;const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(u.searchParams.get('offset'))||0));return send(res,200,{orders:await history(limit,offset),persistent:!!pool})}
if(req.method==='GET'&&p==='/api/kds'){if(!requireAuth(req,res))return;return send(res,200,{orders:await getOrders()})}
if(req.method==='PATCH'&&/^\/api\/items\/[0-9a-f-]{36}$/.test(p)){if(!requireAuth(req,res))return;const b=await input(req);return send(res,200,{item:await updateLine(p.split('/').at(-1),b.status)})}
if(req.method==='GET'&&/^\/qr\/[0-9a-f]{48}\.svg$/.test(p)){if(!requireAuth(req,res))return;const t=p.slice(4,-4);if(!(await getTable(t)))return err(res,404,'Không tìm thấy bàn.');const origin=`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`;const svg=await QRCode.toString(origin+'/t/'+t,{type:'svg',margin:2,width:320,errorCorrectionLevel:'M'});res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});res.end(svg);return}
if(req.method==='GET'&&p.startsWith('/t/'))return staticPage(req,res,'guest.html');
if(req.method==='GET'&&(p==='/'||p==='/staff'))return staticPage(req,res,'staff.html');
if(req.method==='GET'&&p==='/style.css')return staticPage(req,res,'style.css');
err(res,404,'Không có tài nguyên.');}
async function main(){await init();http.createServer((req,res)=>route(req,res).catch(e=>{console.error('request failed',e.message);err(res,e.status||500,e.status?e.message:'Lỗi máy chủ')})).listen(PORT,'0.0.0.0',()=>console.log(`SalesHub ${mode} listening ${PORT}`))}main().catch(e=>{console.error('startup failed',e.message);process.exit(1)});
