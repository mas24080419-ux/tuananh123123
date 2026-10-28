'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(__dirname,'../public');
const html=fs.readFileSync(path.join(dir,'core.html'),'utf8');
const controller=fs.readFileSync(path.join(dir,'core.js'),'utf8');
const navigation=fs.readFileSync(path.join(dir,'pos-sidebar.js'),'utf8');

test('booking tab, create form and list are absent on desktop and mobile',()=>{
 for(const value of ['data-tab="reservations"','id="reservations"','id="reservationForm"','id="reservationRows"','id="reservationTable"','Tạo đặt bàn','Xác nhận đặt bàn']){
  assert(!html.includes(value),'Booking UI still visible: '+value);
 }
 for(const value of ["'/admin/core#reservations'","'#reservations'","'Đặt bàn'"]){
  assert(!navigation.includes(value),'Booking remains in navigation: '+value);
 }
});
test('backoffice no longer fetches or renders bookings when the page loads',()=>{
 for(const value of ["api('reservations?","reservationForm","reservationRows","reservationTable","data-res","data.reservations","['reservations','Tạo đặt bàn']"]){
  assert(!controller.includes(value),'Dead booking handler remains: '+value);
 }
 assert(controller.includes("api('catalog')"));
 assert(controller.includes("api('tables')"));
 assert(controller.includes("api('customers?limit=150')"));
 assert(controller.includes("api('shift')"));
 assert(controller.includes("api('audit?limit=100')"));
});
test('menu, QR, customers, shifts and audit screens remain accessible',()=>{
 for(const tab of ['menu','tables','customers','shifts','audit']){
  assert(html.includes('data-tab="'+tab+'"'),'missing tab '+tab);
  assert(html.includes('id="'+tab+'"'),'missing section '+tab);
 }
 for(const id of ['menuForm','menuRows','tableForm','tableRows','customerForm','openShiftForm','closeShiftForm','auditRows']){
  assert(html.includes('id="'+id+'"'),'missing form / view '+id);
 }
 for(const anchor of ["'/admin/core#customers'","'/admin/core#shifts'","'/admin/core#audit'"]){
  assert(navigation.includes(anchor),'missing sidebar link '+anchor);
 }
 assert(controller.includes("window.TT6MenuMobile.render(data.catalog)"));
});

test('supplier management is removed from desktop/mobile nav and backoffice UI',()=>{
 for(const token of ['data-tab="suppliers"','id="suppliers"','id="supplierForm"','id="supplierRows"','Nhà cung cấp']){
  assert(!html.includes(token),'Supplier UI remains in core page: '+token);
 }
 assert(!navigation.includes('/admin/core#suppliers'),'Supplier link remains in shared desktop/mobile sidebar');
 for(const token of ["api('suppliers')","data.suppliers","supplierForm","supplierRows","['suppliers','Thêm nhà cung cấp']", "'suppliers','customers'"]){
  assert(!controller.includes(token),'Supplier page code remains: '+token);
 }
 assert(controller.includes("api('catalog')"),'Catalog must continue to load');
 assert(controller.includes("api('customers?limit=150')"),'Customers must continue to load');
});
