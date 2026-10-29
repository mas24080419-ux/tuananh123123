'use strict';
// Real PostgreSQL and HTTP end-to-end checks in a disposable GitHub Actions job.
// Deliberately never accept production DATABASE_URL or a remote target.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const url=process.env.DATABASE_URL||'';
if(!/^(postgres(?:ql)?:\/\/)([^@]+@)?(127\.0\.0\.1|localhost):5432\/saleshub_staging$/.test(url)){
 throw Error('Refusing to run load/E2E outside local isolated saleshub_staging PostgreSQL.');
}
const base='http://127.0.0.1:32109',pool=new Pool({connectionString:url,max:4});
async function request(path,{method='GET',body,cookie,origin}={}){
 const headers={'Accept':'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(cookie)headers.Cookie=cookie;
 if(origin)headers.Origin=origin;
 const started=performance.now();
 const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
 const data=await res.json();
 return {status:res.status,data,elapsed:Math.round(performance.now()-started),cookie:res.headers.get('set-cookie')};
}
async function main(){
 try{
  const health=await request('/api/v1/health');
  assert.equal(health.status,200);
  assert.equal(health.data.database,'ready');
  assert.equal(health.data.pilot,false);
  const noAuth=await request('/api/v1/finance/reports/profitability');
  assert.equal(noAuth.status,403,'Financial API must reject guests');
  const blockedOrigin=await request('/api/v1/orders',{method:'POST',origin:'https://attacker.example',body:{}});
  assert.equal(blockedOrigin.status,403,'Cross-origin POST must be rejected');
  assert.equal((await request('/api/v1/garbage')).status,404);
  const tables=(await pool.query('SELECT token FROM dining_tables WHERE active=true ORDER BY name LIMIT 1')).rows;
  assert.equal(tables.length,1);
  const token=tables[0].token;
  assert.equal((await request('/api/v1/tables/'+token+'/menu')).status,200);
  assert.equal((await request('/api/v1/tables/'+('a'.repeat(48))+'/menu')).status,404);
  const menuRow=(await pool.query('SELECT id,name,price FROM menu_items WHERE active=true ORDER BY name LIMIT 1')).rows[0];
  assert(menuRow);
  const inventoryId=crypto.randomUUID();
  await pool.query('INSERT INTO inventory_items(id,name,unit,quantity,avg_unit_cost) VALUES($1,$2,$3,1000,12000)',[inventoryId,'CI staging only ingredient','portion']);
  await pool.query('INSERT INTO inventory_recipes(menu_item_id,inventory_item_id,quantity_per_unit) VALUES($1,$2,1)',[menuRow.id,inventoryId]);
  const menu=await request('/api/v1/tables/'+token+'/menu');
  assert(menu.data.items.some(it=>it.id===menuRow.id&&Number(it.available_quantity)>=1000));
  const requestIds=Array.from({length:100},()=>crypto.randomUUID());
  const body=id=>({token,requestId:id,items:[{id:menuRow.id,qty:1}],paymentMethod:'cash'});
  const started=performance.now();
  const latencies=[];
  let successes=0;
  // All 100 orders start together against isolated PostgreSQL, never production.
  const results=await Promise.allSettled(requestIds.map(id=>request('/api/v1/orders',{method:'POST',body:body(id)})));
  for(const result of results){
   if(result.status!=='fulfilled')throw Error('Concurrent order request failed: '+String(result.reason));
   const value=result.value;
   if(value.status!==201||!value.data.id||value.data.duplicate)throw Error('Order rejected under load: '+value.status+' '+JSON.stringify(value.data));
   latencies.push(value.elapsed);successes++;
  }
  const elapsed=Math.round(performance.now()-started);
  assert.equal(successes,100);
  const qty=Number((await pool.query('SELECT quantity FROM inventory_items WHERE id=$1',[inventoryId])).rows[0].quantity);
  assert.equal(qty,900,'Exactly one portion must be deducted per accepted order');
  const orderCheck=(await pool.query('SELECT count(*)::int AS n FROM dining_orders WHERE request_id=ANY($1::uuid[])',[requestIds])).rows[0];
  assert.equal(orderCheck.n,100);
  const cost=(await pool.query("SELECT count(*)::int n,coalesce(sum(-delta),0)::int units,coalesce(min(unit_cost),0)::int min_cost FROM inventory_movements WHERE inventory_item_id=$1 AND kind='consume'",[inventoryId])).rows[0];
  assert.equal(cost.n,100);
  assert.equal(cost.units,100);
  assert.equal(cost.min_cost,12000);
  const replay=await request('/api/v1/orders',{method:'POST',body:body(requestIds[0])});
  assert.equal(replay.status,200);
  assert.equal(replay.data.duplicate,true);
  const afterReplay=Number((await pool.query('SELECT quantity FROM inventory_items WHERE id=$1',[inventoryId])).rows[0].quantity);
  assert.equal(afterReplay,900,'Idempotent replay must never deduct stock twice');
  const owner=await request('/api/v1/session/login',{method:'POST',body:{email:'mas24080419@hsb.edu.vn',password:'staging-owner-password-only'}});
  assert.equal(owner.status,200,'Owner should authenticate against isolated staging DB');
  const cookie=owner.cookie?.split(';')[0];
  assert(cookie?.startsWith('sh_session='));
  assert.equal((await request('/api/v1/session',{cookie})).data.role,'admin');
  const finance=await request('/api/v1/finance/reports/profitability',{cookie});
  assert.equal(finance.status,200,'Financial report requires authenticated owner');
  const entry=await request('/api/v1/management/summary',{cookie});
  assert.equal(entry.status,200);
  assert.equal(Number(entry.data.summary.order_count),100);
  const firstOrder=(await pool.query('SELECT id FROM dining_orders WHERE request_id=$1',[requestIds[0]])).rows[0].id;
  const confirmation={method:'POST',cookie,body:{confirm:true,paymentMethod:'cash'}};
  const pay=await request('/api/v1/orders/'+firstOrder+'/payment-confirmations',confirmation);
  assert.equal(pay.status,200);
  const repeatedPay=await request('/api/v1/orders/'+firstOrder+'/payment-confirmations',confirmation);
  assert.equal(repeatedPay.status,200);
  assert.equal(repeatedPay.data.payment.already,true);
  const paid=(await pool.query("SELECT COUNT(*)::int n,COALESCE(SUM(paid_amount),0)::bigint amount FROM dining_orders WHERE payment_status='paid'")).rows[0];
  assert.equal(paid.n,1);
  assert.equal(Number(paid.amount),Number(menuRow.price));
  const view=await request('/api/v1/orders/'+firstOrder+'?token='+token);
  assert.equal(view.status,200);
  assert.equal(view.data.payment_status,'paid');
  const latency=latencies.sort((a,b)=>a-b);
  const summary={environment:'isolated PostgreSQL 16; NEVER Neon production',concurrency:100,totalOrders:100,accepted:successes,durationMs:elapsed,p50Ms:latency[Math.floor(.50*(latency.length-1))],p95Ms:latency[Math.floor(.95*(latency.length-1))],stockRemaining:qty,costSnapshot:cost.min_cost,paidOrders:paid.n};
  console.log('STAGING_E2E_RESULT '+JSON.stringify(summary));
 }finally{await pool.end()}
}
main().catch(e=>{console.error('STAGING_E2E_FAILED '+e.stack);process.exitCode=1});
