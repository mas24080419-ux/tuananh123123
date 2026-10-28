'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'../public',p),'utf8');
const {getModel}=require('../backend-blueprint');
test('detailed interactive map includes schema-backed table explorer and protected API',()=>{
 const html=read('architecture.html'),js=read('architecture-blueprint.js'),css=read('architecture-blueprint.css'),m=getModel();
 assert(html.includes('id="backendBlueprint"'));
 for(const id of ['bpTabs','bpFilters','bpSearch','bpNodes','bpWires','bpInspector','bpZoomIn','bpZoomOut','bpFit','bpReset'])assert(html.includes('id="'+id+'"'),id);
 assert(html.includes('architecture-blueprint.js?v=20261028-blueprint-v1'));
 assert(html.includes('architecture-blueprint.css?v=20261028-blueprint-v1'));
 assert(js.includes("fetch('/api/admin/architecture/blueprint'"));
 assert(js.includes("document.addEventListener('saleshub:snapshot'"));
 assert(js.includes("state.tab='topology',filter:'all'")||js.includes("tab:'topology',filter:'all'"));
 assert(css.includes('@media(max-width:780px)'));
 assert(m.schema.tableCount>=21);
 assert.doesNotThrow(()=>new vm.Script(js));
});
test('all six architecture layers are grounded in source and ERD has real FK edges',()=>{
 const m=getModel(),blocks=m.architecture.blocks;
 assert.deepEqual([...new Set(blocks.map(x=>x.col))].sort(),[0,1,2,3,4,5]);
 for(const key of ['orderengine','dedupe','recipe','stocklock','stockwrite','auditwrite','commit','pool','businessaudit','sse'])assert(blocks.some(n=>n.id===key));
 assert(m.schema.relations.some(r=>r.from==='dining_order_lines'&&r.to==='dining_orders'));
 assert(m.schema.relations.some(r=>r.from==='area_receipts'&&r.to==='finance_entries'));
 assert(m.schema.tables.some(x=>x.name==='table_reservations'&&x.legacy));
});
test('rollback is a separate failure path, not the final step after successful payment',()=>{
 const js=read('architecture-blueprint.js');
 assert(js.includes("nodes.slice(1,-1).map"));
 assert(js.includes("['step-5','step-8','step-12','step-15']"));
 assert(js.includes("kind:'rollback'"));
 assert(js.includes('bp-rollback-wire'));
 assert(!js.includes('nodes.slice(1).map((x,i)=>({from:nodes[i].id,to:x.id}))'));
});
test('read-only schema inspector never fetches rows or credentials',()=>{
 const js=read('architecture-blueprint.js');
 assert(!/DATABASE_URL\s*=|password_hash.*fetch|SELECT\s+\*\s+FROM/i.test(js));
 assert(js.includes('n.columns.map'));
 assert(js.includes('esc(n.label)'));
});
