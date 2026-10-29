'use strict';
// Regression gate for scripts loaded by active HTML pages.
// /api/webhooks/sepay* is intentionally an external callback URL displayed to
// the owner. It is not a first-party browser API request and must stay stable.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const publicDir=path.join(__dirname,'../public');
const pages=fs.readdirSync(publicDir).filter(name=>name.endsWith('.html'));
const scripts=new Set();
for(const page of pages){
 const source=fs.readFileSync(path.join(publicDir,page),'utf8');
 for(const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']\/([^"'?]+\.js)(?:\?[^"']*)?["']/g)){
  scripts.add(match[1]);
 }
}
test('every referenced browser script exists and is parseable',()=>{
 assert(scripts.size>0,'No scripts discovered from HTML');
 const {Script}=require('node:vm');
 for(const name of scripts){
  const file=path.join(publicDir,name);
  assert(fs.existsSync(file),name+' referenced but missing');
  assert.doesNotThrow(()=>new Script(fs.readFileSync(file,'utf8'),{filename:name}),name);
 }
});
test('active browser clients no longer use unversioned internal APIs',()=>{
 const legacy=[];
 for(const name of scripts){
  const source=fs.readFileSync(path.join(publicDir,name),'utf8');
  for(const match of source.matchAll(/["'`\x60](\/api\/(?!v1\/)[a-z0-9_/?$+{}.-]+)/gi)){
   const endpoint=match[1];
   if(name==='payment.js'&&/^\/api\/webhooks\/sepay(?:-sandbox)?$/.test(endpoint))continue;
   legacy.push(name+': '+endpoint);
  }
 }
 assert.deepEqual(legacy,[],'A page still references an old internal API route');
});
test('mobile employee presence uses the authorized REST v1 routes',()=>{
 const client=fs.readFileSync(path.join(publicDir,'staff-orders.js'),'utf8');
 const {canonicalize}=require('../rest-v1-routes');
 for(const [newRoute,oldRoute] of [
  ['/api/v1/staff/order-presence','/api/staff/order-presence'],
  ['/api/v1/staff/order-presence/leave','/api/staff/order-presence/leave']
 ]){
  assert(client.includes(newRoute));
  assert.deepEqual(canonicalize(newRoute,'POST'),{path:oldRoute,versioned:true});
 }
});
