'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'../public',p),'utf8');
test('customer management is a standalone admin page, not mixed with menu and QR tabs',()=>{
 const core=read('core.html'),customer=read('customers.html'),side=read('pos-sidebar.js');
 assert(core.includes('data-tab="menu"')&&core.includes('data-tab="tables"'));
 assert(!core.includes('data-tab="customers"'));
 assert(!core.includes('id="customerForm"'));
 assert(!core.includes('id="customerRows"'));
 assert(customer.includes('<h1>Khách hàng</h1>'));
 assert(customer.includes('id="customerForm"')&&customer.includes('id="customerRows"'));
 assert(!customer.includes('data-tab="menu"')&&!customer.includes('data-tab="tables"'));
 assert(side.includes("link('/admin/customers','Khách hàng','person')"));
 assert(!side.includes("/admin/core#customers"));
});
test('customers reuse protected owner API and never expose PII in QR public routes',()=>{
 const js=read('customers.js'),server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const staticFile=fs.readFileSync(path.join(__dirname,'../static-files.js'),'utf8');
 assert(js.includes("'/api/management/core/customers'"));
 assert(js.includes("me?.role!=='admin'"));
 assert(js.includes("method:id?'PATCH':'POST'"));
 assert(js.includes('encodeURIComponent(id)'));
 assert(server.includes("if(p.startsWith('/api/admin/core/'))"));
 assert(server.includes('if(!await requireAdmin(req,res))return;'));
 assert(staticFile.includes("['/admin/customers', 'customers.html']"));
 for(const file of ['core.js','customers.js','pos-sidebar.js'])assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file}));
});
test('customer screen remains mobile-first with accessible buttons and no menu/QR panels',()=>{
 const html=read('customers.html'),css=read('customers.css');
 for(const id of ['customerAdd','customerForm','customerSearch','customerRows','customerEditor','customerClose','customerSave'])assert(html.includes('id="'+id+'"'),id);
 assert(css.includes('@media(max-width:760px)'));
 assert(css.includes('.customer-table tr{display:grid'));
 assert(css.includes('.customer-editor[hidden]'));
 assert(!html.includes('Tạo bàn + QR bảo mật'));
});
