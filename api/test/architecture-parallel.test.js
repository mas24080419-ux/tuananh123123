'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
test('default map stays on All and incoming SSE does not select an individual module',()=>{
 const deep=src('architecture-deep.js'),orders=src('architecture-live.js'),player=src('architecture-path.js'),html=src('architecture.html');
 assert.match(deep,/let selected=null,filter='all'/);
 assert.match(deep,/renderGraph\(\);updateFollow\(\);renderMetrics\(\)/);
 assert.match(deep,/\/\/ Never change the owner's selected filter/);
 assert(!deep.includes('focusedTrace=t.id;filter=t.module'));
 assert(!deep.includes('filter=event.module'));
 assert(orders.includes('selected=null,pinned=true'));
 assert(player.includes("document.body.dataset.deepFlow!=='all'"));
 assert(html.includes('/architecture-parallel.js?v=20261028-all-parallel-v1'));
 assert(html.includes('cùng xuất hiện')||html.includes('đồng thời'));
 for(const file of ['architecture-deep.js','architecture-live.js','architecture-path.js','architecture-parallel.js'])
  assert.doesNotThrow(()=>new vm.Script(src(file),{filename:file}));
});
test('two independent real request traces can render simultaneously on both maps without changing All',()=>{
 const listeners=new Map(),schedule=new Map();
 let timerId=0;
 const setTimeoutFake=fn=>{const id=++timerId;schedule.set(id,fn);return id};
 const clearTimeoutFake=id=>{schedule.delete(id)};
 const emit=(type,detail)=>{for(const fn of listeners.get(type)||[])fn({detail})};
 const list=(names,offset=0)=>names.map((name,i)=>{
  const classes=new Set(),attrs={};
  return {dataset:{id:name,archNode:name,src:name.split('-')[0],dst:name.split('-')[1],archEdge:name},
   offsetLeft:offset+i*200,offsetTop:60,offsetWidth:150,offsetHeight:78,
   attributes:attrs,setAttribute(k,v){attrs[k]=String(v)},removeAttribute(k){delete attrs[k]},
   classList:{toggle(c,yes){if(yes)classes.add(c);else classes.delete(c)},remove(c){classes.delete(c)},contains(c){return classes.has(c)}}};
 });
 const deepNames=['guest','staff','stafforder','http','auth','validate','orders','inventory','tx','pg'];
 const deepList=list(deepNames),overviewList=list(['guest','stafforder','http','auth','orders','inventory','postgres']);
 const deepEdges=list(['guest-http','stafforder-http','http-validate','http-auth','auth-orders']);
 const overviewEdges=list(['guest-http','stafforder-http','http-auth','auth-orders','orders-inventory']);
 const fakeSelector=(arr,type)=>s=>{
  if(s==='[data-id]'||s==='[data-arch-node]'||s==='[data-arch-edge]')return arr;
  if(s==='[data-concurrent]')return arr.filter(x=>x.attributes['data-concurrent']!==undefined);
  if(s.startsWith('.deep-edge'))return arr.filter(x=>s.includes('concurrent-active')?x.classList.contains('concurrent-active'):true);
  return [];
 };
 const nodes={querySelector:s=>deepList.find(x=>s==='[data-id="'+x.dataset.id+'"]')||null,querySelectorAll:fakeSelector(deepList)};
 const archNodes={querySelectorAll:fakeSelector(overviewList)};
 const archWires={querySelectorAll:fakeSelector(overviewEdges)};
 const svg={children:[],appendChild(x){this.children.push(x)},querySelectorAll:fakeSelector(deepEdges)};
 const texts=Object.fromEntries(['deepStage','deepFollow','pathRuntimeTitle','pathRuntimeDescription','pathRuntimeProgress','pathRuntimeQueue','pathRuntimeDot','deepLivePath'].map(x=>[x,{textContent:'',className:'',getAttribute:()=> 'true'}]));
 texts.deepWires=svg;texts.deepNodes=nodes;texts.archNodes=archNodes;texts.archEdges=archWires;
 const doc={readyState:'loading',body:{dataset:{deepFlow:'all',archFlow:'all'}},
  getElementById:id=>texts[id]||null,
  addEventListener:(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]),
  createElementNS:(ns,tag)=>({tag,attrs:{},children:[],setAttribute(k,v){this.attrs[k]=String(v)},appendChild(e){this.children.push(e)},
   replaceChildren(){this.children=[]}})};
 const context={document:doc,window:{addEventListener(){}},setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,Date,console};
 vm.runInNewContext(src('architecture-parallel.js'),context);
 emit('DOMContentLoaded');
 const a={id:'trace-qr',module:'orders',state:'running',steps:[{node:'http',label:'QR received'},{node:'validate',label:'QR validated'}]};
 const b={id:'trace-staff',module:'stafforder',state:'running',steps:[{node:'http',label:'Staff received'},{node:'auth',label:'Staff authorized'}]};
 emit('saleshub:trace',{trace:a});emit('saleshub:trace',{trace:b});
 const layer=svg.children[0];
 const observed=()=>new Set(layer.children.map(x=>x.attrs['data-observed-trace']));
 assert.deepEqual([...observed()].sort(),['trace-qr','trace-staff']);
 assert.equal(doc.body.dataset.deepFlow,'all');
 assert(deepList.find(x=>x.dataset.id==='guest').classList.contains('concurrent-active'));
 assert(deepList.find(x=>x.dataset.id==='stafforder').classList.contains('concurrent-active'));
 assert(overviewList.find(x=>x.dataset.id==='guest').classList.contains('arch-concurrent-active'));
 assert(overviewList.find(x=>x.dataset.id==='stafforder').classList.contains('arch-concurrent-active'));
 // Two different requests advance independently on the same scheduler tick.
 const due=[...schedule.entries()];schedule.clear();for(const [,fn] of due)fn();
 assert.deepEqual([...observed()].sort(),['trace-qr','trace-staff']);
 assert(texts.pathRuntimeTitle.textContent.includes('2 luồng'));
 const old={id:'old',module:'orders',state:'success',finishedAt:new Date(Date.now()-60000).toISOString(),steps:[{node:'http'}]};
 emit('saleshub:snapshot',{active:[],traces:[old],checkedAt:new Date().toISOString()});
 assert(!observed().has('old'),'60s-old completed request must not masquerade as live');
 doc.body.dataset.deepFlow='orders';emit('saleshub:architecture-filter',{filter:'orders'});
 assert.equal(layer.children.length,0);
 assert(!overviewList.some(x=>x.classList.contains('arch-concurrent-active')));
});
