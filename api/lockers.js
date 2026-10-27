'use strict';
const {canAccess}=require('./area-access');
module.exports=({pool,id})=>{
 const fail=(message,status=400)=>Object.assign(Error(message),{status});
 const validCode=code=>typeof code==='string'&&/^[AB]([1-9]|[12][0-9]|30)$/.test(code);
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 function access(actor){if(!canAccess(actor,'equipment'))throw fail('Chỉ chủ cửa hàng và nhân viên phao / tủ đồ có quyền truy cập.',403);if(!pool)throw fail('Chức năng tủ đồ yêu cầu PostgreSQL.',503)}
 async function list(actor){access(actor);return {lockers:(await pool.query('SELECT l.code,l.zone,l.position,r.id AS rental_id,r.customer_name,r.customer_phone,r.note,r.created_at FROM lockers l LEFT JOIN locker_rentals r ON r.locker_code=l.code AND r.ended_at IS NULL ORDER BY l.zone,l.position')).rows};}
 async function transact(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async function rent(actor,code,b){
  access(actor);
  const name=String(b.customerName||'').trim(),phone=String(b.customerPhone||'').replace(/[\s().-]/g,''),note=String(b.note||'').trim();
  if(!validCode(code)||name.length<2||name.length>90||!/^\+?[0-9]{8,15}$/.test(phone)||note.length>250||!uuid(b.requestId))throw fail('Nhập tên khách (2–90 ký tự) và số điện thoại hợp lệ (8–15 số).');
  return transact(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.requestId]);
   const prev=(await c.query('SELECT id,locker_code,customer_name,customer_phone,note,opened_by,ended_at FROM locker_rentals WHERE request_id=$1',[b.requestId])).rows[0];
   if(prev){if(prev.locker_code!==code||prev.customer_name!==name||prev.customer_phone!==phone||prev.note!==note||prev.opened_by!==(actor.userId||null))throw fail('Yêu cầu này đã được dùng cho lượt thuê khác.',409);return {id:prev.id,replayed:true,ended:!!prev.ended_at};}
   if(!(await c.query('SELECT code FROM lockers WHERE code=$1 FOR UPDATE',[code])).rowCount)throw fail('Không tìm thấy tủ.',404);
   if((await c.query('SELECT id FROM locker_rentals WHERE locker_code=$1 AND ended_at IS NULL',[code])).rowCount)throw fail('Tủ '+code+' vừa có khách thuê. Chọn một tủ khác.',409);
   const rentalId=id();
   await c.query('INSERT INTO locker_rentals(id,request_id,locker_code,customer_name,customer_phone,note,opened_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[rentalId,b.requestId,code,name,phone,note,actor.userId||null]);
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,$2,'locker_rental',$3,'opened',$4::jsonb)",[id(),actor.userId||'admin',rentalId,JSON.stringify({locker:code})]);
   return {id:rentalId};
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
 return {list,rent,release};
};
