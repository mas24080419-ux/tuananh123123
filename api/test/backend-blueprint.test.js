'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {schemaModel,getModel}=require('../backend-blueprint');
test('blueprint ERD is parsed from real SQL including ALTER columns and FKs',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
 const model=schemaModel(sql);
 assert(model.tableCount>=21);
 assert(model.relationCount>=15);
 const table=n=>model.tables.find(t=>t.name===n);
 assert(table('dining_orders').columns.some(c=>c.name==='payment_status'));
 assert(table('dining_orders').columns.some(c=>c.name==='payment_method'));
 assert(table('staff_users').columns.some(c=>c.name==='work_area'));
 assert(table('area_receipts').columns.some(c=>c.name==='finance_entry_id'));
 assert(model.relations.some(r=>r.from==='dining_order_lines'&&r.column==='order_id'&&r.to==='dining_orders'));
 assert(model.relations.some(r=>r.from==='inventory_recipes'&&r.to==='menu_items'));
 assert(model.relations.some(r=>r.from==='locker_rentals'&&r.to==='lockers'));
 assert(table('table_reservations').legacy);
 assert(!table('dining_orders').legacy);
});
test('blueprint documents technical layers and 24 order steps with non-invented labels',()=>{
 const {architecture,observability}=getModel();
 assert(architecture.blocks.length>=30);
 assert.equal(architecture.orderSteps.length,24);
 assert(architecture.blocks.some(b=>b.id==='stocklock'&&b.source.includes('FOR UPDATE')));
 assert(architecture.blocks.some(b=>b.id==='sse'));
 assert(architecture.connects.some(e=>e.from==='auditwrite'&&e.to==='commit'));
 assert.match(JSON.stringify(observability),/RAM/);
 assert(!JSON.stringify(architecture).includes('Tuan123456&'));
});
test('blueprint API requires owner authentication',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(s.includes("if(req.method==='GET'&&p==='/api/admin/architecture/blueprint')"));
 assert(s.includes("return send(res,200,require('./backend-blueprint').getModel())"));
 assert(s.includes("if(!await requireAdmin(req,res))return;"));
});
