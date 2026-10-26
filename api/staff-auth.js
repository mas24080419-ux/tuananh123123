'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
module.exports=function staffAccounts({pool,id}){
 const err=(msg,status=400)=>Object.assign(Error(msg),{status});
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 const roles=['manager','cashier','waiter','kitchen','bar'];
 const info=body=>{
  const username=String(body.username||'').trim().toLowerCase(),displayName=String(body.displayName||'').trim().slice(0,90),role=body.role;
  if(!/^[a-z][a-z0-9._-]{2,31}$/.test(username)||displayName.length<2||!roles.includes(role))throw err('Tên đăng nhập, tên hiển thị hoặc vai trò không hợp lệ.');
  return {username,displayName,role};
 };
 const validatePassword=p=>{if(typeof p!=='string'||p.length<12||p.length>128)throw err('Mật khẩu nhân viên phải dài từ 12 đến 128 ký tự.');return p};
 const hash=async(p,salt)=>Buffer.from(await scrypt(p,Buffer.from(salt,'hex'),64)).toString('hex');
 const run=async fn=>{if(!pool)throw err('Quản lý nhân viên yêu cầu PostgreSQL.',503);const c=await pool.connect();try{await c.query('BEGIN');const x=await fn(c);await c.query('COMMIT');return x}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}};
 async function list(){if(!pool)throw err('Yêu cầu PostgreSQL.',503);return (await pool.query('SELECT id,username,display_name,role,active,auth_version,created_at FROM staff_users ORDER BY username')).rows}
 async function create(body){
  const fields=info(body),pw=validatePassword(body.password),salt=crypto.randomBytes(16).toString('hex'),digest=await hash(pw,salt);
  return run(async c=>{
   const r=await c.query('INSERT INTO staff_users(id,username,display_name,role,password_salt,password_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(username) DO NOTHING RETURNING id,username,display_name,role,active',[id(),fields.username,fields.displayName,fields.role,salt,digest]);
   if(!r.rowCount)throw err('Tên đăng nhập đã có.',409);
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,after_state) VALUES($1,'admin','staff_user',$2,'created',$3::jsonb)",[id(),r.rows[0].id,JSON.stringify({username:fields.username,role:fields.role})]);
   return r.rows[0];
  });
 }
 async function modify(userId,b){
  if(!uuid(userId))throw err('Mã nhân viên không hợp lệ.');
  const changes=[];
  if(b.displayName!==undefined){const v=String(b.displayName||'').trim().slice(0,90);if(v.length<2)throw err('Tên nhân viên không hợp lệ.');changes.push(['display_name',v])}
  if(b.role!==undefined){if(!roles.includes(b.role))throw err('Vai trò không hợp lệ.');changes.push(['role',b.role])}
  if(b.active!==undefined){if(typeof b.active!=='boolean')throw err('Trạng thái không hợp lệ.');changes.push(['active',b.active])}
  if(b.password!==undefined){const salt=crypto.randomBytes(16).toString('hex'),digest=await hash(validatePassword(b.password),salt);changes.push(['password_salt',salt],['password_hash',digest])}
  if(!changes.length)throw err('Không có thông tin cập nhật.');
  return run(async c=>{
   const prev=(await c.query('SELECT id,username,role,active,auth_version FROM staff_users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
   if(!prev)throw err('Không tìm thấy nhân viên.',404);
   const assignments=changes.map(([name],i)=>name+'=$'+(i+2)).join(',')+',auth_version=auth_version+1,updated_at=now()';
   const result=await c.query('UPDATE staff_users SET '+assignments+' WHERE id=$1 RETURNING id,username,display_name,role,active,auth_version',[userId,...changes.map(x=>x[1])]);
   const row=result.rows[0];
   await c.query("INSERT INTO pos_audit(id,actor,entity,entity_id,action,before_state,after_state) VALUES($1,'admin','staff_user',$2,'updated',$3::jsonb,$4::jsonb)",[id(),userId,JSON.stringify(prev),JSON.stringify({id:row.id,role:row.role,active:row.active})]);
   return row;
  });
 }
 async function login(username,password){
  if(!pool)throw err('Đăng nhập nhân viên yêu cầu PostgreSQL.',503);
  const input=String(username||'').trim().toLowerCase();
  const r=await pool.query('SELECT id,username,display_name,role,active,auth_version,password_hash,password_salt FROM staff_users WHERE username=$1',[input]);
  const user=r.rows[0];
  const candidate=typeof password==='string'?password:'';
  const salt=user?.password_salt||'00000000000000000000000000000000';
  const calculated=Buffer.from(await scrypt(candidate,Buffer.from(salt,'hex'),64));
  const expected=user?Buffer.from(user.password_hash,'hex'):Buffer.alloc(64);
  const match=expected.length===calculated.length&&crypto.timingSafeEqual(calculated,expected);
  if(!user||!user.active||!match)throw err('Thông tin đăng nhập không chính xác.',401);
  return {id:user.id,username:user.username,displayName:user.display_name,role:user.role,version:user.auth_version};
 }
 async function activeUser(userId,role,version){
  if(!pool||!uuid(userId))return null;
  const r=await pool.query('SELECT id,username,display_name,role,active,auth_version FROM staff_users WHERE id=$1',[userId]);
  const user=r.rows[0];
  if(!user||!user.active||user.role!==role||Number(user.auth_version)!==Number(version))return null;
  return {id:user.id,username:user.username,displayName:user.display_name,role:user.role};
 }
 return {list,create,modify,login,activeUser};
};
