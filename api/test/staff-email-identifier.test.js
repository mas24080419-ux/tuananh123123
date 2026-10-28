'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const create=require('../staff-auth');
const SALT='00112233445566778899aabbccddeeff';
const PASS='SamplePassword123!';
const HASH=crypto.scryptSync(PASS,Buffer.from(SALT,'hex'),64).toString('hex');
function mock(){
 const saved=[];
 const c={query:async(sql,values)=>{
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO staff_users')){saved.push({username:values[1],salt:values[4],hash:values[5]});return {rows:[{id:values[0],username:values[1],display_name:values[2],role:values[3],work_area:values[6],active:true}],rowCount:1}}
  if(sql.startsWith('INSERT INTO pos_audit'))return {rows:[],rowCount:1};
  throw Error('Unexpected SQL: '+sql);
 },release(){}};
 const pool={connect:async()=>c,query:async(sql,values)=>{
  if(!sql.startsWith('SELECT id,username,display_name,role,work_area,active,auth_version,password_hash,password_salt FROM staff_users WHERE username=$1'))throw Error('Wrong SQL');
  const user=values[0]==='employee@example.com'?{id:'00000000-0000-4000-8000-000000000123',username:values[0],display_name:'Demo employee',role:'waiter',work_area:null,active:true,auth_version:1,password_hash:HASH,password_salt:SALT}:null;
  return {rows:user?[user]:[],rowCount:user?1:0};
 }};
 return {pool,saved};
}
test('employee email signs in case-insensitively, using scrypt verification',async()=>{
 const {pool}=mock(),staff=create({pool,id:()=>crypto.randomUUID()});
 const u=await staff.login(' Employee@Example.com ',PASS);
 assert.equal(u.username,'employee@example.com');assert.equal(u.role,'waiter');
 await assert.rejects(()=>staff.login('employee@example.com','not-the-password'),e=>e.status===401);
});
test('admin can provision an email identifier without storing password plaintext',async()=>{
 const {pool,saved}=mock(),staff=create({pool,id:()=>crypto.randomUUID()});
 const created=await staff.create({username:' Employee@Example.com ',displayName:'Demo employee',role:'waiter',password:PASS});
 assert.equal(created.username,'employee@example.com');assert.equal(saved.length,1);
 assert.equal(saved[0].hash.length,128);assert.notEqual(saved[0].hash,PASS);
 assert.equal(saved[0].salt.length,32);
 await assert.rejects(()=>staff.create({username:'invalid @example.com',displayName:'Demo employee',role:'waiter',password:PASS}),e=>e.status===400);
});
test('employee and admin login UI display email login without exposing test credentials',()=>{
 const base=path.join(__dirname,'../public');
 const html=fs.readFileSync(path.join(base,'staff.html'),'utf8');
 const users=fs.readFileSync(path.join(base,'users.html'),'utf8');
 assert(html.includes('Email hoặc tên đăng nhập'));
 assert(users.includes('Email hoặc tên đăng nhập'));
 assert(!html.includes('Tuan123456&')&&!users.includes('Tuan123456&'));
});
