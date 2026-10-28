'use strict';
// HTTP load against ONE explicitly named throwaway staging app.
// Refuses to run against production or a database without the staging marker.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const BASE=process.env.SALESHUB_STAGING_URL||'https://saleshub-loadtest-staging.onrender.com';
const allowed='https://saleshub-loadtest-staging.onrender.com';
const reportPath=path.join(__dirname,'results','remote-staging.json');
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const percentile=(values,p)=>{const x=values.slice().sort((a,b)=>a-b);return x.length?Math.round(x[Math.max(0,Math.ceil(p*x.length)-1)]):null};
if(BASE!==allowed){
 console.error('REFUSED: only the disposable staging service '+allowed+' can be load tested.');
 process.exit(2);
}
async function request(resource,options={}){
 const start=performance.now();
 try{
  const response=await fetch(BASE+resource,{...options,signal:AbortSignal.timeout(60000),cache:'no-store'});
  const body=await response.json().catch(()=>null);
  return {status:response.status,ms:Math.round(performance.now()-start),body};
 }catch(e){return {status:0,ms:Math.round(performance.now()-start),error:e.name+': '+e.message}}
}
function tokens(){return Array.from({length:6},(_,i)=>String(i+1).padStart(48,'0'))}
async function checkSafety(){
 const checked=await request('/api/loadtest/identity');
 if(checked.status!==200||checked.body?.isolated!==true||checked.body?.database!=='saleshub_loadtest')
  throw Error('STAGING GUARD FAILED: database marker not verified. No orders sent. HTTP '+checked.status);
 const health=await request('/api/health');
 if(health.status!==200||health.body?.mode!=='postgres'||health.body?.database!=='ready')
  throw Error('Staging app is not connected to healthy PostgreSQL. No orders sent.');
 const menus=await Promise.all(tokens().map(token=>request('/api/menu/'+token)));
 if(menus.some(x=>x.status!==200))throw Error('Missing staging QR tables: '+menus.map(x=>x.status));
 const options=menus[0].body.items||[];
 const kitchen=options.find(x=>x.name==='LOADTEST Món Bếp'&&x.station==='kitchen');
 const bar=options.find(x=>x.name==='LOADTEST Món Bar'&&x.station==='bar');
 if(!kitchen||!bar)throw Error('Missing staging-only dish seeds');
 if(Number(kitchen.available_quantity)<150||Number(bar.available_quantity)<150)
  throw Error('Not enough stock for planned 150 orders. Stop without sending.');
 return {kitchen,bar,tokenSet:tokens()};
}
async function burst(count,phase,setup){
 const requests=Array.from({length:count},(_,i)=>({token:setup.tokenSet[i%6],requestId:uuid(),
  items:[{id:setup.kitchen.id,qty:1},{id:setup.bar.id,qty:1}],paymentMethod:'cash',
  note:'Staging-only concurrency '+phase}));
 const start=performance.now();
 const results=await Promise.all(requests.map((p,i)=>request('/api/orders',{method:'POST',
  headers:{'Content-Type':'application/json','X-Forwarded-For':'198.18.'+phase+'.'+(i+1)},
  body:JSON.stringify(p)})));
 const elapsed=performance.now()-start;
 const byStatus={};for(const r of results)byStatus[String(r.status)]=(byStatus[String(r.status)]||0)+1;
 const successes=results.filter(r=>r.status===201&&r.body?.id&&!r.body?.duplicate);
 let confirmed=0,unconfirmed=0;
 // Read order-status from the actual public QR API; database audit checks are separate.
 await Promise.all(successes.map(async r=>{
  const idx=results.indexOf(r),p=requests[idx];
  const details=await request('/api/order-status/'+r.body.id+'?token='+p.token);
  if(details.status===200&&details.body?.items?.length===2)confirmed++;else unconfirmed++;
 }));
 const lat=results.map(r=>r.ms);
 const summary={clients:count,successes:successes.length,failed:count-successes.length,
  httpStatuses:byStatus,elapsedMs:Math.round(elapsed),throughputRps:Number((count*1000/elapsed).toFixed(2)),
  latencyMs:{p50:percentile(lat,.5),p95:percentile(lat,.95),p99:percentile(lat,.99),max:Math.max(...lat)},
  statusReadback:{confirmed,unconfirmed},
  examples:results.filter(r=>r.status!==201).slice(0,4).map(r=>({status:r.status,error:r.body?.error||r.error}))};
 console.log('REMOTE_STAGING_BURST '+JSON.stringify(summary));
 return summary;
}
async function main(){
 const report={time:now(),target:BASE,kind:'REMOTE-STAGING-HTTP',pool:'Render staging + isolated Neon',
  notes:['Not real mobile devices: simultaneous HTTP clients from GitHub Actions runner',
   'X-Forwarded-For test addresses represent separate virtual clients; may be overridden by Render proxy',
   'No live production services or data used. Live DB audit/inventory validation should be run from Neon separately.'],bursts:[]};
 fs.mkdirSync(path.dirname(reportPath),{recursive:true});
 try{
  const setup=await checkSafety();
  console.log('REMOTE_STAGING_GUARD PASSED');
  for(const [phase,count] of [[1,50],[2,100]])report.bursts.push(await burst(count,phase,setup));
  report.passed=report.bursts.every(b=>b.successes===b.clients&&b.statusReadback.confirmed===b.clients);
  if(!report.passed)process.exitCode=1;
  console.log('REMOTE_STAGING_SUMMARY '+JSON.stringify(report));
 }catch(err){report.error=err.message;process.exitCode=1;console.error('REMOTE_STAGING_FAILURE '+err.message)}
 finally{fs.writeFileSync(reportPath,JSON.stringify(report,null,2))}
}
main();
