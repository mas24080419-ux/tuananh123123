'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const publicDir=path.join(__dirname,'../public');
const html=fs.readFileSync(path.join(publicDir,'inventory.html'),'utf8');
const css=fs.readFileSync(path.join(publicDir,'inventory.css'),'utf8');
const js=fs.readFileSync(path.join(publicDir,'inventory.js'),'utf8');

test('stock screen uses a single icon language and references declared SVG symbols',()=>{
 const defs=[...html.matchAll(/<symbol id="(stock-icon-[a-z-]+)"/g)].map(x=>x[1]);
 const uses=[...html.matchAll(/<use href="#(stock-icon-[a-z-]+)"/g)].map(x=>x[1]);
 assert(defs.length>=15);
 assert.equal(new Set(defs).size,defs.length);
 assert(uses.length>=15);
 for(const icon of uses)assert(defs.includes(icon),'unresolved icon: '+icon);
 assert(!/[▣⚠✓＋↻⌕]/.test(html),'outdated text symbols should not remain');
 for(const icon of ['triangle-alert','package-open','package','arrow-down-up','sliders-horizontal','arrow-up-right','arrow-down-left','circle-check','chevron-right']){
  assert(defs.includes('stock-icon-'+icon),'missing JS icon definition: '+icon);
 }
 assert(js.includes("stockIcon(statusIcon(status))"));
 assert(js.includes("stockIcon('arrow-down-up')"));
 assert(js.includes("stockIcon('sliders-horizontal')"));
});
test('inventory typography stays readable and does not load an extra icon font',()=>{
 assert(html.includes('Plus+Jakarta+Sans'));
 assert(!/font-awesome|lucide\.min\.css|bootstrap-icons/i.test(html));
 assert(css.includes('font-family:"Plus Jakarta Sans"'));
 assert(css.includes('.tt6-inventory-page .tt6-sidebar'));
 assert(css.includes('.stock-mini-action .stock-ui-icon'));
 assert(css.includes('@media(max-width:720px)'));
 assert(css.includes('min-height:40px;font-size:11.5px'));
 assert(css.includes('prefers-reduced-motion:reduce'));
});
test('inventory buttons preserve accessible labels and real API actions',()=>{
 for(const id of ['refreshStock','addStockItem','viewAllAlerts','stockSearch','movementForm','itemForm','reorderForm'])
  assert(html.includes('id="'+id+'"'),'missing UI control '+id);
 for(const api of ['/api/v1/inventory','/api/v1/inventory/items','/api/v1/inventory/movements'])
  assert(js.includes(api),'missing real API '+api);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(new Set(ids).size,ids.length,'duplicate DOM ids including SVG symbols');
 assert(!/<script(?:\s[^>]*)?>\s*[^<\s]/i.test(html),'do not add inline JS');
});
