'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const homeFor=require('../role-home');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
test('one login form for owner and employees; no duplicates in role dashboards',()=>{
 const login=read('login.html');
 assert(login.includes('id="loginForm"'));
 assert(login.includes('name="email"'));
 assert(login.includes('Email hoặc tên đăng nhập'));
 assert(login.includes('src="/unified-login.js'));
 for(const page of ['admin.html','orders.html','staff.html'])
  assert(!read(page).includes('id="loginForm"'),page+' should not have a secondary login');
 assert(!login.includes('Tuan123456&'));
});
test('server maps verified role and work-area to the correct app, never a requested role',()=>{
 assert.equal(homeFor(null),'/login');
 assert.equal(homeFor({role:'admin'}),'/admin');
 for(const role of ['waiter','cashier','manager'])assert.equal(homeFor({role}),'/staff/orders');
 assert.equal(homeFor({role:'bar'}),'/staff?kds=1');
 assert.equal(homeFor({role:'kitchen'}),'/staff?kds=1');
 assert.equal(homeFor({role:'waiter',workArea:'equipment'}),'/staff/lockers');
 assert.equal(homeFor({role:'waiter',workArea:'restroom'}),'/staff');
 assert.equal(homeFor({role:'unknown'}),'/login');
});
test('unified auth endpoint chooses account by email; only server may assign role',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const handler=s.slice(s.indexOf("if(req.method==='POST'&&p==='/api/auth/login')"),s.indexOf("if(req.method==='POST'&&p==='/api/admin/login')"));
 assert(handler.includes('ownerAccounts.emailExists(identifier)'));
 assert(handler.includes('ownerAccounts.login(identifier,password)'));
 assert(handler.includes('staffAccounts.login(identifier,password)'));
 assert(handler.includes("home:homeFor(owner)"));
 assert(handler.includes("home:homeFor(employee)"));
 assert(!handler.includes('body.role'));
 assert(s.includes('home:homeFor(a)'));
 const js=read('unified-login.js');
 assert(js.includes("fetch('/api/session/login'"));
 assert(js.includes("fetch('/api/session'"));
 assert(!js.includes('Tuan123456&'));
});

test('login inputs have consistent focus and autofill appearance on Chrome and Edge',()=>{
 const css=read('unified-login.css');
 const html=read('login.html');
 assert(css.includes(':-webkit-autofill'));
 assert(css.includes('input:autofill'));
 assert(css.includes('-webkit-text-fill-color:#163440!important'));
 assert(css.includes('-webkit-box-shadow:0 0 0 1000px #eaf0f6 inset!important'));
 assert(css.includes('.mqn-input input:focus-visible'));
 assert(css.includes('outline:none!important'));
 assert(css.includes('.mqn-input:focus-within'));
 assert(html.includes('/unified-login.css?v=2'));
});
