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

test('QR cards display bundled user-provided product photos and never overwrite live menu pricing',()=>{
 const html=read('guest.html');
 const js=read('guest.js');
 const css=read('guest-order-v2.css');
 const photos=require('../public/qr-menu-photos');
 assert(html.includes('/qr-menu-photos.js'),'bundled photos must load before guest controller');
 assert(html.indexOf('/qr-menu-photos.js') < html.indexOf('/guest.js'));
 for(const name of ['Coca Cola','Pepsi','Bia Tươi Hạ Long / Tiger Bạc',
  'Trà Đào Cam Sả Tươi','Mực Một Nắng Nướng Sa Tế','Tôm Sú Hấp Nước Dừa']) {
  const src=photos.imageFor({name});
  assert(src && src.startsWith('data:image/webp;base64,UklG'), name);
 }
 assert.equal(photos.imageFor({name:'Phở bò đặc biệt'}), null,
  'do not attach incorrect product photos to unrelated menu items');
 assert(js.includes('function menuPhoto(p)'));
 assert(js.includes('window.TT6MenuPhotos?.imageFor(p)'));
 assert(js.includes('menuPhoto(p)'), 'real photo thumbnails must be rendered');
 assert(js.includes('displayVND(p.price)'), 'price must come from the live catalog');
 assert(js.includes('availableQty(item)'), 'stock check must be preserved');
 assert(css.includes('.qr-food-art img'));
 assert(css.includes('object-fit:cover'));
});
test('selected drink category is not duplicated in the menu list',()=>{
 const js=read('guest.js');
 assert(js.includes('selectedCategory !== "all"'), 'hide repeated subgroup heading');
 assert(js.includes("drink.category"), 'select real drink group from live menu');
 assert(js.includes("searching || selectedCategory === 'all'"), 'search globally even with a tab selected');
});
