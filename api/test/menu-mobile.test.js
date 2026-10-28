'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../public/core.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/menu-mobile.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/menu-mobile.js'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'../public/core.js'),'utf8');

test('mobile restaurant menu is accessible, responsive and reuses original backend forms',()=>{
 for(const id of ['mobileMenuApp','mobileMenuAdd','mobileMenuFilters','mobileMenuSearch','mobileMenuList','menuSheetBackdrop','menuSheetClose','menuForm','menuRows','tableRows']){
  assert(html.includes('id="'+id+'"'),id);
 }
 assert(html.indexOf('/menu-mobile.js')<html.indexOf('/core.js?v='),'mobile view module must load before the controller');
 assert(html.includes('viewport-fit=cover'));
 assert(!/<script(?:\\s[^>]*)?>\\s*[^<\\s]/i.test(html),'no inline JavaScript');
 assert(css.includes('@media(max-width:760px)'));
 assert(css.includes('safe-area-inset-bottom'));
 assert(css.includes('position:fixed!important'));
 assert(css.includes('transition:none!important'));
 assert(!/animate-pulse|keyframes|animation-duration/.test(css),'no animations');
 assert(core.includes("window.TT6MenuMobile.render(data.catalog)"),'must render from real catalog response');
 assert(core.includes("'catalog/'+itemId+'/availability"),'switch must call existing authenticated API');
 assert(core.includes('menuPending.add(itemId)'),'avoid repeat taps causing double toggles');
 assert(core.includes("formPanel.setAttribute('role','dialog')"),'edit overlay should have dialog semantics');
});

function fakeEl(){
 const listeners={};
 return {innerHTML:'',textContent:'',value:'',disabled:false,
  addEventListener(name,cb){listeners[name]=cb},
  fire(name,event){listeners[name](event)}
 };
}
function harness(){
 const ids={mobileMenuApp:fakeEl(),mobileMenuList:fakeEl(),mobileMenuFilters:fakeEl(),
  mobileMenuCount:fakeEl(),mobileMenuSearch:fakeEl(),mobileMenuAdd:fakeEl()};
 const ctx={document:{getElementById(id){return ids[id]},querySelector(){return null}},
  window:{matchMedia:()=>({matches:true})},
  Intl,Number,Array,String,Set};
 vm.runInNewContext(js,ctx,{filename:'menu-mobile.js'});
 return {ids,app:ctx.window.TT6MenuMobile};
}
test('mobile menu renders actual catalog without sample/demo products or fabricated images',()=>{
 const {ids,app}=harness();
 app.render([
  {id:'first',name:'Bún chả Hà Nội',sku:'BC01',category:'Món ăn',price:55000,station:'kitchen',active:true},
  {id:'second',name:'Trà đào cam sả',sku:'TD01',category:'Đồ uống',price:38000,station:'bar',active:false}
 ]);
 assert.match(ids.mobileMenuList.innerHTML,/Bún chả Hà Nội/);
 assert.match(ids.mobileMenuList.innerHTML,/55\.000 ₫/);
 assert.match(ids.mobileMenuList.innerHTML,/Trà đào cam sả/);
 assert.match(ids.mobileMenuList.innerHTML,/data-toggle="first"/);
 assert.match(ids.mobileMenuList.innerHTML,/aria-checked="true"/);
 assert.match(ids.mobileMenuList.innerHTML,/aria-checked="false"/);
 assert.match(ids.mobileMenuList.innerHTML,/data-edit="menu"/);
 assert(!/<img|https?:\/\//.test(ids.mobileMenuList.innerHTML));
 assert.equal(ids.mobileMenuCount.textContent,'2 món · tổng 2');
});
test('search, status and category chips all filter the real catalog',()=>{
 const {ids,app}=harness();
 app.render([
  {id:'a',name:'Cơm gà',category:'Món ăn',price:59000,active:false,station:'kitchen'},
  {id:'b',name:'Nước suối',category:'Đồ uống',price:10000,active:true,station:'bar'},
  {id:'c',name:'Nước dừa',category:'Đồ uống',price:25000,active:true,station:'bar'}
 ]);
 ids.mobileMenuSearch.value='nước';
 ids.mobileMenuSearch.fire('input');
 assert.equal(ids.mobileMenuCount.textContent,'2 món · tổng 3');
 ids.mobileMenuSearch.value='';
 ids.mobileMenuSearch.fire('input');
 ids.mobileMenuFilters.fire('click',{target:{closest:()=>({dataset:{filter:'hidden'}})}});
 assert.equal(ids.mobileMenuCount.textContent,'1 món · tổng 3');
 assert.match(ids.mobileMenuList.innerHTML,/Cơm gà/);
 assert(!ids.mobileMenuList.innerHTML.includes('Nước suối'));
 ids.mobileMenuFilters.fire('click',{target:{closest:()=>({dataset:{filter:'cat:Đồ uống'}})}});
 assert.equal(ids.mobileMenuCount.textContent,'2 món · tổng 3');
 assert(ids.mobileMenuList.innerHTML.includes('Nước dừa'));
});
test('menu names and SKU are safely escaped instead of interpolated into HTML',()=>{
 const {ids,app}=harness();
 app.render([{id:'a',name:'<script>alert(1)</script>',sku:'" onclick="bad',category:'Món ăn',price:10000,active:true,station:'bar'}]);
 assert(!ids.mobileMenuList.innerHTML.includes('<script>'));
 assert(ids.mobileMenuList.innerHTML.includes('&lt;script&gt;'));
 assert(!ids.mobileMenuList.innerHTML.includes('onclick="bad'));
});
