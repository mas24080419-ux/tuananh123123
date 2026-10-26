'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
module.exports=function ownerAuth({pool}){
 const fail=(text,status=400)=>Object.assign(Error(text),{status});
 const hash=async(password,salt)=>Buffer.from(await scrypt(password,Buffer.from(salt,'hex'),64)).toString('hex');
 const dummySalt='00000000000000000000000000000000';
 const checkPass=async(password,user)=>{
  const salt=user?.password_salt||dummySalt;
  const actual=Buffer.from(await scrypt(String(password||''),Buffer.from(salt,'hex'),64));
  const expected=user?Buffer.from(user.password_hash,'hex'):Buffer.alloc(64);
  return expected.length===actual.length&&crypto.timingSafeEqual(actual,expected);
 };
 async function exists(){
  if(!pool)return false;
  return (await pool.query('SELECT EXISTS(SELECT 1 FROM owner_accounts) AS configured')).rows[0].configured;
 }
 async function login(email,password){
  if(!pool)throw fail('Đăng nhập email yêu cầu PostgreSQL.',503);
  const normalized=String(email||'').trim().toLowerCase();
  const user=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)?
    (await pool.query('SELECT id,email,password_salt,password_hash,active,auth_version FROM owner_accounts WHERE email=$1',[normalized])).rows[0]:null;
  const match=await checkPass(password,user);
  if(!user||!user.active||!match)throw fail('Email hoặc mật khẩu không chính xác.',401);
  return {id:user.id,email:user.email,version:user.auth_version,role:'admin'};
 }
 async function activate(email,password){
  if(!pool)throw fail('Kích hoạt tài khoản yêu cầu PostgreSQL.',503);
  const normalized=String(email||'').trim().toLowerCase();
  if(normalized!=='mas24080419@hsb.edu.vn')throw fail('Email không thuộc tài khoản quản trị được phép.',403);
  if(typeof password!=='string'||password.length<10||password.length>128||!/[a-z]/i.test(password)||!/\d/.test(password))
   throw fail('Mật khẩu khởi tạo cần ít nhất 10 ký tự, có chữ và số.');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialise all first-owner attempts without locking other POS data.
   await client.query('SELECT pg_advisory_xact_lock(728271199)');
   const count=await client.query('SELECT EXISTS(SELECT 1 FROM owner_accounts) AS exists');
   if(count.rows[0].exists)throw fail('Tài khoản quản trị đã được kích hoạt.',409);
   const id=crypto.randomUUID(),salt=crypto.randomBytes(16).toString('hex'),digest=await hash(password,salt);
   await client.query('INSERT INTO owner_accounts(id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)',[id,normalized,salt,digest]);
   await client.query('COMMIT');
   return {id,email:normalized,version:1,role:'admin'};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }
 async function current(id,version){
  if(!pool||typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return null;
  const u=(await pool.query('SELECT id,email,auth_version,active FROM owner_accounts WHERE id=$1',[id])).rows[0];
  return u&&u.active&&Number(u.auth_version)===Number(version)?{id:u.id,email:u.email,role:'admin'}:null;
 }
 async function changePassword(id,oldPassword,newPassword){
  if(!pool)throw fail('Đổi mật khẩu yêu cầu PostgreSQL.',503);
  if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128||!/[a-z]/i.test(newPassword)||!/\d/.test(newPassword)||!/[^\w\s]/.test(newPassword))
   throw fail('Mật khẩu mới phải từ 12 đến 128 ký tự, gồm chữ, số và ký tự đặc biệt.');
  if(newPassword===oldPassword)throw fail('Mật khẩu mới phải khác mật khẩu hiện tại.');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const user=(await client.query('SELECT id,password_hash,password_salt,auth_version,active FROM owner_accounts WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!user||!user.active||!await checkPass(oldPassword,user))throw fail('Mật khẩu hiện tại không chính xác.',401);
   const salt=crypto.randomBytes(16).toString('hex'),digest=await hash(newPassword,salt);
   const updated=await client.query('UPDATE owner_accounts SET password_salt=$2,password_hash=$3,auth_version=auth_version+1,password_changed_at=now(),updated_at=now() WHERE id=$1 RETURNING id,auth_version',[id,salt,digest]);
   await client.query('COMMIT');
   return {id:updated.rows[0].id,version:updated.rows[0].auth_version};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }
 return {exists,login,current,changePassword,activate};
};
