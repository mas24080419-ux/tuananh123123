'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
test('mobile owner orders use card layout and inline payment confirmation, never a browser confirm dialog',()=>{
 const html=read('orders.html'),css=read('orders-mobile.css'),js=read('orders.js');
 assert(html.includes('<body class="tt6-orders-page">'));
 assert(html.includes('orders-mobile.css?v=20261028-owner-payment-v1'));
 assert(html.includes('orders.js?v=20261028-owner-payment-v1'));
 assert(css.includes('min-width:0!important')&&css.includes('data-label')&&css.includes('.mark-paid'));
 assert(css.includes('.payment-confirm-panel[hidden]'));
 assert(js.includes('payment-confirm-panel')&&js.includes('payment-approve'));
 assert(js.includes("scrollIntoView?.({block:'nearest'"));
 assert(!js.includes('window.confirm('));
 assert(!js.includes("confirm('XÁC NHẬN"));
 assert.doesNotThrow(()=>new vm.Script(js));
});
test('first tap opens inline confirmation without POST; second deliberate tap confirms exactly once',async()=>{
 const handlers=new Map(),calls=[],alerts=[];
 const order={id:'33333333-3333-4333-8333-333333333333',table_name:'Bàn 08',created_at:'2026-10-28T08:00:00.000Z',payment_method:'cash',payment_status:'unpaid',total_vnd:42000};
 const panels={},rows={};
 const makeEl=()=>({value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},attributes:{},
   addEventListener(type,callback){this.handlers??=new Map();this.handlers.set(type,callback)},
   querySelector(){return null},querySelectorAll(){return []},focus(){},
   setAttribute(k,v){this.attributes[k]=v},classList:{toggle(){}},style:{}});
 const feedback=makeEl(),detail=makeEl(),approve=makeEl(),panel=makeEl(),opener=makeEl(),select=makeEl();
 select.value='cash'; opener.dataset={id:order.id,method:'cash'};opener.closest=()=>row;
 approve.dataset={id:order.id};approve.closest=()=>row;
 panel.hidden=true; panel.querySelector=s=>({
  '.payment-confirm-detail':detail,'.payment-row-feedback':feedback,'.payment-approve':approve
 }[s]||null);
 const row={querySelector:s=>({
  '.mark-paid':opener,'.pick-method':select,'.payment-confirm-panel':panel,'.payment-row-feedback':feedback
 }[s]||null)};
 const dom=new Map();
 const el=id=>{if(!dom.has(id))dom.set(id,makeEl());return dom.get(id)};
 const orders=el('#orders');
 orders.querySelectorAll=s=>s==='.payment-confirm-panel'?[panel]:s==='.mark-paid'?[opener]:[];
 const request=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('confirm-payment'))return {payment:{amount:42000,already:false}};
  if(url.startsWith('/api/admin/summary'))return {summary:{},orders:[{...order,payment_status:'paid',paid_amount:42000}] ,daily:[],top_items:[],mode:'postgres'};
  throw Error('Unexpected request '+url);
 };
 const globals={
  $:el,request,notice:(m,k)=>alerts.push({m,k}),cash:n=>Number(n).toLocaleString('vi-VN')+' ₫',
  shortDate:s=>s.slice(0,10),esc:s=>String(s),text:(id,val)=>{el(id).textContent=String(val)},
  setupOwnerShared(){},window:{confirm(){throw Error('Browser confirm should never be invoked')}},
  Date,Intl,URLSearchParams,document:{createElement(){return makeEl()},body:{appendChild(){}}},console
 };
 const ctx=vm.createContext(globals);
 vm.runInContext(read('orders.js'),ctx);
 vm.runInContext('latest='+JSON.stringify({orders:[order]})+';',ctx);
 const handler=orders.handlers.get('click');assert.equal(typeof handler,'function');
 const eventFor=(css)=>({target:{closest:s=>s===css?css==='button.mark-paid'?opener:approve:null}});
 handler(eventFor('button.mark-paid'));
 assert.equal(panel.hidden,false,'first tap shows in-page confirmation');
 assert.equal(calls.length,0,'first tap must never create income');
 assert.match(detail.textContent,/42/);
 handler(eventFor('button.payment-approve'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(x=>x.url.includes('confirm-payment')).length,1);
 const [paymentCall]=calls.filter(x=>x.url.includes('confirm-payment'));
 assert.match(paymentCall.url,/\/api\/admin\/orders\/[0-9a-f-]+\/confirm-payment/);
 assert.deepEqual(JSON.parse(paymentCall.opts.body),{confirm:true,paymentMethod:'cash'});
 assert(alerts.some(x=>x.k==='ok'&&x.m.includes('Đã nhận')),'successful UI confirmation is reported');
});
