'use strict';
module.exports=function operations({pool,id}){
 const bad=(m,status=400)=>Object.assign(Error(m),{status});
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
 const checkId=(x,name)=>{if(!uuid(x))throw bad(name+' không hợp lệ.');return x};
 const cleaned=(x,n=180)=>String(x||'').trim().slice(0,n);
 const qty=x=>{const n=Number(x);if(!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*1000-Math.round(n*1000))>0.000001)throw bad('Số lượng không hợp lệ (tối đa 3 chữ số thập phân).');return n};
 const cost=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<0||n>999999999999)throw bad('Số tiền VND không hợp lệ.');return n};
 const pay=x=>{if(!['cash','bank_transfer'].includes(x))throw bad('Cần chọn tiền mặt hoặc chuyển khoản.');return x};
 async function transaction(run){
  if(!pool)throw bad('Chức năng thu–chi/kho yêu cầu PostgreSQL, không hỗ trợ chế độ RAM.',503);
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result}
  catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }
 async function overview(from,to){
  if(!pool)throw bad('Báo cáo thu–chi/kho yêu cầu PostgreSQL.',503);
  const bounds=[from,to];
  const finance=(await pool.query("WITH f AS (SELECT * FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date), p AS (SELECT paid_amount,payment_method FROM dining_orders WHERE payment_status='paid' AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date) SELECT coalesce((SELECT sum(paid_amount) FROM p),0)::bigint AS sales_received, coalesce((SELECT sum(amount) FROM f WHERE direction='income'),0)::bigint AS other_income,coalesce((SELECT sum(amount) FROM f WHERE direction='expense'),0)::bigint AS expenses,coalesce((SELECT sum(amount) FROM f WHERE source='stock_purchase'),0)::bigint AS stock_purchases,coalesce((SELECT sum(amount) FROM f WHERE source='manual' AND direction='expense'),0)::bigint AS operating_expenses,coalesce((SELECT sum(paid_amount) FROM p WHERE payment_method='cash'),0)::bigint AS sales_cash,coalesce((SELECT sum(paid_amount) FROM p WHERE payment_method='bank_transfer'),0)::bigint AS sales_transfer",bounds)).rows[0];
  const [items,recipes,movements,entries,menu,days]=await Promise.all([
   pool.query("SELECT id,name,unit,quantity,reorder_level,avg_unit_cost FROM inventory_items WHERE active=true ORDER BY name"),
   pool.query("SELECT r.menu_item_id,r.inventory_item_id,r.quantity_per_unit,m.name AS menu_name,i.name AS ingredient_name,i.unit FROM inventory_recipes r JOIN menu_items m ON r.menu_item_id=m.id JOIN inventory_items i ON r.inventory_item_id=i.id ORDER BY m.name,i.name"),
   pool.query("SELECT v.id,v.created_at,v.kind,v.delta,v.unit_cost,v.note,i.name AS item_name,i.unit FROM inventory_movements v JOIN inventory_items i ON v.inventory_item_id=i.id ORDER BY v.created_at DESC LIMIT 100"),
   pool.query("SELECT id,created_at,direction,category,amount,payment_method,note,source FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date ORDER BY created_at DESC LIMIT 200",bounds),
   pool.query("SELECT id,name,category FROM menu_items WHERE active=true ORDER BY name"),
   pool.query("SELECT day,sum(inflow)::bigint AS inflow,sum(outflow)::bigint AS outflow FROM (SELECT (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,paid_amount AS inflow,0::bigint AS outflow FROM dining_orders WHERE payment_status='paid' AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date UNION ALL SELECT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,CASE WHEN direction='income' THEN amount ELSE 0 END,CASE WHEN direction='expense' THEN amount ELSE 0 END FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date) x GROUP BY day ORDER BY day",bounds)
  ]);
  const inventory=items.rows.map(i=>({...i,low_stock:Number(i.quantity)<=Number(i.reorder_level)}));
  const inflow=Number(finance.sales_received)+Number(finance.other_income),outflow=Number(finance.expenses);
  return {finance:{...finance,total_in:inflow,total_out:outflow,net_cashflow:inflow-outflow,
   low_stock_count:inventory.filter(i=>i.low_stock).length,stock_value_estimate:Math.round(inventory.reduce((s,i)=>s+Number(i.quantity)*Number(i.avg_unit_cost),0))},
   inventory,recipes:recipes.rows,movements:movements.rows,entries:entries.rows,menu:menu.rows,daily:days.rows};
 }
 // Inventory alerts are computed from actual persisted stock; never seed sample stock.
 async function inventoryDashboard(){
  if(!pool)throw bad('Quản lý kho cần kết nối PostgreSQL.',503);
  const [items,movements]=await Promise.all([
   pool.query('SELECT id,name,unit,quantity,reorder_level,avg_unit_cost,created_at FROM inventory_items WHERE active=true ORDER BY name'),
   pool.query("SELECT m.id,m.created_at,m.kind,m.delta,m.note,i.name AS item_name,i.unit FROM inventory_movements m JOIN inventory_items i ON i.id=m.inventory_item_id ORDER BY m.created_at DESC LIMIT 20")
  ]);
  const rows=items.rows.map(row=>({...row,low_stock:Number(row.quantity)<=Number(row.reorder_level)}));
  const status=row=>{
   const qty=Number(row.quantity),level=Number(row.reorder_level);
   return qty<=0||(level>0&&qty<=level*.25)?'critical':qty<=level?'low':'healthy';
  };
  return {items:rows,movements:movements.rows,
   summary:{total:rows.length,low:rows.filter(row=>row.low_stock).length,
    critical:rows.filter(row=>status(row)==='critical').length,
    healthy:rows.filter(row=>!row.low_stock).length}};
 }
 async function updateReorderLevel(itemId,b){
  checkId(itemId,'Mã nguyên liệu');
  const raw=b?.reorderLevel;
  const level=Number(raw);
  if(raw===null||raw===undefined||String(raw).trim()===''||!Number.isFinite(level)||level<0||level>1000000||Math.abs(level*1000-Math.round(level*1000))>0.000001)
   throw bad('Mức cảnh báo phải từ 0 đến 1.000.000 và có tối đa 3 chữ số thập phân.');
  return transaction(async c=>{
   const old=(await c.query('SELECT id,name,reorder_level FROM inventory_items WHERE id=$1 AND active=true FOR UPDATE',[itemId])).rows[0];
   if(!old)throw bad('Nguyên liệu không tồn tại.',404);
   if(Number(old.reorder_level)===level)return {id:old.id,reorder_level:old.reorder_level,unchanged:true};
   const updated=(await c.query('UPDATE inventory_items SET reorder_level=$2 WHERE id=$1 RETURNING id,name,unit,quantity,reorder_level',[itemId,level])).rows[0];
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,before_state,after_state) VALUES($1,'admin','inventory_item',$2,'reorder_level_changed',$3::jsonb,$4::jsonb)",
    [id(),itemId,JSON.stringify({reorder_level:old.reorder_level}),JSON.stringify({reorder_level:updated.reorder_level})]);
   return updated;
  });
 }
 async function createItem(b){
  const name=cleaned(b.name,80),unit=cleaned(b.unit,16),limit=Number(b.reorderLevel||0);
  if(name.length<2||!unit||!Number.isFinite(limit)||limit<0||limit>1000000||Math.abs(limit*1000-Math.round(limit*1000))>0.000001)throw bad('Tên nguyên liệu, đơn vị hoặc mức cảnh báo không hợp lệ.');
  return transaction(async c=>{
   const result=await c.query("INSERT INTO inventory_items(id,name,unit,reorder_level) VALUES($1,$2,$3,$4) ON CONFLICT(name) DO NOTHING RETURNING id,name,unit,quantity,reorder_level",[id(),name,unit,limit]);
   if(!result.rowCount)throw bad('Nguyên liệu đã có trong kho.',409);return result.rows[0];
  });
 }
 async function setRecipe(b){
  checkId(b.menuItemId,'Mã món');checkId(b.inventoryItemId,'Mã nguyên liệu');
  const x=Number(b.quantityPerUnit);
  if(!Number.isFinite(x)||x<0||x>100000||Math.abs(x*1000-Math.round(x*1000))>0.000001)throw bad('Định mức nguyên liệu không hợp lệ.');
  return transaction(async c=>{
   const checks=await Promise.all([c.query("SELECT id FROM menu_items WHERE id=$1 AND active=true",[b.menuItemId]),c.query("SELECT id FROM inventory_items WHERE id=$1 AND active=true",[b.inventoryItemId])]);
   if(!checks[0].rowCount||!checks[1].rowCount)throw bad('Món hoặc nguyên liệu không tồn tại.',404);
   if(x===0){await c.query("DELETE FROM inventory_recipes WHERE menu_item_id=$1 AND inventory_item_id=$2",[b.menuItemId,b.inventoryItemId]);return {removed:true}}
   await c.query("INSERT INTO inventory_recipes(menu_item_id,inventory_item_id,quantity_per_unit) VALUES($1,$2,$3) ON CONFLICT(menu_item_id,inventory_item_id) DO UPDATE SET quantity_per_unit=EXCLUDED.quantity_per_unit",[b.menuItemId,b.inventoryItemId,x]);return {saved:true};
  });
 }
 async function entry(b){
  checkId(b.requestId,'Mã yêu cầu');
  const direction=b.direction,category=cleaned(b.category,60),note=cleaned(b.note,250),amount=cost(b.amount),payment=pay(b.paymentMethod);
  if(!['income','expense'].includes(direction)||!category||amount===0)throw bad('Loại khoản, danh mục hoặc số tiền không hợp lệ.');
  return transaction(async c=>{
   const prior=await c.query("SELECT id FROM finance_entries WHERE request_id=$1",[b.requestId]);
   if(prior.rowCount)return {id:prior.rows[0].id,duplicate:true};
   const result=await c.query("INSERT INTO finance_entries(id,request_id,direction,category,amount,payment_method,note,source) VALUES($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING id",[id(),b.requestId,direction,category,amount,payment,note]);
   return {id:result.rows[0].id,duplicate:false};
  });
 }
 async function move(b){
  checkId(b.inventoryItemId,'Mã nguyên liệu');checkId(b.requestId,'Mã yêu cầu');
  if(!['purchase','opening','adjustment_in','adjustment_out'].includes(b.kind))throw bad('Loại nhập/xuất không hợp lệ.');
  const quantity=qty(b.quantity),unitCost=b.kind==='purchase'?cost(b.unitCost):0,note=cleaned(b.note,250);
  if(b.kind==='purchase'&&unitCost===0)throw bad('Đơn giá nhập phải lớn hơn 0.');
  const payment=b.kind==='purchase'?pay(b.paymentMethod):null;
  const supplierId=b.kind==='purchase'&&b.supplierId?checkId(b.supplierId,'Mã nhà cung cấp'):null;
  const invoiceRef=cleaned(b.invoiceReference,80);
  if(b.kind!=='purchase'&&!note)throw bad('Phải có lý do khi tạo tồn đầu kỳ hoặc điều chỉnh.');
  return transaction(async c=>{
   const r=await c.query("SELECT id,quantity,avg_unit_cost FROM inventory_items WHERE id=$1 AND active=true FOR UPDATE",[b.inventoryItemId]);
   if(!r.rowCount)throw bad('Không tìm thấy nguyên liệu.',404);
   const prior=await c.query("SELECT id FROM inventory_movements WHERE request_id=$1",[b.requestId]);
   if(prior.rowCount)return {id:prior.rows[0].id,duplicate:true};
   const item=r.rows[0],before=Number(item.quantity),delta=b.kind==='adjustment_out'?-quantity:quantity;
   const after=Math.round((before+delta)*1000)/1000;
   if(after<0)throw bad('Không đủ số lượng tồn kho.',409);
   const expense=b.kind==='purchase'?Math.round(quantity*unitCost):0;
   if(b.kind==='purchase'&&(!Number.isSafeInteger(expense)||expense===0))throw bad('Giá trị phiếu nhập không hợp lệ.');
   const avg=b.kind==='purchase'?Math.round((before*Number(item.avg_unit_cost)+expense)/after):Number(item.avg_unit_cost);
   const movementId=id();
   await c.query("UPDATE inventory_items SET quantity=$2,avg_unit_cost=$3 WHERE id=$1",[item.id,after,avg]);
   await c.query("INSERT INTO inventory_movements(id,inventory_item_id,delta,kind,unit_cost,note,request_id,supplier_id,invoice_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[movementId,item.id,delta,b.kind,unitCost,note,b.requestId,supplierId,invoiceRef]);
   if(b.kind==='purchase')await c.query("INSERT INTO finance_entries(id,request_id,direction,category,amount,payment_method,note,source,inventory_movement_id) VALUES($1,$2,'expense','Nhập nguyên liệu',$3,$4,$5,'stock_purchase',$6)",[id(),b.requestId,expense,payment,note,movementId]);
   return {id:movementId,quantity:after,expense,duplicate:false};
  });
 }
 async function consume(c,orderId){
  const recipe=await c.query("SELECT l.id AS line_id,l.name AS line_name,r.inventory_item_id,(l.quantity*r.quantity_per_unit)::numeric(14,3) AS amount FROM dining_order_lines l LEFT JOIN inventory_recipes r ON r.menu_item_id=l.menu_item_id WHERE l.order_id=$1 ORDER BY r.inventory_item_id NULLS FIRST,l.id",[orderId]);
  // Reject the entire order if even one item has no stock mapping.
  // This prevents products without recipes bypassing inventory controls.
  const unmapped=recipe.rows.find(x=>!x.inventory_item_id);
  if(unmapped)throw bad('Món '+unmapped.line_name+' chưa liên kết kho, vui lòng chọn món khác.',409);
  const aggregated=new Map();
  for(const line of recipe.rows)aggregated.set(line.inventory_item_id,Math.round(((aggregated.get(line.inventory_item_id)||0)+Number(line.amount))*1000)/1000);
  for(const [ingredientId,amount] of [...aggregated].sort((a,b)=>a[0].localeCompare(b[0]))){
   const r=await c.query("SELECT name,quantity FROM inventory_items WHERE id=$1 AND active=true FOR UPDATE",[ingredientId]);
   if(!r.rowCount)throw bad('Nguyên liệu trong công thức đã bị vô hiệu hóa.',409);
   if(Number(r.rows[0].quantity)+0.000001<amount)throw bad('Không đủ nguyên liệu '+r.rows[0].name+' để nhận đơn.',409);
   await c.query("UPDATE inventory_items SET quantity=quantity-$2 WHERE id=$1",[ingredientId,amount]);
  }
  // Write all per-dish stock movements in one round trip after each ingredient is locked/updated.
  // The enclosing order transaction still rolls back every change on failure.
  if(recipe.rows.length){
   const ids=recipe.rows.map(()=>id());
   const ingredients=recipe.rows.map(line=>line.inventory_item_id);
   const amounts=recipe.rows.map(line=>line.amount);
   const orderLines=recipe.rows.map(line=>line.line_id);
   await c.query("INSERT INTO inventory_movements(id,inventory_item_id,delta,kind,unit_cost,note,order_line_id) SELECT m.id,m.inventory_item_id,-(m.amount::numeric(14,3)),'consume',i.avg_unit_cost,'Trừ theo đơn hàng',m.line_id FROM UNNEST($1::uuid[],$2::uuid[],$3::numeric[],$4::uuid[]) AS m(id,inventory_item_id,amount,line_id) JOIN inventory_items i ON i.id=m.inventory_item_id",[ids,ingredients,amounts,orderLines]);
  }
 }
 async function restore(c,lineId,previousStatus){
  if(previousStatus!=='new')return;
  const rows=(await c.query("SELECT inventory_item_id,-delta AS amount,unit_cost FROM inventory_movements WHERE order_line_id=$1 AND kind='consume' ORDER BY inventory_item_id FOR UPDATE",[lineId])).rows;
  for(const line of rows){
   await c.query("UPDATE inventory_items SET quantity=quantity+$2 WHERE id=$1",[line.inventory_item_id,line.amount]);
   await c.query("INSERT INTO inventory_movements(id,inventory_item_id,delta,kind,unit_cost,note,order_line_id) VALUES($1,$2,$3,'restore',$4,'Khôi phục do hủy món chưa làm',$5)",[id(),line.inventory_item_id,line.amount,line.unit_cost,lineId]);
  }
 }
 return {overview,inventoryDashboard,updateReorderLevel,createItem,setRecipe,entry,move,consume,restore};
};
