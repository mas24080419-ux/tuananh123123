'use strict';
const {areas,canAccess}=require('./area-access');
module.exports=({pool,id})=>{
 const fail=(s,status=400)=>Object.assign(Error(s),{status});
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 function access(actor,area){if(!canAccess(actor,area))throw fail('Không có quyền thao tác khu vực này.',403);if(!pool)throw fail('Chức năng này yêu cầu PostgreSQL.',503)}
 async function list(actor,area){
  access(actor,area);
  return {area,name:areas[area].name,services:areas[area].services,receipts:(await pool.query("SELECT r.id,r.service,r.quantity,r.created_at,f.amount,f.payment_method,f.note,coalesce(s.display_name,'Chủ cửa hàng') AS employee FROM area_receipts r JOIN finance_entries f ON f.id=r.finance_entry_id LEFT JOIN staff_users s ON s.id=r.staff_user_id WHERE r.area=$1 AND (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY r.created_at DESC LIMIT 100",[area])).rows};
 }
 async function create(actor,area,b){
  access(actor,area);
  const service=b.service,quantity=Number(b.quantity),amount=Number(b.amount),method=b.paymentMethod,note=String(b.note||'').trim();
  if(!Object.hasOwn(areas[area].services,service)||!Number.isInteger(quantity)||quantity<1||quantity>10000||!Number.isSafeInteger(amount)||amount<1||amount>999999999999||!['cash','bank_transfer'].includes(method)||note.length>250||!uuid(b.requestId))throw fail('Kiểm tra dịch vụ, số lượng, tổng tiền và phương thức thanh toán.');
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.requestId]);
   const prior=(await c.query('SELECT r.*,f.amount,f.payment_method,f.note FROM area_receipts r JOIN finance_entries f ON f.id=r.finance_entry_id WHERE r.request_id=$1',[b.requestId])).rows[0];
   if(prior){
    if(prior.area!==area||prior.staff_user_id!==(actor.role==='admin'?null:actor.userId)||prior.service!==service||Number(prior.quantity)!==quantity||Number(prior.amount)!==amount||prior.payment_method!==method||prior.note!==note)throw fail('Mã yêu cầu đã dùng cho giao dịch khác.',409);
    await c.query('COMMIT');return {id:prior.id,replayed:true};
   }
   const financeId=id(),receiptId=id();
   const f=await c.query("INSERT INTO finance_entries(id,request_id,direction,category,amount,payment_method,note,source) VALUES($1,$2,'income',$3,$4,$5,$6,'manual') ON CONFLICT(request_id) DO NOTHING RETURNING id",[financeId,b.requestId,areas[area].services[service],amount,method,note]);
   if(!f.rowCount)throw fail('Mã giao dịch đã tồn tại. Tải lại trang và kiểm tra trước khi ghi tiếp.',409);
   await c.query('INSERT INTO area_receipts(id,request_id,area,service,quantity,staff_user_id,finance_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[receiptId,b.requestId,area,service,quantity,actor.role==='admin'?null:actor.userId,financeId]);
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,$2,'area_receipt',$3,'created',$4::jsonb)",[id(),actor.userId||'admin',receiptId,JSON.stringify({area,service,quantity,amount,paymentMethod:method})]);
   await c.query('COMMIT');return {id:receiptId};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 return {list,create};
};
