'use strict';
// The cost rate is an owner-supplied direct-cost estimate for each new rental / sale.
// Snapshot it in the same transaction as the receipt, never retrospectively
// reprice older sales. No rate means unknown cost, not 0 VND.
const {floatTypes}=require('./area-access');
const catalog=[
 {key:'locker',name:'Thuê tủ đồ',unit:'lượt thuê',sellPrice:30000},
 ...Object.entries(floatTypes).map(([type,v])=>({
  key:'float_'+type,name:v.name,unit:'lượt thuê',sellPrice:v.price
 })),
 {key:'restroom',name:'Dịch vụ nhà vệ sinh',unit:'lượt',sellPrice:null}
];
const accepted=new Set(catalog.map(x=>x.key));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function validate(input){
 const key=String(input?.serviceKey||'');
 if(!accepted.has(key))throw fail('Dịch vụ không hợp lệ.');
 const value=input?.unitCost;
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1000000000)
  throw fail('Giá vốn trực tiếp phải là số nguyên VND trong khoảng 0 đến 1 tỷ, không được bỏ trống.');
 return {key,unitCost:value};
}
module.exports=function serviceCosts({pool,id=()=>require('node:crypto').randomUUID()}){
 async function list(){
  if(!pool)throw fail('Chức năng giá vốn yêu cầu PostgreSQL.',503);
  const rows=(await pool.query('SELECT service_key,unit_cost,updated_at FROM service_cost_rates ORDER BY service_key')).rows;
  const byKey=new Map(rows.map(r=>[r.service_key,r]));
  return catalog.map(item=>{
   const record=byKey.get(item.key);
   return {...item,unitCost:record?Number(record.unit_cost):null,
    configured:Boolean(record),updatedAt:record?.updated_at||null};
  });
 }
 async function set(input,actor){
  if(!pool)throw fail('Chức năng giá vốn yêu cầu PostgreSQL.',503);
  const {key,unitCost}=validate(input),c=await pool.connect();
  try{
   await c.query('BEGIN');
   const previous=await c.query('SELECT unit_cost FROM service_cost_rates WHERE service_key=$1 FOR UPDATE',[key]);
   const q=await c.query('INSERT INTO service_cost_rates(service_key,unit_cost) VALUES($1,$2) ON CONFLICT(service_key) DO UPDATE SET unit_cost=EXCLUDED.unit_cost,updated_at=now() RETURNING service_key,unit_cost,updated_at',[key,unitCost]);
   await c.query("INSERT INTO pos_audit(id,actor,entity,action,before_state,after_state) VALUES($1,$2,'service_direct_cost','rate_changed',$3::jsonb,$4::jsonb)",
    [id(),actor?.userId||'admin',JSON.stringify({serviceKey:key,unitCost:previous.rows[0]?.unit_cost??null}),JSON.stringify({serviceKey:key,unitCost})]);
   await c.query('COMMIT');
   return {serviceKey:q.rows[0].service_key,unitCost:Number(q.rows[0].unit_cost),updatedAt:q.rows[0].updated_at};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async function snapshot(client,{source,receiptId,serviceKey,quantity}){
  if(!['locker','area'].includes(source)||!accepted.has(serviceKey)||
   !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(receiptId||'')||
   !Number.isInteger(quantity)||quantity<1||quantity>10000)
   throw fail('Thông tin chốt giá vốn dịch vụ không hợp lệ.');
  // One SELECT and INSERT, within the caller's sales transaction.
  // The rate row is locked until COMMIT so saving a new rate cannot race this snapshot.
  const r=(await client.query('SELECT unit_cost FROM service_cost_rates WHERE service_key=$1 FOR SHARE',[serviceKey])).rows[0];
  const unitCost=r?Number(r.unit_cost):null;
  await client.query('INSERT INTO service_cost_snapshots(source,receipt_id,service_key,quantity,unit_cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,receipt_id) DO NOTHING',
   [source,receiptId,serviceKey,quantity,unitCost]);
  return {serviceKey,quantity,unitCost,known:unitCost!==null};
 }
 return {catalog:list,set,snapshot};
};
