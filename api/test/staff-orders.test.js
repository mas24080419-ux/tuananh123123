'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {canManageOrders,canConfirmOrderPayment,canChangeOrderItem}=require('../staff-order-permissions');
const read=p=>readFileSync(path.join(__dirname,'..',p),'utf8');

test('employee access is role-scoped and area staff have no restaurant rights',()=>{
 for(const role of ['waiter','cashier','manager']){
  assert.equal(canManageOrders({role,userId:'test-staff'}),true);
  assert.equal(canManageOrders({role,userId:'test-staff',workArea:'equipment'}),false);
  assert.equal(canManageOrders({role,userId:'test-staff',workArea:'restroom'}),false);
 }
 for(const role of ['kitchen','bar']){
  assert.equal(canManageOrders({role,userId:'test-staff'}),false);
  assert.equal(canConfirmOrderPayment({role,userId:'test-staff'}),false);
 }
 assert.equal(canManageOrders(null),false);
 assert.equal(canManageOrders({role:'waiter'}),false);
 assert.equal(canManageOrders({role:'admin'}),true);
 assert.equal(canConfirmOrderPayment({role:'admin'}),true);
 assert.equal(canConfirmOrderPayment({role:'cashier',userId:'test-staff'}),true);
 assert.equal(canConfirmOrderPayment({role:'manager',userId:'test-staff'}),true);
 assert.equal(canConfirmOrderPayment({role:'waiter',userId:'test-staff'}),false);
});

test('line actions are checked against role, original state and station',()=>{
 const waiter={role:'waiter',userId:'staff-id'};
 assert.equal(canChangeOrderItem(waiter,'ready','served','bar'),true);
 assert.equal(canChangeOrderItem(waiter,'new','cancelled','kitchen'),true);
 assert.equal(canChangeOrderItem(waiter,'preparing','cancelled','kitchen'),false);
 assert.equal(canChangeOrderItem(waiter,'new','preparing','kitchen'),false);
 assert.equal(canChangeOrderItem({...waiter,workArea:'equipment'},'ready','served','bar'),false);
 assert.equal(canChangeOrderItem({role:'bar',userId:'staff-id'},'new','preparing','kitchen'),false);
 assert.equal(canChangeOrderItem({role:'bar',userId:'staff-id'},'new','preparing','bar'),true);
 assert.equal(canChangeOrderItem({role:'manager',userId:'staff-id'},'preparing','cancelled','bar'),true);
});

test('backend endpoints guard roles, reuse inventory transaction and attribute order to staff',()=>{
 const s=read('server.js');
 assert(s.includes("if(p==='/api/staff/orders')"));
 assert(s.includes("if(!canManageOrders(actor))return err(res,403"));
 assert(s.includes("const order=await placeOrder(await input(req),req,actor)"));
 assert(s.includes('ops.consume(c,orderId)'));
 assert(s.includes("orderActor?'staff':'guest'"));
 assert(s.includes("if(!canChangeOrderItem(actor,x.status,status,x.station))"));
 assert(s.includes("if(!canConfirmOrderPayment(actor))return err(res,403"));
 assert(s.includes('requireAdmin(req,res)'));
 assert(s.includes("const canCook=role=>"));
});

test('staff page, links and browser controller parse and expose safe actions',()=>{
 const html=read('public/staff-orders.html');
 const js=read('public/staff-orders.js');
 new vm.Script(js,{filename:'staff-orders.js'});
 assert(html.includes('id="orderForm"')&&html.includes('id="orders"'));
 assert(html.includes('viewport-fit=cover'));
 assert(read('public/staff-orders.css').includes('@media(max-width:520px)'));
 assert(js.includes("api('/api/v1/staff/orders'")&&js.includes("api('/api/v1/staff/menu'"));
 assert(js.includes('state.requestId=body.requestId')&&js.includes('crypto.randomUUID()'));
 assert(js.includes('class="foodPick"')&&js.includes("data-step=\"1\""),'tap target must add one portion');
 assert(js.includes('btn.disabled||state.saving'),'disabled items cannot be selected by tap');
 assert(js.includes('cartTotal<60')&&js.includes('q<n&&q<20'),'preserve stock and quantity guards');
 assert(html.includes('Chạm vào món để thêm vào đơn'),'mobile UI describes tap-to-select');
 assert(html.includes('/staff-orders.js?v=payment-feedback-v3'));
 assert(js.includes('Chỉ Thu ngân / Quản lý xác nhận thu tiền'));
 assert(js.includes('paymentFeedback(o.id'));
 assert(js.includes("o.payment_status='paid'"));
 assert(read('public/orders.js').includes('await reload(false)'));
 assert(read('public/orders.html').includes('/orders.js?v=20261028-owner-payment-v1'));
 assert(!js.includes('/api/admin/finance')&&!js.includes('/api/admin/summary'));
 assert(read('public/staff.js').includes("location.replace('/staff/orders')"));
 assert(read('public/users.html').includes('Phục vụ bàn — tạo & quản lý đơn'));
 assert(read('static-files.js').includes("['/staff/orders', 'staff-orders.html']"));
});
