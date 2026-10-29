'use strict';
// Real HTTP/Postgres integration against EPHEMERAL CI database only.
// Do not point this script at production: it deliberately creates test orders.
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
if(process.env.REST_E2E_ISOLATED!=='true')throw Error('Refusing to run without isolated test database flag');
const url=process.env.REST_E2E_ORIGIN||'http://127.0.0.1:4812';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
async function call(path,opts={}){
 const res=await fetch(url+path,opts);
 let body={};try{body=await res.json()}catch{}
 return {status:res.status,body};
}
const json=data=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const percentile=(values,n)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*n)-1)]};
async function main(){
 let ok=false;
 for(let i=0;i<35;i++){
  try{if((await call('/api/v1/health')).status===200){ok=true;break}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert(ok,'REST test server never reported ready');
 const unauthorized=await call('/api/v1/finance/reports/profitability?from=2026-10-01&to=2026-10-29');
 assert([401,403].includes(unauthorized.status),'Finance report must require owner auth');
 const unknown=await call('/api/v1/not-supported');assert.equal(unknown.status,404);
 const tableToken=crypto.createHmac('sha256',process.env.SESSION_SECRET).update('qr-table-1').digest('hex').slice(0,48);
 const {status,body:menu}=await call('/api/v1/menu/'+tableToken);
 assert.equal(status,200,'QR table token must be valid');
 assert(menu.items?.length>0,'Expected a populated real menu in isolated PostgreSQL');
 const item=menu.items[0];
 const ingredientId=crypto.randomUUID();
 await pool.query('INSERT INTO inventory_items(id,name,unit,quantity,avg_unit_cost) VALUES($1,$2,$3,$4,$5)',[ingredientId,'CI inventory '+ingredientId.slice(0,7),'portion',1000,11000]);
 await pool.query('INSERT INTO inventory_recipes(menu_item_id,inventory_item_id,quantity_per_unit) VALUES($1,$2,1)',[item.id,ingredientId]);
 const startStock=1000;
 async function group(concurrency){
  const jobs=Array.from({length:concurrency},()=>({
   token:tableToken,requestId:crypto.randomUUID(),paymentMethod:'cash',
   items:[{id:item.id,qty:1}],note:'CI isolated load'
  }));
  const begin=Date.now();
  const result=await Promise.all(jobs.map(async (body)=>{
   const started=Date.now();const res=await call('/api/v1/orders',json(body));
   return {duration:Date.now()-started,status:res.status,id:res.body.id,error:res.body.error};
  }));
  const success=result.filter(x=>x.status===201&&x.id);
  const errors=result.filter(x=>x.status!==201);
  console.log('CONCURRENT_ORDERS',JSON.stringify({concurrency,totalMs:Date.now()-begin,ok:success.length,
   errorCount:errors.length,p95Ms:percentile(result.map(x=>x.duration),.95),errors:errors.slice(0,4)}));
  assert.equal(errors.length,0,'All concurrent orders must commit on isolated DB');
  assert.equal(new Set(success.map(x=>x.id)).size,concurrency,'Order IDs must be unique');
  return jobs;
 }
 const group50=await group(50);
 const group100=await group(100);
 const before=(await pool.query('SELECT count(*)::int orders FROM dining_orders')).rows[0].orders;
 const repeated=await call('/api/v1/orders',json(group50[0]));
 assert.equal(repeated.status,200,'Repeated requestId must return idempotent replay');
 assert.equal(repeated.body.duplicate,true);
 const after=(await pool.query('SELECT count(*)::int orders FROM dining_orders')).rows[0].orders;
 assert.equal(before,after,'Replay must not create second order');
 assert.equal(after,150);
 const remain=(await pool.query('SELECT quantity FROM inventory_items WHERE id=$1',[ingredientId])).rows[0];
 assert.equal(Number(remain.quantity),startStock-150,'Stock must be decremented exactly once per order');
 const movement=(await pool.query("SELECT count(*)::int n,min(unit_cost)::bigint mincost FROM inventory_movements WHERE inventory_item_id=$1 AND kind='consume'",[ingredientId])).rows[0];
 assert.equal(movement.n,150);
 assert.equal(Number(movement.mincost),11000,'Consumed historical cost must remain correct');
 const finance=(await pool.query('SELECT count(*)::int n FROM finance_entries')).rows[0].n;
 assert.equal(finance,0,'Unpaid orders must not create income entries');
 console.log('E2E_PASS',JSON.stringify({orders:after,stockRemaining:Number(remain.quantity),movementCount:movement.n,financeEntries:finance}));
}
main().then(()=>pool.end()).catch(async e=>{console.error('E2E_FAILED',e.stack||e);await pool.end();process.exitCode=1});
