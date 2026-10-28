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
 assert(controller.includes("api('suppliers')"));
 assert(controller.includes("api('customers?limit=150')"));
 assert(controller.includes("api('shift')"));
 assert(controller.includes("api('audit?limit=100')"));
});
test('menu, QR, suppliers, customers, shifts and audit screens remain accessible',()=>{
 for(const tab of ['menu','tables','suppliers','customers','shifts','audit']){
  assert(html.includes('data-tab="'+tab+'"'),'missing tab '+tab);
  assert(html.includes('id="'+tab+'"'),'missing section '+tab);
 }
 for(const id of ['menuForm','menuRows','tableForm','tableRows','supplierForm','customerForm','openShiftForm','closeShiftForm','auditRows']){
  assert(html.includes('id="'+id+'"'),'missing form / view '+id);
 }
 for(const anchor of ["'/admin/core#customers'","'/admin/core#suppliers'","'/admin/core#shifts'","'/admin/core#audit'"]){
  assert(navigation.includes(anchor),'missing sidebar link '+anchor);
 }
 assert(controller.includes("window.TT6MenuMobile.render(data.catalog)"));
});
