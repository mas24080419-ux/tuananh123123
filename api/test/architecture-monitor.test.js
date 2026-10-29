'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const arch=require('../architecture-monitor');
const pub=path.join(__dirname,'../public');
const page=fs.readFileSync(path.join(pub,'architecture.html'),'utf8');
const front=fs.readFileSync(path.join(pub,'architecture.js'),'utf8');
const css=fs.readFileSync(path.join(pub,'architecture.css'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');

test('architecture topology has real modules and valid directed edges',()=>{
 const {nodes,edges,flows}=arch.model;
 assert(nodes.length>=13);
 assert(edges.length>=18);
 const ids=nodes.map(n=>n.id);
 assert.equal(ids.length,new Set(ids).size,'node IDs must be unique');
 assert.equal(edges.length,new Set(edges.map(e=>e.id)).size,'edge IDs must be unique');
 const flowIds=new Set(flows.map(f=>f.id));
 assert(flowIds.has('all'));
 for(const n of nodes){
  assert(n.name&&n.detail&&n.tag);
  assert(Number.isFinite(n.x)&&Number.isFinite(n.y)&&Number.isFinite(n.w));
  assert(n.x>=0&&n.y>=0&&n.x+n.w<=1440,'out of canvas: '+n.id);
 }
 for(const e of edges){
  assert(ids.includes(e.from),'invalid edge source: '+e.from);
  assert(ids.includes(e.to),'invalid edge destination: '+e.to);
  assert(flowIds.has(e.group)||e.group==='ingress','invalid flow group');
 }
 assert.equal(nodes.filter(x=>x.id==='postgres').length,1);
 assert.equal(nodes.filter(x=>x.id==='http').length,1);
 assert(!JSON.stringify(arch.model).includes('Cloudflare'));
 assert(!JSON.stringify(arch.model).includes('Redis'));
 assert(!JSON.stringify(arch.model).includes('DeepSeek'));
});

test('monitor queries only aggregate numeric results and uses a query timeout',async()=>{
 const stats={orders24h:13,pendingKitchen:4,lowStock:2,occupiedLockers:6,financeEntries24h:5,adminActions24h:3,orderEvents24h:21,unpaidOrders:1,latestOrderAt:null};
 let config;
 const pool={async query(arg){config=arg;return {rows:[stats]}}};
 const result=await arch.snapshot(pool,()=>'2026-10-28T05:00:00.000Z');
 assert.equal(result.database,'ready');
 assert.deepEqual(result.stats,stats);
 assert.equal(result.checkedAt,'2026-10-28T05:00:00.000Z');
 assert(Number.isInteger(result.dbLatencyMs));
 assert.equal(result.measurement,'database-query');
 assert.equal(config.query_timeout,4000);
 assert(/^SELECT\s/i.test(config.text));
 assert(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b/i.test(config.text));
 assert(config.text.includes('dining_orders'));
 assert(config.text.includes('locker_rentals'));
 assert(config.text.includes('pos_audit'));
 assert(!JSON.stringify(result).includes('customer_name'));
});
test('monitor failure and pilot never invent PostgreSQL counts',async()=>{
 const original=console.error;console.error=()=>{};
 try{
  const down=await arch.snapshot({async query(){throw Error('Database refused')}});
  assert.equal(down.database,'unavailable');assert.equal(down.stats,null);
  assert(!JSON.stringify(down).includes('Database refused'),'do not leak internal DB errors');
 }finally{console.error=original}
 const pilot=await arch.snapshot(null);
 assert.equal(pilot.database,'pilot');assert.equal(pilot.stats,null);
});
test('architecture UI loads existing sidebar with a read-only node explorer',()=>{
 for(const id of ['archContent','archAccess','archRefresh','archViewport','archNodes','archEdges','archFlowFilters','archInspector','archFit']){
  assert(page.includes('id="'+id+'"'),'Missing '+id);
 }
 assert(page.includes('/pos-sidebar.js'));
 assert(page.includes('/architecture.css'));
 assert(page.includes('/architecture.js'));
 assert(page.includes('viewport-fit=cover'));
 assert(!/<style[\s>]/i.test(page));
 assert(!/<script(?:\s[^>]*)?>\s*[^<\s]/i.test(page));
 assert(!/fontawesome|vis-network|mermaid/i.test(page),'no new dependency required');
 assert(front.includes("fetch('/api/v1/monitoring/architecture'"));
 assert(front.includes('credentials:\'same-origin\''));
 assert(front.includes('cache:\'no-store\''));
 assert(front.includes('esc(value)')||front.includes('const esc=value=>'));
 assert(css.includes('@media(max-width:760px)'));
});
test('architecture page and status API require owner role in backend',()=>{
 assert(server.includes("p==='/api/admin/architecture'"));
 assert(server.includes("return send(res,200,{model:architectureMonitor.model,monitor:await architectureMonitor.snapshot(pool)});"));
 assert(server.includes("p==='/admin/architecture'&&(await identity(req))?.role!=='admin'"));
 assert(server.includes("requireAdmin(req,res)"));
 assert(!/route\(.*DELETE.*architecture/i.test(server));
});
