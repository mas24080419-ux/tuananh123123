'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');

test('QR guest layout uses compact restaurant search, real table state and category filters',()=>{
 const html=read('guest.html');
 const js=read('guest.js');
 const css=read('guest-order-v2.css');
 for(const element of ['guestSmartSearch','guestCategoryNav','menuSectionTitle','menuSectionCaption','menuList',
  'quickOrders','quickOrdersCount','cartPane','ordersPane','submit','orderList','tableBadge']) {
  assert.match(html,new RegExp('id="'+element+'"'),element);
 }
 assert.match(html,/guest-order-v2\.css/);
 assert.match(html,/smart-search\.js/);
 assert(html.indexOf('/smart-search.js')<html.indexOf('/guest.js'),'search module should initialize first');
 assert.match(js,/selectedCategory = 'all'/);
 assert.match(js,/renderGuestCategories\(\)/);
 assert.match(js,/guestSearch\.getResults\(\)\.filter/);
 assert.match(js,/guestSearch\.setItems\(products\)/);
 assert.match(js,/availableQty\(item\)/);
 assert.match(js,/hasUnavailableCart\(\)/);
 assert.match(js,/pendingPayload/);
 assert.match(js,/savedOrderIds/);
 assert.match(js,/fetchSavedOrder/);
 assert.match(js,/function submitOrder\(/);
 assert.match(css,/\.qr-menu-topline/);
 assert.match(css,/\.qr-sticky-bottom/);
 assert.match(css,/\.qr-category-nav/);
 assert(!js.includes('INITIAL_PLACED_ORDERS'),'must not inject fake historical orders from design demo');
 assert(!js.includes('onAdvanceOrderStatus'),'guest cannot advance kitchen status');
});
test('new QR category and order affordances have real callbacks',()=>{
 const js=read('guest.js');
 assert(js.includes("$('#guestCategoryNav').addEventListener('click'"));
 assert(js.includes("$('#quickOrders').addEventListener('click'"));
 assert(js.includes("changeQuantity(button.dataset.selectItem, 1)"));
 assert(js.includes("$('#viewCart').addEventListener('click'"));
 assert(js.includes("$('#ordersTab').addEventListener('click'"));
 assert(js.includes("submit.addEventListener('click', submitOrder)"));
});
test('compact search hides only the guest suggestions, preserving admin suggestions',()=>{
 const js=read('smart-search.js');
 const css=read('guest-order-v2.css');
 assert(js.includes("if (options.compact) root.classList.add('tt6-smart-search-compact')"));
 assert(css.includes('.guest-orange .tt6-smart-search-compact .tt6-search-body'));
 assert(!css.includes('#adminSmartSearch'));
});
