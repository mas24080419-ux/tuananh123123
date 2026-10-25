'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),QR=require('qrcode');
const PORT=process.env.PORT||3000, password=process.env.STAFF_PASSWORD, secret=process.env.SESSION_SECRET;
if(!password||!secret)throw Error('Need STAFF_PASSWORD and SESSION_SECRET');
const uid=()=>crypto.randomUUID(), h=s=>crypto.createHmac('sha256',secret).update(String(s)).digest('hex');
const tables=Array.from({length:6},(_,i)=>({id:i+1,name:'Bàn '+String(i+1).padStart(2,'0'),zone:i<3?'Tầng 1':'Tầng 2',token:h('qr-table-'+(i+1)).slice(0,48)}));
const menu=[['Phở bò đặc biệt',65000,'kitchen'],['Bún chả Hà Nội',55000,'kitchen'],['Cơm gà',59000,'kitchen'],['Khoai tây chiên',35000,'kitchen'],['Trà đào cam sả',38000,'bar'],['Cà phê sữa đá',32000,'bar'],['Nước cam',42000,'bar']].map(([name,price,station],i)=>({id:i+1,name,price,station}));
const orders=[],requests=new Map(),limit=new Map();
const safe=(a,b)=>{const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
function logon(req){let cookie=(req.headers.cookie||'').match(/(?:^|;\s*)sh_staff=([^;]+)/);if(!cookie)return false;let [until,sig]=cookie[1].split('.');return !!(until&&sig&&Number(until)>Date.now()&&safe(sig,h('session:'+until)))}
function send(res,n,obj,headers={}){res.writeHead(n,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj))}
function bad(res,n,msg){send(res,n,{error:msg})}
function page(res,file){fs.readFile(path.join(__dirname,'public',file),(e,b)=>{if(e)return bad(res,404,'Không có trang');res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(b)})}
function slow(req,key,max){const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];let k=key+':'+ip,now=Date.now(),v=limit.get(k)||[now,0];if(now-v[0]>60000)v=[now,0];v[1]++;limit.set(k,v);return v[1]>max}
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>16000)throw {code:413,message:'Đơn quá lớn'}}try{return JSON.parse(raw||'{}')}catch{throw {code:400,message:'JSON không hợp lệ'}}}
function validTable(token){return tables.find(t=>t.token===token)}
function staff(req,res){if(logon(req))return true;bad(res,401,'Nhân viên chưa đăng nhập');return false}
async function handler(req,res){
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
const u=new URL(req.url,'http://localhost'),p=u.pathname,method=req.method;
if(['POST','PATCH','DELETE'].includes(method)){const origin=req.headers.origin;if(origin&&origin!==('https://'+req.headers.host)&&origin!==('http://'+req.headers.host))return bad(res,403,'Không đúng website')}
if(method==='GET'&&p==='/api/health')return send(res,200,{ok:true,mode:'pilot',database:'memory',persistent:false,warning:'PILOT: Đơn lưu RAM và mất khi máy chủ ngủ, khởi động lại hoặc deploy. Chưa dùng kinh doanh thật.'});
if(method==='POST'&&p==='/api/login'){if(slow(req,'login',8))return bad(res,429,'Thử quá nhiều lần');const b=await body(req);if(!safe(b.password||'',password))return bad(res,401,'Sai mật khẩu');let exp=String(Date.now()+28800000);return send(res,200,{ok:true},{'Set-Cookie':'sh_staff='+exp+'.'+h('session:'+exp)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'})}
if(method==='POST'&&p==='/api/logout')return send(res,200,{ok:true},{'Set-Cookie':'sh_staff=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
if(method==='GET'&&p==='/api/me')return send(res,200,{staff:logon(req)});
if(method==='GET'&&p==='/api/tables'){if(!staff(req,res))return;return send(res,200,{tables})}
if(method==='GET'&&p.startsWith('/api/menu/')){let t=validTable(p.slice(10));return t?send(res,200,{table:{name:t.name,zone:t.zone},items:menu,mode:'pilot'}):bad(res,404,'QR không hợp lệ')}
if(method==='POST'&&p==='/api/orders'){
if(slow(req,'orders',20))return bad(res,429,'Đặt món quá nhanh');
const b=await body(req),t=validTable(b.token);
if(!t)return bad(res,404,'Không đúng mã bàn');
if(!Array.isArray(b.items)||b.items.length<1||b.items.length>30||!/^[0-9a-f-]{36}$/.test(b.requestId||''))return bad(res,400,'Đơn không hợp lệ');
const key=t.id+':'+b.requestId;if(requests.has(key))return send(res,200,{id:requests.get(key),duplicate:true});
let lines=[];
for(const v of b.items){let m=menu.find(x=>x.id===v.id);if(!m||!Number.isInteger(v.qty)||v.qty<1||v.qty>20)return bad(res,400,'Số lượng hoặc món không hợp lệ');lines.push({id:uid(),name:m.name,quantity:v.qty,station:m.station,price:m.price,note:String(v.note||'').slice(0,120),status:'new'})}
if(lines.reduce((a,b)=>a+b.quantity,0)>60)return bad(res,400,'Quá nhiều món');
let o={id:uid(),table_name:t.name,table_id:t.id,created_at:new Date().toISOString(),note:String(b.note||'').slice(0,160),items:lines};orders.unshift(o);requests.set(key,o.id);return send(res,201,{id:o.id,duplicate:false});
}
if(method==='GET'&&p==='/api/kds'){if(!staff(req,res))return;return send(res,200,{orders:orders.slice(0,200)})}
if(method==='PATCH'&&/^\/api\/items\/[a-f0-9-]{36}$/.test(p)){if(!staff(req,res))return;const b=await body(req),line=orders.flatMap(o=>o.items).find(x=>x.id===p.split('/').at(-1));if(!line)return bad(res,404,'Không có món');const next={new:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['served'],served:[],cancelled:[]};if(!next[line.status].includes(b.status))return bad(res,409,'Sai thứ tự xử lý');line.status=b.status;return send(res,200,{item:line})}
if(method==='GET'&&/^\/qr\/[0-9a-f]{48}\.svg$/.test(p)){if(!staff(req,res))return;let t=validTable(p.slice(4,-4));if(!t)return bad(res,404,'QR không hợp lệ');let svg=await QR.toString('https://'+req.headers.host+'/t/'+t.token,{type:'svg',margin:2,width:280});res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});return res.end(svg)}
if(method==='GET'&&p==='/style.css')return page(res,'style.css');
if(method==='GET'&&p.startsWith('/t/'))return page(res,'guest.html');
if(method==='GET'&&(p==='/'||p==='/staff'))return page(res,'staff.html');
bad(res,404,'Không tìm thấy địa chỉ');
}
http.createServer((req,res)=>handler(req,res).catch(e=>{console.error('SalesHub error',e.message||e);bad(res,e.code||500,e.code?e.message:'Lỗi máy chủ')})).listen(PORT,'0.0.0.0',()=>console.log('SalesHub PILOT listening '+PORT));
