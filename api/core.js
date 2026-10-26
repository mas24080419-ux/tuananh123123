'use strict';
// V10 backoffice domain: persistent Postgres only, no demo writes.
module.exports=function makeCore({pool,id,randomToken}){
 const fail=(message,status=400)=>Object.assign(new Error(message),{status});
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 const key=x=>{if(!uuid(x))throw fail('ID không hợp lệ');return x};
 const value=(v,max=120)=>String(v??'').trim().slice(0,max);
 const money=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>999999999999)throw fail('Giá trị tiền phải là số nguyên VND hợp lệ.');return n};
 const number=(v,min,max,label)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw fail(label+' không hợp lệ');return n};
 async function tx(fn){
  if(!pool)throw fail('Tính năng quản trị cần PostgreSQL, không hỗ trợ lưu RAM.',503);
  const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}
  catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 const check=()=>{if(!pool)throw fail('Cơ sở dữ liệu chưa khả dụng.',503)};
 async function audit(c,entity,entityId,action,oldValue,newValue,actor='admin'){
  await c.query('INSERT INTO pos_audit(id,actor,entity,entity_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
   [id(),actor,entity,entityId,action,oldValue?JSON.stringify(oldValue):null,newValue?JSON.stringify(newValue):null]);
 }
 async function catalog(){
  check();return (await pool.query('SELECT id,name,category,price,station,active,sku,description,created_at FROM menu_items ORDER BY category,name')).rows;
 }
 async function saveMenu(body,menuId){
  const name=value(body.name,100),category=value(body.category,60),description=value(body.description,400);
  const sku=value(body.sku,40)||null,price=money(body.price),station=body.station;
  if(!name||!category||!['kitchen','bar'].includes(station))throw fail('Tên, nhóm món hoặc khu vực chế biến không hợp lệ');
  return tx(async c=>{
   let old=null,r;
   if(menuId){
    old=(await c.query('SELECT * FROM menu_items WHERE id=$1 FOR UPDATE',[key(menuId)])).rows[0];
    if(!old)throw fail('Không tìm thấy món',404);
    r=(await c.query('UPDATE menu_items SET name=$2,category=$3,price=$4,station=$5,sku=$6,description=$7 WHERE id=$1 RETURNING *',
      [menuId,name,category,price,station,sku,description])).rows[0];
   }else{
    r=(await c.query('INSERT INTO menu_items(id,name,category,price,station,sku,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [id(),name,category,price,station,sku,description])).rows[0];
   }
   await audit(c,'menu',r.id,menuId?'updated':'created',old,r);return r;
  });
 }
 async function menuAvailability(menuId,active){
  if(typeof active!=='boolean')throw fail('Trạng thái món phải là true/false');
  return tx(async c=>{
   const old=(await c.query('SELECT * FROM menu_items WHERE id=$1 FOR UPDATE',[key(menuId)])).rows[0];
   if(!old)throw fail('Không tìm thấy món',404);
   const row=(await c.query('UPDATE menu_items SET active=$2 WHERE id=$1 RETURNING *',[menuId,active])).rows[0];
   await audit(c,'menu',menuId,'availability',old,row);return row;
  });
 }
 async function allTables(){check();return (await pool.query('SELECT id,name,zone,capacity,service_status,active,token,created_at FROM dining_tables ORDER BY name')).rows}
 async function createTable(body){
  const name=value(body.name,50),zone=value(body.zone,50)||'Tầng 1',capacity=number(body.capacity??4,1,30,'Sức chứa');
  if(!name)throw fail('Chưa nhập tên bàn');
  return tx(async c=>{
   const row=(await c.query("INSERT INTO dining_tables(id,name,zone,capacity,token) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [id(),name,zone,capacity,randomToken()])).rows[0];
   await audit(c,'table',row.id,'created',null,{name:row.name,zone:row.zone,capacity:row.capacity});return row;
  });
 }
 async function updateTable(tableId,body){
  const updates=[];
  if(body.name!==undefined){const v=value(body.name,50);if(!v)throw fail('Tên bàn không hợp lệ');updates.push(['name',v])}
  if(body.zone!==undefined){const v=value(body.zone,50);if(!v)throw fail('Khu vực không hợp lệ');updates.push(['zone',v])}
  if(body.capacity!==undefined)updates.push(['capacity',number(body.capacity,1,30,'Sức chứa')]);
  if(body.serviceStatus!==undefined){if(!['available','occupied','reserved','cleaning'].includes(body.serviceStatus))throw fail('Trạng thái bàn không hợp lệ');updates.push(['service_status',body.serviceStatus])}
  if(body.active!==undefined){if(typeof body.active!=='boolean')throw fail('Trạng thái QR không hợp lệ');updates.push(['active',body.active])}
  if(!updates.length)throw fail('Chưa có thuộc tính cần cập nhật');
  return tx(async c=>{
   const old=(await c.query('SELECT * FROM dining_tables WHERE id=$1 FOR UPDATE',[key(tableId)])).rows[0];
   if(!old)throw fail('Không tìm thấy bàn',404);
   const params=[tableId,...updates.map(x=>x[1])];
   const assignments=updates.map((pair,i)=>pair[0]+'=$'+(i+2)).join(',');
   const row=(await c.query('UPDATE dining_tables SET '+assignments+' WHERE id=$1 RETURNING *',params)).rows[0];
   await audit(c,'table',tableId,'updated',{name:old.name,zone:old.zone,capacity:old.capacity,active:old.active,service_status:old.service_status},{name:row.name,zone:row.zone,capacity:row.capacity,active:row.active,service_status:row.service_status});return row;
  });
 }
 async function rotateTableToken(tableId){
  return tx(async c=>{
   const old=(await c.query('SELECT id,token FROM dining_tables WHERE id=$1 FOR UPDATE',[key(tableId)])).rows[0];
   if(!old)throw fail('Không tìm thấy bàn',404);
   const row=(await c.query('UPDATE dining_tables SET token=$2 WHERE id=$1 RETURNING id,name,token',[tableId,randomToken()])).rows[0];
   await audit(c,'table',tableId,'qr_rotated',null,{qr_rotated:true});
   return row;
  });
 }
 async function suppliers(){
  check();return (await pool.query("SELECT id,name,phone,email,address,note,active,created_at FROM suppliers ORDER BY name")).rows;
 }
 async function saveSupplier(body,supplierId){
  const name=value(body.name,120),phone=value(body.phone,32),email=value(body.email,120),address=value(body.address,200),note=value(body.note,250);
  if(name.length<2)throw fail('Tên nhà cung cấp quá ngắn');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Email không hợp lệ');
  return tx(async c=>{
   const values=[name,phone,email,address,note];
   let before=null,row;
   if(supplierId){
    before=(await c.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE',[key(supplierId)])).rows[0];
    if(!before)throw fail('Nhà cung cấp không tồn tại',404);
    row=(await c.query('UPDATE suppliers SET name=$2,phone=$3,email=$4,address=$5,note=$6 WHERE id=$1 RETURNING *',[supplierId,...values])).rows[0];
   }else row=(await c.query('INSERT INTO suppliers(id,name,phone,email,address,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id(),...values])).rows[0];
   await audit(c,'supplier',row.id,supplierId?'updated':'created',before,row);return row;
  });
 }
 async function customers(limit=100){
  check();return (await pool.query('SELECT id,name,phone,email,note,created_at FROM customers ORDER BY created_at DESC LIMIT $1',[Math.min(500,Math.max(1,Number(limit)||100))])).rows;
 }
 async function saveCustomer(body,customerId){
  const name=value(body.name,100),phone=value(body.phone,25)||null,email=value(body.email,120),note=value(body.note,250);
  if(name.length<2)throw fail('Tên khách hàng không hợp lệ');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Email không hợp lệ');
  return tx(async c=>{
   const args=[name,phone,email,note];
   let before=null,row;
   if(customerId){
    before=(await c.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE',[key(customerId)])).rows[0];if(!before)throw fail('Khách hàng không tồn tại',404);
    row=(await c.query('UPDATE customers SET name=$2,phone=$3,email=$4,note=$5 WHERE id=$1 RETURNING *',[customerId,...args])).rows[0];
   }else row=(await c.query('INSERT INTO customers(id,name,phone,email,note) VALUES($1,$2,$3,$4,$5) RETURNING *',[id(),...args])).rows[0];
   await audit(c,'customer',row.id,customerId?'updated':'created',{id:before?.id}, {id:row.id});return row;
  });
 }
 async function reservations(from,to){
  check();
  return (await pool.query('SELECT r.*,t.name AS table_name FROM table_reservations r JOIN dining_tables t ON t.id=r.table_id WHERE r.reserved_at >= $1::timestamptz AND r.reserved_at < $2::timestamptz ORDER BY r.reserved_at',[from,to])).rows;
 }
 async function makeReservation(body){
  const tableId=key(body.tableId),name=value(body.customerName,100),phone=value(body.customerPhone,25),note=value(body.note,250);
  const guests=number(body.guests,1,30,'Số khách'),duration=number(body.durationMinutes||120,30,480,'Thời lượng');
  const date=new Date(body.reservedAt);
  if(name.length<2||!Number.isFinite(date.getTime())||date.getTime()<Date.now()-300000||date.getTime()>Date.now()+366*86400000)throw fail('Tên khách hoặc ngày đặt bàn không hợp lệ');
  return tx(async c=>{
   const t=(await c.query('SELECT id,capacity,active FROM dining_tables WHERE id=$1 FOR UPDATE',[tableId])).rows[0];
   if(!t||!t.active)throw fail('Bàn không khả dụng',404);
   if(guests>t.capacity)throw fail('Số khách vượt sức chứa của bàn',409);
   const overlap=await c.query("SELECT id FROM table_reservations WHERE table_id=$1 AND status IN ('confirmed','arrived') AND reserved_at < $3::timestamptz AND (reserved_at + duration_minutes * interval '1 minute') > $2::timestamptz LIMIT 1",
     [tableId,date.toISOString(),new Date(date.getTime()+duration*60000).toISOString()]);
   if(overlap.rowCount)throw fail('Bàn đã được đặt trong khoảng thời gian này',409);
   const row=(await c.query("INSERT INTO table_reservations(id,table_id,customer_id,customer_name,customer_phone,guests,reserved_at,duration_minutes,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
     [id(),tableId,body.customerId?key(body.customerId):null,name,phone,guests,date.toISOString(),duration,note])).rows[0];
   await audit(c,'reservation',row.id,'created',null,{tableId,guests,reserved_at:date.toISOString()});return row;
  });
 }
 async function setReservationStatus(reservationId,status){
  const transitions={confirmed:['arrived','cancelled','no_show'],arrived:['completed','cancelled'],cancelled:[],completed:[],no_show:[]};
  if(!Object.hasOwn(transitions,status))throw fail('Trạng thái đặt bàn không hợp lệ');
  return tx(async c=>{
   const old=(await c.query('SELECT * FROM table_reservations WHERE id=$1 FOR UPDATE',[key(reservationId)])).rows[0];
   if(!old)throw fail('Không tìm thấy đặt bàn',404);
   if(!transitions[old.status].includes(status))throw fail('Không thể chuyển trạng thái đặt bàn như vậy',409);
   const row=(await c.query('UPDATE table_reservations SET status=$2 WHERE id=$1 RETURNING *',[reservationId,status])).rows[0];
   await audit(c,'reservation',row.id,'status',{status:old.status},{status:row.status});return row;
  });
 }
 async function currentShift(){check();return (await pool.query("SELECT * FROM register_shifts ORDER BY opened_at DESC LIMIT 1")).rows[0]||null}
 async function openShift(openingCash){
  const amount=money(openingCash);
  return tx(async c=>{
   const exists=await c.query("SELECT id FROM register_shifts WHERE status='open' FOR UPDATE");
   if(exists.rowCount)throw fail('Đã có ca thu ngân đang mở',409);
   const row=(await c.query("INSERT INTO register_shifts(id,opening_cash) VALUES($1,$2) RETURNING *",[id(),amount])).rows[0];
   await audit(c,'shift',row.id,'opened',null,{opening_cash:amount});return row;
  });
 }
 async function closeShift(countedCash,note){
  const counted=money(countedCash);
  return tx(async c=>{
   const shift=(await c.query("SELECT * FROM register_shifts WHERE status='open' FOR UPDATE")).rows[0];
   if(!shift)throw fail('Không có ca nào đang mở',409);
   const period=[shift.opened_at];
   const received=(await c.query("SELECT coalesce(sum(paid_amount),0)::bigint AS total FROM dining_orders WHERE payment_status='paid' AND payment_method='cash' AND paid_at >= $1 AND paid_at <= now()",period)).rows[0];
   const ledger=(await c.query("SELECT coalesce(sum(CASE WHEN direction='income' THEN amount ELSE -amount END),0)::bigint AS total FROM finance_entries WHERE payment_method='cash' AND created_at >= $1 AND created_at <= now()",period)).rows[0];
   const expected=Number(shift.opening_cash)+Number(received.total)+Number(ledger.total);
   if(!Number.isSafeInteger(expected))throw fail('Số tiền dự kiến vượt giới hạn số nguyên',409);
   const row=(await c.query("UPDATE register_shifts SET status='closed',closed_at=now(),closed_by='admin',counted_cash=$2,expected_cash=$3,variance=$4,note=$5 WHERE id=$1 RETURNING *",
       [shift.id,counted,expected,counted-expected,value(note,250)])).rows[0];
   await audit(c,'shift',row.id,'closed',{opening_cash:shift.opening_cash},{counted_cash:counted,expected_cash:expected,variance:counted-expected});
   return row;
  });
 }
 async function recentAudit(limit=100){
  check();return (await pool.query("SELECT id,actor,entity,entity_id,action,created_at FROM pos_audit ORDER BY created_at DESC LIMIT $1",[number(limit,1,200,'Giới hạn')])).rows;
 }
 return {catalog,saveMenu,menuAvailability,allTables,createTable,updateTable,rotateTableToken,suppliers,saveSupplier,customers,saveCustomer,reservations,makeReservation,setReservationStatus,currentShift,openShift,closeShift,recentAudit};
};
