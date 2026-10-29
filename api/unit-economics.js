'use strict';
// Unit economics for stocked products and confirmed service receipts.
// Service direct costs are owner-defined estimates snapshotted at sale time.
// The service snapshot does NOT create an extra cash-out entry.
const sql={
 recipeCatalog:`SELECT m.id,m.name,m.category,m.price,
  COUNT(r.inventory_item_id)::int AS ingredient_count,
  COUNT(*) FILTER (WHERE r.inventory_item_id IS NOT NULL AND
   COALESCE(s.unit_cost,i.avg_unit_cost,0)<=0)::int AS missing_ingredient_costs,
  COALESCE(SUM(r.quantity_per_unit * COALESCE(s.unit_cost,i.avg_unit_cost,0)),0)::numeric AS cost_per_unit,
  COUNT(*) FILTER(WHERE r.inventory_item_id IS NOT NULL AND i.active=false)::int AS inactive_ingredients
 FROM menu_items m
 LEFT JOIN inventory_recipes r ON r.menu_item_id=m.id
 LEFT JOIN inventory_items i ON i.id=r.inventory_item_id
 LEFT JOIN ingredient_cost_standards s ON s.inventory_item_id=i.id
 WHERE m.active=true
 GROUP BY m.id,m.name,m.category,m.price
 ORDER BY m.category,m.name`,
 serviceMargins:`WITH service_lines AS (
 SELECT 'locker'::text AS service_key,lr.id AS source_id,
        f.amount AS revenue,1::int AS quantity,
        s.unit_cost,s.total_cost
 FROM locker_rentals lr
 JOIN finance_entries f ON f.id=lr.finance_entry_id AND f.direction='income'
 LEFT JOIN service_cost_snapshots s ON s.source='locker' AND s.receipt_id=lr.id
 WHERE (f.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 UNION ALL
 SELECT CASE WHEN a.service='float' AND d.float_type IS NOT NULL
  THEN 'float_'||d.float_type
  WHEN a.service='restroom' THEN 'restroom'
  ELSE 'unclassified' END AS service_key,
  a.id AS source_id,f.amount AS revenue,a.quantity,
  s.unit_cost,s.total_cost
 FROM area_receipts a
 JOIN finance_entries f ON f.id=a.finance_entry_id AND f.direction='income'
 LEFT JOIN float_receipt_details d ON d.receipt_id=a.id
 LEFT JOIN service_cost_snapshots s ON s.source='area' AND s.receipt_id=a.id
 WHERE a.service<>'locker' AND
  (f.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 )
 SELECT service_key,
 COUNT(*)::int AS receipts,
 COALESCE(SUM(quantity),0)::int AS quantity,
 COALESCE(SUM(revenue),0)::bigint AS revenue,
 COALESCE(SUM(total_cost),0)::bigint AS recorded_direct_cost,
 COUNT(*) FILTER(WHERE unit_cost IS NULL)::int AS missing_cost_receipts,
 COUNT(*) FILTER(WHERE unit_cost IS NOT NULL)::int AS costed_receipts
 FROM service_lines GROUP BY service_key ORDER BY revenue DESC`,
 serviceRateCatalog:`SELECT service_key,unit_cost FROM service_cost_rates`
};
const num=v=>{const n=Number(v??0);if(!Number.isFinite(n)||!Number.isSafeInteger(n))throw Error('Giá trị tính toán vượt phạm vi số nguyên VND an toàn.');return n};
function model(products,services,rates){
 const costByKey=new Map(rates.map(r=>[r.service_key,num(r.unit_cost)]));
 const dishes=products.map(r=>{
  const count=num(r.ingredient_count),miss=num(r.missing_ingredient_costs),inactive=num(r.inactive_ingredients);
  const price=num(r.price),unitCost=Math.round(Number(r.cost_per_unit||0));
  const complete=count>0&&miss===0&&inactive===0;
  return {id:r.id,name:r.name,category:r.category,unitPrice:price,ingredientCount:count,
   missingCostIngredients:miss,inactiveIngredients:inactive,configured:complete,
   estimatedUnitCost:complete?unitCost:null,
   estimatedUnitContribution:complete?price-unitCost:null,
   estimatedMarginPct:complete&&price>0?Math.round(10000*(price-unitCost)/price)/100:null};
 });
 const names={
  locker:'Tủ đồ',float_child_vest:'Áo phao trẻ em',float_black_adult:'Phao bơi đen người lớn',
  float_child_float:'Phao bơi trẻ em',restroom:'Nhà vệ sinh',unclassified:'Dịch vụ chưa phân loại'
 };
 const marginRows=services.map(r=>{
  const income=num(r.revenue),knownCost=num(r.recorded_direct_cost),unknown=num(r.missing_cost_receipts);
  const complete=unknown===0;
  return {serviceKey:r.service_key,name:names[r.service_key]||r.service_key,
   receipts:num(r.receipts),quantity:num(r.quantity),received:income,
   knownDirectCost:knownCost,missingCostReceipts:unknown,costedReceipts:num(r.costed_receipts),
   unitCostConfigured:costByKey.has(r.service_key)?costByKey.get(r.service_key):null,
   estimatedContribution:complete?income-knownCost:null,
   estimatedMarginPct:complete&&income>0?Math.round(10000*(income-knownCost)/income)/100:null};
 });
 return {
  basis:'direct_unit_cost_snapshot_and_current_recipe_estimate',
  recipes:dishes,
  services:marginRows,
  quality:{
   uncostedMenuItems:dishes.filter(x=>!x.configured).length,
   uncostedServiceReceipts:marginRows.reduce((s,x)=>s+x.missingCostReceipts,0),
   warning:'Giá vốn món hiện tại theo định mức và đơn giá kho; giá vốn bán ra theo lịch sử xuất kho. Giá vốn dịch vụ là định mức trực tiếp do chủ cửa hàng nhập, không tự phát sinh chi tiền. Chi phí vận hành, hao mòn tài sản và thuế có thể cần phân bổ riêng để tránh tính trùng.'
  }
 };
}
async function overview(pool,from,to){
 if(!pool)throw Object.assign(Error('Phân tích giá vốn yêu cầu PostgreSQL.'),{status:503});
 const [menu,service,rates]=await Promise.all([
  pool.query(sql.recipeCatalog),pool.query(sql.serviceMargins,[from,to]),pool.query(sql.serviceRateCatalog)
 ]);
 return model(menu.rows,service.rows,rates.rows);
}
module.exports={sql,model,overview};
