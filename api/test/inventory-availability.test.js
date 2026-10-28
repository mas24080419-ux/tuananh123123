'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ops=require('../operations')({pool:{},id:()=> '00000000-0000-4000-8000-000000000001'});
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const guest=fs.readFileSync(path.join(__dirname,'..','public','guest.js'),'utf8');

function fakeClient(initial,recipeMode='configured'){
 let remaining=initial,updated=0,movements=0;
 const c={async query(sql,args){
  if(sql.includes('LEFT JOIN inventory_recipes r ON r.menu_item_id=l.menu_item_id')){
   return {rows:[recipeMode==='missing'
    ?{line_id:'line-1',line_name:'Dừa xiêm',inventory_item_id:null,amount:null}
    :{line_id:'line-1',line_name:'Dừa xiêm',inventory_item_id:'stock-1',amount:2}]};
  }
  if(sql.includes('SELECT name,quantity FROM inventory_items'))return {rowCount:1,rows:[{name:'Dừa xiêm',quantity:remaining}]};
  if(sql.includes('UPDATE inventory_items SET quantity=quantity-$2')){
   assert(remaining>=args[1]);remaining-=args[1];updated++;return {rowCount:1};
  }
  if(sql.includes("'consume'")){movements++;return {rowCount:1};}
  throw Error('Unexpected SQL '+sql);
 }};
 return {c,stats:()=>({remaining,updated,movements})};
}
test('Backend refuses dishes without stock mapping instead of bypassing stock checks',async()=>{
 const db=fakeClient(1000,'missing');
 await assert.rejects(()=>ops.consume(db.c,'order-1'),e=>e.status===409&&/chưa liên kết kho/.test(e.message));
 assert.deepEqual(db.stats(),{remaining:1000,updated:0,movements:0});
});
test('Backend consumes per-dish stock and refuses a later request after stock runs out',async()=>{
 const db=fakeClient(3);
 await ops.consume(db.c,'order-1');
 assert.deepEqual(db.stats(),{remaining:1,updated:1,movements:1});
 await assert.rejects(()=>ops.consume(db.c,'order-2'),e=>e.status===409&&/Không đủ nguyên liệu/.test(e.message));
 assert.deepEqual(db.stats(),{remaining:1,updated:1,movements:1});
});
test('Guest availability is computed from database recipe quantities, not a fixed demo label',()=>{
 assert.match(server,/CASE WHEN COUNT\(r\.inventory_item_id\)=0 THEN 0/);
 assert.match(server,/FLOOR\(i\.quantity\/r\.quantity_per_unit\)/);
 assert.match(server,/available_quantity/);
 assert.match(server,/items:await getMenu\(\)/);
 assert.match(guest,/function availableQty/);
 assert.match(guest,/stockBadge\(p\)/);
 assert.match(guest,/data-select-item/);
 assert.match(guest,/hasUnavailableCart\(\)/);
 assert.match(guest,/refreshMenuAvailability/);
});

test('QR inventory movement uses a typed PostgreSQL numeric negation, not -unknown',async()=>{
 const db=fakeClient(5);
 await ops.consume(db.c,'order-typed');
 assert.deepEqual(db.stats(),{remaining:3,updated:1,movements:1});
 const source=fs.readFileSync(path.join(__dirname,'..','operations.js'),'utf8');
 assert(source.includes("-(m.amount::numeric(14,3)),'consume'"));
 assert(source.includes('FROM UNNEST($1::uuid[],$2::uuid[],$3::numeric[],$4::uuid[])'));
 assert(!source.includes('for(const line of recipe.rows)await c.query('));
 assert(!source.includes("SELECT $1,$2,-$3,'consume'"));
});
