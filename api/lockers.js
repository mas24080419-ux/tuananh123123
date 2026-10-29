'use strict';
const {canAccess}=require('./area-access');
module.exports=({pool,id,serviceCosts})=>{
 const fail=(message,status=400)=>Object.assign(Error(message),{status});
 const validCode=code=>typeof code==='string'&&/^[AB]([1-9]|[12][0-9]|30)$/.test(code);
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 function access(actor){if(!canAccess(actor,'equipment'))throw fail('Chỉ chủ cửa hàng và nhân viên phao / tủ đồ có quyền truy cập.',403);if(!pool)throw fail('Chức năng tủ đồ yêu cầu PostgreSQL.',503)}
 async function list(actor){access(actor);return {rentalFee:30000,lockers:(await pool.query('SELECT l.code,l.zone,l.position,r.id AS rental_id,r.customer_name,r.customer_phone,r.note,r.created_at,r.charged_amount,r.payment_method FROM lockers l LEFT JOIN locker_rentals r ON r.locker_code=l.code AND r.ended_at IS NULL ORDER BY l.zone,l.position')).rows};}
 async function transact(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async function rent(actor,code,b){
  access(actor);
  const amount=30000,paymentMethod=b.paymentMethod;
  if(b.confirmPayment!==true||!['cash','bank_transfer'].includes(paymentMethod))throw fail('Chọn phương thức và xác nhận đã nhận đủ 30.000đ tiền thuê tủ.');
  const name=String(b.customerName||'').trim(),phone=String(b.customerPhone||'').replace(/[\s().-]/g,''),note=String(b.note||'').trim();
  if(!validCode(code)||name.length<2||name.length>90||!/^\+?[0-9]{8,15}$/.test(phone)||note.length>250||!uuid(b.requestId))throw fail('Nhập tên khách (2–90 ký tự) và số điện thoại hợp lệ (8–15 số).');
  return transact(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.requestId]);
   const prev=(await c.query('SELECT id,locker_code,customer_name,customer_phone,note,opened_by,ended_at,payment_method FROM locker_rentals WHERE request_id=$1',[b.requestId])).rows[0];
   if(prev){if(prev.locker_code!==code||prev.customer_name!==name||prev.customer_phone!==phone||prev.note!==note||prev.opened_by!==(actor.userId||null)||prev.payment_method!==paymentMethod)throw fail('Yêu cầu này đã được dùng cho lượt thuê khác.',409);return {id:prev.id,replayed:true,ended:!!prev.ended_at};}
   if(!(await c.query('SELECT code FROM lockers WHERE code=$1 FOR UPDATE',[code])).rowCount)throw fail('Không tìm thấy tủ.',404);
   if((await c.query('SELECT id FROM locker_rentals WHERE locker_code=$1 AND ended_at IS NULL',[code])).rowCount)throw fail('Tủ '+code+' vừa có khách thuê. Chọn một tủ khác.',409);
   const rentalId=id(),financeId=id();
   const income=await c.query("INSERT INTO finance_entries(id,request_id,direction,category,amount,payment_method,note,source) VALUES($1,$2,'income','Thuê tủ đồ',$3,$4,$5,'manual') ON CONFLICT(request_id) DO NOTHING RETURNING id",[financeId,b.requestId,amount,paymentMethod,'Thuê tủ '+code]);
   if(!income.rowCount)throw fail('Mã giao dịch đã được dùng. Tải lại và kiểm tra trước khi ghi tiếp.',409);
   await c.query('INSERT INTO locker_rentals(id,request_id,locker_code,customer_name,customer_phone,note,opened_by,charged_amount,payment_method,finance_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[rentalId,b.requestId,code,name,phone,note,actor.userId||null,amount,paymentMethod,financeId]);
   await c.query("INSERT INTO area_receipts(id,request_id,area,service,quantity,staff_user_id,finance_entry_id) VALUES($1,$2,'equipment','locker',1,$3,$4)",[id(),b.requestId,actor.role==='admin'?null:actor.userId,financeId]);
   await serviceCosts.snapshot(c,{source:'locker',receiptId:rentalId,serviceKey:'locker',quantity:1});
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,$2,'locker_rental',$3,'opened',$4::jsonb)",[id(),actor.userId||'admin',rentalId,JSON.stringify({locker:code,amount,paymentMethod,financeId})]);
   return {id:rentalId,amount};
  });
 }
 async function release(actor,code,b){
  access(actor);if(!validCode(code)||!uuid(b.rentalId)||b.confirm!==true)throw fail('Cần xác nhận khách đã trả tủ.');
  return transact(async c=>{
   await c.query('SELECT code FROM lockers WHERE code=$1 FOR UPDATE',[code]);
   const rental=(await c.query('SELECT id,ended_at FROM locker_rentals WHERE id=$1 AND locker_code=$2 FOR UPDATE',[b.rentalId,code])).rows[0];
   if(!rental)throw fail('Không tìm thấy lượt thuê này. Tải lại sơ đồ tủ.',404);
   if(rental.ended_at)return {id:rental.id,already:true};
   await c.query('UPDATE locker_rentals SET ended_at=now(),closed_by=$2 WHERE id=$1',[rental.id,actor.userId||null]);
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,$2,'locker_rental',$3,'closed',$4::jsonb)",[id(),actor.userId||'admin',rental.id,JSON.stringify({locker:code})]);
   return {id:rental.id};
  });
 }
 async function collect(actor,code,b){
  access(actor);
  if(!validCode(code)||!uuid(b.rentalId)||b.confirmPayment!==true||!['cash','bank_transfer'].includes(b.paymentMethod))throw fail('Xác nhận đã nhận đủ 30.000đ và chọn phương thức thanh toán.');
  return transact(async c=>{
   await c.query('SELECT code FROM lockers WHERE code=$1 FOR UPDATE',[code]);
   const rental=(await c.query('SELECT id,request_id,finance_entry_id,payment_method FROM locker_rentals WHERE id=$1 AND locker_code=$2 FOR UPDATE',[b.rentalId,code])).rows[0];
   if(!rental)throw fail('Không tìm thấy lượt thuê.',404);
   if(rental.finance_entry_id){if(rental.payment_method!==b.paymentMethod)throw fail('Lượt thuê đã ghi thu bằng phương thức khác. Kiểm tra sổ Thu–chi.',409);return {id:rental.id,amount:30000,already:true};}
   const financeId=id();
   const income=await c.query("INSERT INTO finance_entries(id,request_id,direction,category,amount,payment_method,note,source) VALUES($1,$2,'income','Thuê tủ đồ',30000,$3,$4,'manual') ON CONFLICT(request_id) DO NOTHING RETURNING id",[financeId,rental.request_id,b.paymentMethod,'Thuê tủ '+code+' (lượt cũ)']);
   if(!income.rowCount)throw fail('Lượt thuê này đã có mã phiếu thu. Kiểm tra sổ Thu–chi.',409);
   await c.query("INSERT INTO area_receipts(id,request_id,area,service,quantity,staff_user_id,finance_entry_id) VALUES($1,$2,'equipment','locker',1,$3,$4)",[id(),rental.request_id,actor.role==='admin'?null:actor.userId,financeId]);
   await c.query('UPDATE locker_rentals SET charged_amount=30000,payment_method=$2,finance_entry_id=$3 WHERE id=$1',[rental.id,b.paymentMethod,financeId]);
   await serviceCosts.snapshot(c,{source:'locker',receiptId:rental.id,serviceKey:'locker',quantity:1});
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,$2,'locker_rental',$3,'fee_recorded',$4::jsonb)",[id(),actor.userId||'admin',rental.id,JSON.stringify({locker:code,amount:30000,paymentMethod:b.paymentMethod,financeId})]);
   return {id:rental.id,amount:30000};
  });
 }
 return {list,rent,release,collect};
};
