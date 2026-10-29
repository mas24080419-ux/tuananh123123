'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const economics=require('../unit-economics');
const createService=require('../service-costs');
const createIngredient=require('../ingredient-costs');
const uuid=()=>crypto.randomUUID();
test('recipe margins do not assume unpriced ingredients are free',()=>{
 const r=economics.model([
  {id:uuid(),name:'Cà phê',price:30000,ingredient_count:2,missing_ingredient_costs:0,inactive_ingredients:0,cost_per_unit:'12000.000'},
  {id:uuid(),name:'Nước ép',price:40000,ingredient_count:1,missing_ingredient_costs:1,inactive_ingredients:0,cost_per_unit:'0.000'},
  {id:uuid(),name:'Chưa có công thức',price:25000,ingredient_count:0,missing_ingredient_costs:0,inactive_ingredients:0,cost_per_unit:'0'}
 ],[],[]);
 assert.equal(r.recipes[0].estimatedUnitCost,12000);
 assert.equal(r.recipes[0].estimatedUnitContribution,18000);
 assert.equal(r.recipes[0].estimatedMarginPct,60);
 assert.equal(r.recipes[1].estimatedUnitCost,null);
 assert.equal(r.recipes[1].estimatedMarginPct,null);
 assert.equal(r.recipes[2].configured,false);
 assert.equal(r.quality.uncostedMenuItems,2);
});
test('each service margin uses stored transaction snapshots, never current rate to reprice the past',()=>{
 const results=economics.model([],[{
  service_key:'locker',receipts:3,quantity:3,revenue:'90000',recorded_direct_cost:'12000',missing_cost_receipts:1,costed_receipts:2
 },{
  service_key:'float_child_vest',receipts:2,quantity:2,revenue:'40000',recorded_direct_cost:'10000',missing_cost_receipts:0,costed_receipts:2
 }],[{service_key:'locker',unit_cost:'10000'},{service_key:'float_child_vest',unit_cost:'5000'}]);
 const locker=results.services[0],float=results.services[1];
 assert.equal(locker.knownDirectCost,12000);
 assert.equal(locker.estimatedContribution,null);
 assert.equal(locker.missingCostReceipts,1);
 assert.equal(locker.unitCostConfigured,10000);
 assert.equal(float.estimatedContribution,30000);
 assert.equal(float.estimatedMarginPct,75);
});
test('service cost snapshot inside receipt transaction captures null if no rate, never writes income',async()=>{
 const writes=[];
 const client={async query(sql,args=[]){
  writes.push({sql,args});
  if(sql.startsWith('SELECT unit_cost'))return {rows:[]};
  return {rows:[],rowCount:1};
 }};
 const service=createService({pool:{query:async()=>({rows:[]})}});
 const result=await service.snapshot(client,{source:'locker',receiptId:uuid(),serviceKey:'locker',quantity:1});
 assert.equal(result.unitCost,null);
 assert.equal(result.known,false);
 const inserted=writes.find(x=>x.sql.startsWith('INSERT INTO service_cost_snapshots'));
 assert(inserted);
 assert.equal(inserted.args[4],null);
 assert(!writes.some(x=>/finance_entries|UPDATE dining_orders|UPDATE inventory_items/.test(x.sql)));
});
test('service cost snapshot supports known 0 direct cost only when explicitly configured',async()=>{
 const client={async query(sql,args=[]){
  if(sql.startsWith('SELECT unit_cost'))return {rows:[{unit_cost:0}]};
  if(sql.startsWith('INSERT INTO service_cost_snapshots')){assert.equal(args[4],0);return{rowCount:1}};
  throw Error(sql);
 }};
 const service=createService({pool:{}});
 const result=await service.snapshot(client,{source:'area',receiptId:uuid(),serviceKey:'float_child_vest',quantity:3});
 assert.equal(result.known,true);
 assert.equal(result.unitCost,0);
});
test('changes to service unit cost are audited and never create artificial transactions',async()=>{
 const statements=[];
 const client={async query(sql,args=[]){
  statements.push(sql);
  if(sql.startsWith('SELECT unit_cost'))return {rows:[]};
  if(sql.startsWith('INSERT INTO service_cost_rates'))return {rows:[{service_key:'locker',unit_cost:'4000',updated_at:'2026-10-29T00:00:00Z'}]};
  return {rows:[],rowCount:1};
 },release(){}};
 const service=createService({pool:{connect:async()=>client},id:uuid});
 const result=await service.set({serviceKey:'locker',unitCost:4000},{role:'admin',userId:uuid()});
 assert.equal(result.unitCost,4000);
 assert(statements.includes('BEGIN')&&statements.includes('COMMIT'));
 assert(statements.some(s=>s.includes('INSERT INTO pos_audit')));
 assert(!statements.some(s=>/INSERT INTO finance_entries|UPDATE inventory_items|UPDATE dining_orders/.test(s)));
});
test('ingredient reference cost update is audited but does not create stock or cash entries',async()=>{
 const statements=[],ingredientId=uuid();
 const client={async query(sql,args=[]){
  statements.push(sql);
  if(sql.startsWith('SELECT id,name FROM inventory_items'))return {rowCount:1,rows:[{id:ingredientId,name:'Chanh leo'}]};
  if(sql.startsWith('SELECT unit_cost FROM ingredient_cost_standards'))return {rows:[]};
  return {rowCount:1,rows:[]};
 },release(){}};
 const ingredient=createIngredient({pool:{connect:async()=>client},id:uuid});
 await ingredient.set({ingredientId,unitCost:13000},{role:'admin',userId:uuid()});
 assert(statements.includes('BEGIN')&&statements.includes('COMMIT'));
 assert(statements.some(s=>s.includes('INSERT INTO ingredient_cost_standards')));
 assert(statements.some(s=>s.includes('INSERT INTO pos_audit')));
 assert(!statements.some(s=>/INSERT INTO inventory_movements|INSERT INTO finance_entries|UPDATE inventory_items/.test(s)));
 await assert.rejects(()=>ingredient.set({ingredientId,unitCost:0}),e=>e.status===400);
});
test('selling items snapshots effective standard to movement while canceled items restore same stored cost',()=>{
 const operations=fs.readFileSync(path.join(__dirname,'../operations.js'),'utf8');
 assert(operations.includes('COALESCE(s.unit_cost,i.avg_unit_cost)'));
 assert(operations.includes("LEFT JOIN ingredient_cost_standards s ON s.inventory_item_id=i.id"));
 assert(operations.includes("line.unit_cost,lineId"));
});
test('cost endpoints are owner-only; report remains read-only',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const econ=fs.readFileSync(path.join(__dirname,'../unit-economics.js'),'utf8');
 for(const route of ['/api/admin/ingredient-costs','/api/admin/service-cost-rates'])assert(server.includes("p==='"+route+"'"));
 assert(server.includes("if(!await requireAdmin(req,res))return"));
 assert(!/UPDATE\s+dining_orders|INSERT\s+INTO\s+finance_entries/i.test(econ));
 assert(economics.sql.recipeCatalog.includes('ingredient_cost_standards'));
});
