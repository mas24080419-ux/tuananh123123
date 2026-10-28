'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const makeOps=require('../operations');
const idList=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
const ops=makeOps({pool:{},id:()=>idList.shift()});
const ingredientA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ingredientB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lines=[
 {line_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',line_name:'Trà 1',inventory_item_id:ingredientA,amount:'2.000'},
 {line_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',line_name:'Trà 2',inventory_item_id:ingredientA,amount:'3.000'},
 {line_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',line_name:'Trà 2',inventory_item_id:ingredientB,amount:'1.500'}
];
test('movement writes are batched while ingredients remain locked and checked in ID order',async()=>{
 const amounts=new Map([[ingredientA,6],[ingredientB,2]]);
 const locks=[],writes=[],movements=[];
 const client={async query(sql,args){
  if(sql.includes('LEFT JOIN inventory_recipes'))return {rows:lines};
  if(sql.includes('FOR UPDATE')){locks.push(args[0]);return {rowCount:1,rows:[{name:args[0],quantity:amounts.get(args[0])}]}};
  if(sql.startsWith('UPDATE inventory_items SET quantity=quantity-$2')){assert(amounts.get(args[0])>=args[1]);amounts.set(args[0],amounts.get(args[0])-args[1]);writes.push(args);return {rowCount:1}};
  if(sql.startsWith('INSERT INTO inventory_movements')){movements.push({sql,args});return {rowCount:args[0].length}};
  throw Error('Unexpected SQL '+sql);
 }};
 await ops.consume(client,'order-123');
 assert.deepEqual(locks,[ingredientA,ingredientB]);
 assert.equal(writes.length,2);
 assert.equal(amounts.get(ingredientA),1);
 assert.equal(amounts.get(ingredientB),.5);
 assert.equal(movements.length,1);
 assert.deepEqual(movements[0].args[1],[ingredientA,ingredientA,ingredientB]);
 assert.deepEqual(movements[0].args[2],['2.000','3.000','1.500']);
 assert.equal(movements[0].args[0].length,3);
 assert.match(movements[0].sql,/-\(m\.amount::numeric\(14,3\)\)/);
});
