'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {getModel}=require('../backend-blueprint');
test('blueprint renders all tabs, real ERD columns, selecting table and drilldown without changing global All',async()=>{
 const text=fs.readFileSync(path.join(__dirname,'../public/architecture-blueprint.js'),'utf8');
 const elements=new Map(),listeners=new Map(),globals=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,style:{},dataset:{},value:'',textContent:'',innerHTML:'',hidden:false,clientWidth:1250,
   handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn)},
   querySelectorAll(){return []},querySelector(){return null},
   setAttribute(k,v){this[k]=String(v)},removeAttribute(k){delete this[k]},classList:{toggle(){},add(){},remove(){}}});
  return elements.get(id);
 };
 const document={readyState:'loading',body:{dataset:{deepFlow:'all'}},getElementById:element,
  addEventListener(name,cb){listeners.set(name,cb)},querySelector(){return null}};
 const fetch=async url=>({ok:url==='/api/v1/monitoring/blueprint',json:async()=>getModel()});
 vm.runInNewContext(text,{document,fetch,console,Intl,window:{}});
 const run=listeners.get('DOMContentLoaded');assert.equal(typeof run,'function');run();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(element('bpLoading').hidden,true);
 assert.equal(element('bpDiagram').hidden,false);
 assert.match(element('bpNodes').innerHTML,/Order Engine/);
 assert.match(element('bpStatus').textContent,/khối/);
 assert.equal(document.body.dataset.deepFlow,'all');
 const tabClick=elements.get('bpTabs').handlers.get('click');
 tabClick({target:{closest:s=>({dataset:{bpTab:'schema'}})}});
 assert.match(element('bpNodes').innerHTML,/dining_orders/);
 assert.match(element('bpNodes').innerHTML,/inventory_recipes/);
 assert.match(element('bpStatus').textContent,/bảng/);
 element('bpNodes').handlers.get('click')({target:{closest:s=>({dataset:{bpNode:'dining_orders'}})}});
 assert.match(element('bpInspector').innerHTML,/request_id/);
 assert.match(element('bpInspector').innerHTML,/payment_status/);
 assert.match(element('bpInspector').innerHTML,/table_id/);
 assert.equal(document.body.dataset.deepFlow,'all');
 tabClick({target:{closest:s=>({dataset:{bpTab:'order'}})}});
 assert.match(element('bpNodes').innerHTML,/Nhánh lỗi/);
 assert.match(element('bpWires').innerHTML,/bp-rollback-wire/);
 assert.match(element('bpStatus').textContent,/4 nhánh/);
 tabClick({target:{closest:s=>({dataset:{bpTab:'topology'}})}});
 assert.match(element('bpNodes').innerHTML,/SSE live feed/i);
 assert.equal(document.body.dataset.deepFlow,'all');
});
