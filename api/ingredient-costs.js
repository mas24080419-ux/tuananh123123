'use strict';
// A manually entered standard does not modify inventory weighted average or cash.
// New order movements snapshot the effective cost in the same order transaction.
const bad=(message,status=400)=>Object.assign(Error(message),{status});
module.exports=function ingredientCosts({pool,id}){
 async function list(){
  if(!pool)throw bad('Cần PostgreSQL.',503);
  const r=await pool.query(`SELECT i.id,i.name,i.unit,i.quantity,i.avg_unit_cost,
     s.unit_cost AS standard_unit_cost,s.updated_at
   FROM inventory_items i LEFT JOIN ingredient_cost_standards s ON s.inventory_item_id=i.id
   WHERE i.active=true ORDER BY i.name`);
  return r.rows.map(x=>({
   id:x.id,name:x.name,unit:x.unit,quantity:Number(x.quantity),
   purchaseAverageUnitCost:Number(x.avg_unit_cost),
   standardUnitCost:x.standard_unit_cost===null?null:Number(x.standard_unit_cost),
   effectiveCost:x.standard_unit_cost===null?Number(x.avg_unit_cost):Number(x.standard_unit_cost),
   updatedAt:x.updated_at||null
  }));
 }
 async function set(body,actor){
  if(!pool)throw bad('Cần PostgreSQL.',503);
  const inventoryId=body?.ingredientId,unitCost=body?.unitCost;
  if(typeof inventoryId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(inventoryId))throw bad('Nguyên liệu không hợp lệ.');
  if(unitCost!==null&&(!Number.isSafeInteger(unitCost)||unitCost<1||unitCost>1000000000))throw bad('Giá vốn phải là số nguyên VND từ 1 đến 1 tỷ. Gửi null để bỏ giá tham chiếu và dùng giá nhập kho.');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const found=await c.query('SELECT id,name FROM inventory_items WHERE id=$1 AND active=true FOR UPDATE',[inventoryId]);
   if(!found.rowCount)throw bad('Không tìm thấy nguyên liệu đang hoạt động.',404);
   // Prevent concurrent cost updates while creating sale snapshots.
   const old=await c.query('SELECT unit_cost FROM ingredient_cost_standards WHERE inventory_item_id=$1 FOR UPDATE',[inventoryId]);
   if(unitCost===null)await c.query('DELETE FROM ingredient_cost_standards WHERE inventory_item_id=$1',[inventoryId]);
   else await c.query('INSERT INTO ingredient_cost_standards(inventory_item_id,unit_cost) VALUES($1,$2) ON CONFLICT(inventory_item_id) DO UPDATE SET unit_cost=excluded.unit_cost,updated_at=now()',[inventoryId,unitCost]);
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,before_state,after_state) VALUES($1,$2,'inventory_item',$3,'cost_standard_changed',$4::jsonb,$5::jsonb)",
    [id(),actor?.userId||'admin',inventoryId,JSON.stringify({cost:old.rows[0]?.unit_cost??null}),JSON.stringify({cost:unitCost})]);
   await c.query('COMMIT');
   return {ingredientId:inventoryId,unitCost};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 return {list,set};
};
