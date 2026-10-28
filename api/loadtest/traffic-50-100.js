'use strict';
// Isolated end-to-end load test: real HTTP requests + real local PostgreSQL.
// Deliberately refuses remote API and remote PostgreSQL to prevent fake sales in production.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {Pool}=require('pg');
const root=path.join(__dirname,'results');
const BASE_URL=process.env.SALESHUB_LOADTEST_URL||'http://127.0.0.1:3210';
const DATABASE_URL=process.env.DATABASE_URL||'';
const KEY=process.env.SALESHUB_LOADTEST_ONLY;
const STAFF_PASSWORD='LoadTest-Only-Password-2026!';
const uuid=()=>crypto.randomUUID();
const allowedHost=h=>['localhost','127.0.0.1','[::1]','::1'].includes(h);
if(KEY!=='isolated-postgres'||!DATABASE_URL||!allowedHost(new URL(DATABASE_URL).hostname)||!allowedHost(new URL(BASE_URL).hostname)){
 console.error('REFUSED: load test requires isolated loopback HTTP and PostgreSQL.');
 process.exit(2);
}
const pool=new Pool({connectionString:DATABASE_URL,max:5,connectionTimeoutMillis:10000});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(a,p)=>{const xs=a.slice().sort((x,y)=>x-y);return xs.length?Math.round(xs[Math.max(0,Math.ceil(p*xs.length)-1)]):null};
const sum=(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0);
async function request(url,options={}){
 const started=performance.now();
 try{
  const res=await fetch(BASE_URL+url,{...options,signal:AbortSignal.timeout(90000),cache:'no-store'});
  const body=await res.json().catch(()=>null);
  return {status:res.status,ms:performance.now()-started,body};
 }catch(e){return {status:0,ms:performance.now()-started,error:e.name+': '+e.message}}
}
async function waitForApi(){
 for(let i=0;i<90;i++){
  const res=await request('/api/health');
  if(res.status===200&&res.body?.database==='ready')return;
  await sleep(500);
 }
 throw Error('Local API did not become healthy within 45 seconds');
}
async function seed(){
 const tables=(await pool.query('SELECT id,token FROM dining_tables WHERE active=true ORDER BY id LIMIT 6')).rows;
 const dishes=(await pool.query("SELECT id,station,name FROM menu_items WHERE active=true AND station IN ('kitchen','bar') ORDER BY station,name")).rows;
 const kitchen=dishes.find(x=>x.station==='kitchen'),bar=dishes.find(x=>x.station==='bar');
 if(tables.length<2||!kitchen||!bar)throw Error('Missing seed tables or kitchen/bar items');
 const stocks=[];
 for(const [kind,dish] of [['kitchen',kitchen],['bar',bar]]){
  const itemId=uuid();
  await pool.query('INSERT INTO inventory_items(id,name,unit,quantity) VALUES($1,$2,$3,$4)',[itemId,'loadtest-'+kind+'-'+itemId,'portion',1000]);
  await pool.query('INSERT INTO inventory_recipes(menu_item_id,inventory_item_id,quantity_per_unit) VALUES($1,$2,1)',[dish.id,itemId]);
  stocks.push({kind,id:itemId});
 }
 for(const role of ['kitchen','bar']){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(STAFF_PASSWORD,Buffer.from(salt,'hex'),64).toString('hex');
  await pool.query('INSERT INTO staff_users(id,username,display_name,role,password_salt,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[uuid(),'loadtest_'+role,'Loadtest '+role,role,salt,hash]);
 }
 const cookies={};
 for(const role of ['kitchen','bar']){
  const logged=await fetch(BASE_URL+'/api/users/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'loadtest_'+role,password:STAFF_PASSWORD})});
  if(logged.status!==200)throw Error(role+' login failed: '+logged.status);
  const cookie=logged.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw Error('No staff cookie after login');
  cookies[role]=cookie;
 }
 return {tables,kitchen,bar,stocks,cookies};
}
async function verifyAfterBurst(payloads,priorCount,config){
 const ids=payloads.map(x=>x.requestId);
 const [orders,lines,audit,moves,quantity]=await Promise.all([
  pool.query('SELECT id,request_id FROM dining_orders WHERE request_id=ANY($1::uuid[])',[ids]),
  pool.query('SELECT COUNT(*)::int AS n FROM dining_order_lines WHERE order_id IN (SELECT id FROM dining_orders WHERE request_id=ANY($1::uuid[]))',[ids]),
  pool.query("SELECT COUNT(*)::int AS n FROM dining_audit WHERE action='order_created' AND order_id IN (SELECT id FROM dining_orders WHERE request_id=ANY($1::uuid[]))",[ids]),
  pool.query("SELECT COUNT(*)::int AS n FROM inventory_movements WHERE kind='consume' AND order_line_id IN (SELECT id FROM dining_order_lines WHERE order_id IN (SELECT id FROM dining_orders WHERE request_id=ANY($1::uuid[])))",[ids]),
  pool.query('SELECT id,quantity FROM inventory_items WHERE id=ANY($1::uuid[])',[config.stocks.map(x=>x.id)])
 ]);
 const expected=payloads.length;
 if(orders.rows.length!==expected)throw Error('DB orders mismatch: '+orders.rows.length+'/'+expected);
 if(Number(lines.rows[0].n)!==expected*2)throw Error('Order lines missing: '+lines.rows[0].n);
 if(Number(audit.rows[0].n)!==expected)throw Error('Audit order_created missing: '+audit.rows[0].n);
 if(Number(moves.rows[0].n)!==expected*2)throw Error('Inventory movements missing: '+moves.rows[0].n);
 for(const item of quantity.rows){
  const wanted=1000-priorCount-expected;
  if(Number(item.quantity)!==wanted)throw Error('Inventory mismatch for '+item.id+': '+item.quantity+' != '+wanted);
  if(Number(item.quantity)<0)throw Error('Negative inventory balance');
 }
 const idSet=new Set(orders.rows.map(o=>o.id));
 const kds={};
 for(const role of ['kitchen','bar']){
  const result=await request('/api/kds',{headers:{Cookie:config.cookies[role]}});
  if(result.status!==200)throw Error('KDS '+role+' failed with HTTP '+result.status);
  const found=(result.body?.orders||[]).filter(o=>idSet.has(o.id));
  const itemCount=sum(found,o=>o.items.filter(x=>x.station===role&&x.status==='new').length);
  if(found.length!==expected||itemCount!==expected)throw Error('KDS '+role+' missing orders: '+found.length+'/'+expected+' ('+itemCount+' items)');
  kds[role]=itemCount;
 }
 return {ordersPersisted:orders.rows.length,linesPersisted:Number(lines.rows[0].n),
  auditEvents:Number(audit.rows[0].n),stockMovements:Number(moves.rows[0].n),kds,
  stockRemaining:quantity.rows.map(x=>Number(x.quantity))};
}
async function burst(N,phase,config,priorCount){
 const payloads=Array.from({length:N},(_,i)=>({
  token:config.tables[i%config.tables.length].token,
  requestId:uuid(),paymentMethod:'cash',note:'isolated load test '+phase,
  items:[{id:config.kitchen.id,qty:1},{id:config.bar.id,qty:1}]
 }));
 const started=performance.now();
 const responses=await Promise.all(payloads.map((payload,i)=>request('/api/orders',{
  method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.18.'+phase+'.'+(i+1)},
  body:JSON.stringify(payload)
 })));
 const elapsed=performance.now()-started;
 const successful=responses.filter(r=>r.status===201&&r.body?.id&&!r.body?.duplicate);
 const counts=responses.reduce((m,r)=>{m[String(r.status)]=(m[String(r.status)]||0)+1;return m},{});
 const durations=responses.map(r=>r.ms);
 const report={virtualClients:N,sent:N,successful:successful.length,failed:N-successful.length,
  statusCounts:counts,elapsedMs:Math.round(elapsed),rps:Number((N/(elapsed/1000)).toFixed(2)),
  latencyMs:{min:Math.round(Math.min(...durations)),p50:percentile(durations,.5),
   p95:percentile(durations,.95),p99:percentile(durations,.99),
   max:Math.round(Math.max(...durations))}};
 console.log('LOADTEST_BURST '+JSON.stringify(report));
 if(successful.length!==N){
  const bad=responses.filter(r=>r.status!==201).slice(0,8).map(r=>({status:r.status,error:r.error||r.body?.error,ms:Math.round(r.ms)}));
  throw Object.assign(Error('Load test '+N+' clients failed: '+JSON.stringify(bad)),{report});
 }
 report.integrity=await verifyAfterBurst(payloads,priorCount,config);
 console.log('LOADTEST_INTEGRITY '+JSON.stringify({virtualClients:N,...report.integrity}));
 return {report,payloads,responses};
}
async function main(){
 const output={kind:'isolated-real-http-postgresql',environment:'GitHub Actions localhost with PostgreSQL 16 service',runAt:new Date().toISOString(),
  poolMax:5,notes:['Simulated independent HTTP clients, not physical phones','No production Render or Neon endpoints accessed',
   'Each order has one kitchen item and one bar item, stock validated transactionally'],bursts:[],passed:false};
 fs.mkdirSync(root,{recursive:true});
 try{
  await waitForApi();
  const config=await seed();
  let prior=0,first=null;
  for(const [phase,N] of [[1,50],[2,100]]){
   const result=await burst(N,phase,config,prior);
   output.bursts.push(result.report);
   if(!first)first=result.payloads[0];
   prior+=N;
  }
  // Idempotent retries must not double-charge, re-create or re-consume inventory.
  const retry=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.18.1.1'},body:JSON.stringify(first)});
  const c=await pool.query('SELECT COUNT(*)::int AS n FROM dining_orders WHERE request_id=$1',[first.requestId]);
  if(retry.status!==200||retry.body?.duplicate!==true||Number(c.rows[0].n)!==1)throw Error('Duplicate request did not return same saved order');
  output.idempotency={status:retry.status,duplicate:retry.body.duplicate,ordersWithSameRequestId:Number(c.rows[0].n)};
  output.passed=true;
  console.log('LOADTEST_SUMMARY '+JSON.stringify(output));
 }catch(error){
  output.error=error.stack||String(error);
  console.error('LOADTEST_FAILURE '+output.error);
  process.exitCode=1;
 }finally{
  fs.writeFileSync(path.join(root,'stress-report.json'),JSON.stringify(output,null,2));
  await pool.end();
 }
}
main().catch(err=>{console.error(err);process.exitCode=1});
