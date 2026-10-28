'use strict';
// Companion to React components: zero-build guest implementation for the existing Render/Node.js host.
// The public API and KDS contract are intentionally unchanged.
const $ = (q) => document.querySelector(q);
const money = (v) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v);
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tableToken = location.pathname.match(/^\/t\/([0-9a-f]{48})$/)?.[1] || null;
const cart = new Map();
const itemNotes = new Map(); // one note per dish, persisted on the order line
let products = [], table = null, mode = 'pilot', sending = false, confirmed = false;
let pendingPayload = null; // keep snapshot and requestId on ambiguous errors
let currentView = 'menu';
const note = $('#note');
const submit = $('#submit');
let selectedPaymentMethod = 'cash';
let bankRecipient = null;
const paymentOptions = document.querySelectorAll('input[name="paymentMethod"]');
function syncPaymentMethod() {
  paymentOptions.forEach(input => {
    input.checked = input.value === selectedPaymentMethod;
    input.disabled = sending || Boolean(pendingPayload) || confirmed;
  });
  $('#paymentMethodHint').textContent = selectedPaymentMethod === 'bank_transfer'
    ? 'Chọn chuyển khoản: QR được điền sẵn số tiền. Đơn chỉ được xác nhận thanh toán khi tiền thực sự về ngân hàng.'
    : 'Bạn sẽ thanh toán tiền mặt với nhân viên. Đơn sẽ được ghi nhận trước khi thanh toán.';
  updateTransferPreview();
}
paymentOptions.forEach(input => input.addEventListener('change', () => {
  if (sending || pendingPayload || confirmed) return;
  if(input.checked && ['cash','bank_transfer'].includes(input.value)) selectedPaymentMethod = input.value;
  syncPaymentMethod();
}));

function transferUrl(recipient,amount,reference){
 if(!recipient||!/^\d{6}$/.test(recipient.bankBin)||!/^\d{6,25}$/.test(recipient.accountNumber)||
    !Number.isSafeInteger(amount)||amount<=0||amount>999999999999)return null;
 const q=new URLSearchParams({amount:String(amount),addInfo:reference||'TAM TRANG 6',accountName:recipient.accountName});
 return 'https://img.vietqr.io/image/'+recipient.bankBin+'-'+recipient.accountNumber+'-compact2.png?'+q.toString();
}
function updateTransferPreview(){
 const show=selectedPaymentMethod==='bank_transfer';
 hidden('#transferPreview',!show);
 if(!show)return;
 const amount=totalStats().subtotal;
 const status=$('#transferPreviewStatus'),content=$('#transferPreviewContent');
 const url=bankRecipient?transferUrl(bankRecipient,amount,'TT6 TAM TINH'):null;
 if(!url){
   hidden('#transferPreviewContent',true);
   status.textContent=!bankRecipient?'Cửa hàng chưa cấu hình tài khoản nhận chuyển khoản. Vui lòng chọn tiền mặt hoặc liên hệ nhân viên.':'Hãy thêm món để tạo QR theo số tiền cần thanh toán.';
   return;
 }
 status.textContent='Quét để xem trước số tiền. QR hóa đơn sẽ có mã tham chiếu riêng sau khi đặt món.';
 hidden('#transferPreviewContent',false);
 $('#transferPreviewQr').src=url;
 $('#transferPreviewAmount').textContent=money(amount);
 $('#transferPreviewRecipient').textContent='Người nhận: '+bankRecipient.accountName;
 $('#transferPreviewAccount').textContent='STK: '+bankRecipient.accountNumber+' · BIN: '+bankRecipient.bankBin;
}

const newUUID = () => crypto.randomUUID();
const pendingKey = tableToken ? `saleshub:pending-order:${tableToken}` : null;
const recentKey = tableToken ? `saleshub:recent-order:${tableToken}` : null;
let recentOrderId = null;

const savedOrdersKey = tableToken ? 'saleshub:orders:v1:' + tableToken : null;
let savedOrderIds = [], savedOrderDetails = new Map(), receiptErrors = new Map();
const expandedOrderIds = new Set();
let refreshingOrders = false;
const isUUID = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
function restoreSavedOrderIds() {
  try {
    const fromStore = savedOrdersKey ? JSON.parse(localStorage.getItem(savedOrdersKey)||'[]') : [];
    savedOrderIds = Array.isArray(fromStore) ? fromStore.filter(isUUID).slice(0,8) : [];
  } catch (_) { savedOrderIds = []; }
  try {
    const earlier = recentKey && sessionStorage.getItem(recentKey);
    if (isUUID(earlier) && !savedOrderIds.includes(earlier)) savedOrderIds.unshift(earlier);
  } catch (_) {}
  savedOrderIds = [...new Set(savedOrderIds)].slice(0,8);
  $('#ordersCountBadge').textContent = String(savedOrderIds.length);
}
function rememberOrderId(orderId) {
  if (!isUUID(orderId)) return;
  savedOrderIds = [orderId,...savedOrderIds.filter(id=>id!==orderId)].slice(0,8);
  $('#ordersCountBadge').textContent = String(savedOrderIds.length);
  try { if(savedOrdersKey) localStorage.setItem(savedOrdersKey,JSON.stringify(savedOrderIds)); } catch (_) {}
  recentOrderId=orderId;
  try { if(recentKey) sessionStorage.setItem(recentKey,orderId); } catch (_) {}
}
const lineState = {new:['Chờ bếp xử lý','pending'],preparing:['Đang chế biến','working'],
 ready:['Món đã sẵn sàng','ready'],served:['Đã phục vụ','served'],cancelled:['Đã hủy','cancelled']};
function transferReceipt(d){
 if(d.payment_method!=='bank_transfer'||d.payment_status==='paid'||d.payment_status==='refunded')return '';
 const p=d.payment_transfer;
 if(!p?.qrUrl||!/^https:\/\/img\.vietqr\.io\/image\/[0-9]{6}-[0-9]{6,25}-compact2\.png\?/.test(p.qrUrl)){
   return '<div class="qr-bill-transfer-notice">Cửa hàng chưa cấu hình QR nhận tiền. Vui lòng nhờ nhân viên cung cấp thông tin chuyển khoản chính thức.</div>';
 }
 return '<section class="qr-bill-transfer"><strong>Quét QR để chuyển khoản</strong>'+
   '<img src="'+escapeHTML(p.qrUrl)+'" alt="QR VietQR chuyển khoản đúng số tiền hóa đơn" loading="lazy" referrerpolicy="no-referrer">'+
   '<p><strong>'+money(Number(p.amount))+'</strong></p>'+
   '<small>Người nhận: '+escapeHTML(p.recipient.accountName)+' · STK '+escapeHTML(p.recipient.accountNumber)+'</small>'+
   '<small>Nội dung: '+escapeHTML(p.reference)+'</small>'+
   '<p class="qr-bill-warning">Quét QR không có nghĩa đơn đã thanh toán. Nhân viên sẽ xác nhận sau khi tiền về tài khoản.</p></section>';
}
function receiptCard(d) {
 const safe=escapeHTML,items=Array.isArray(d.items)?d.items:[];
 const subtotal=items.reduce((sum,item)=>sum+(item.status==='cancelled'?0:Number(item.unit_price||0)*Number(item.quantity||0)),0);
 const total=Number.isFinite(Number(d.total_vnd))?Number(d.total_vnd):subtotal;
 const date=d.created_at?new Date(d.created_at).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'}):'Chưa rõ thời gian';
 const done=items.length>0&&items.every(i=>['ready','served'].includes(i.status));
 const summary=done?'Các món đã sẵn sàng':items.some(i=>i.status==='preparing')?'Bếp đang chế biến':'Đang chờ bếp';
 const open=expandedOrderIds.has(d.id)?' open':'';
 return '<details class="qr-receipt-card qr-bill-card" data-order-id="'+safe(d.id)+'"'+open+'>'+
   '<summary class="qr-receipt-header qr-bill-summary"><div><strong>Đơn #'+safe(d.id.slice(0,8))+'</strong><small>'+safe(date)+' · '+safe(d.table_name||'')+'</small>'+
   '<small class="qr-bill-tap">Chạm để xem món, ghi chú và thanh toán</small></div>'+
   '<div class="qr-bill-summary-right"><span class="qr-receipt-badge">'+safe(summary)+'</span><b>'+money(total)+'</b><span aria-hidden="true" class="qr-bill-chevron">⌄</span></div></summary>'+
   '<div class="qr-bill-body"><p class="qr-receipt-id">Mã đơn: '+safe(d.id)+'</p>'+
   '<div class="qr-receipt-items">'+items.map(i=>{
     const state=lineState[i.status]||[i.status||'Không rõ','pending'];
     const price=Number(i.unit_price||0),qty=Number(i.quantity||0);
     return '<div class="qr-receipt-item"><div class="qr-receipt-item-title"><strong>'+safe(i.name)+'</strong><span class="qr-receipt-status '+safe(state[1])+'">'+safe(state[0])+'</span></div>'+
       '<div class="qr-receipt-line"><span>'+qty+' × '+money(price)+'</span><strong>'+money(qty*price)+'</strong></div>'+
       (i.note?'<small>Ghi chú món: '+safe(i.note)+'</small>':'')+'</div>';
   }).join('')+'</div>'+
   (d.note?'<p class="qr-receipt-note">Ghi chú chung: '+safe(d.note)+'</p>':'')+
   '<div class="qr-receipt-total"><span>Tổng tiền món chưa hủy</span><strong>'+money(total)+'</strong></div>'+
   '<p class="qr-receipt-payment">Phương thức: '+safe(d.payment_method==='cash'?'Tiền mặt':d.payment_method==='bank_transfer'?'Chuyển khoản':'Chưa xác định (đơn cũ)')+'</p>'+
   '<p class="qr-receipt-payment">Thanh toán: '+safe(d.payment_status==='paid'?'Đã thanh toán':d.payment_status==='refunded'?'Đã hoàn tiền':'Chưa xác nhận đã thanh toán')+'</p>'+
   transferReceipt(d)+
   '<small class="qr-receipt-footnote">Giá và ghi chú lấy từ hóa đơn đã lưu trên máy chủ. Chưa xác nhận thanh toán cho đến khi cửa hàng kiểm tra tiền thực nhận.</small></div></details>';
}
function renderSavedOrders() {
  const target=$('#orderList'); if (!target) return;
  $('#ordersCountBadge').textContent=String(savedOrderIds.length);
  target.innerHTML = savedOrderIds.length ? savedOrderIds.map(id => {
    const order=savedOrderDetails.get(id),error=receiptErrors.get(id);
    if (order) return receiptCard(order);
    if (error) return '<article class="qr-receipt-card"><strong>Đơn #'+escapeHTML(id.slice(0,8))+'</strong><p class="qr-error">'+escapeHTML(error)+'</p></article>';
    return '<article class="qr-receipt-card"><strong>Đơn #'+escapeHTML(id.slice(0,8))+'</strong><p>Đang tải thông tin đơn từ máy chủ...</p></article>';
  }).join('') : '<p class="qr-empty">Chưa có đơn nào trên thiết bị này. Bạn có thể chọn món từ thực đơn.</p>';
  target.querySelectorAll('details[data-order-id]').forEach(details=>{
    details.addEventListener('toggle',()=>{
      const id=details.dataset.orderId;
      if(details.open)expandedOrderIds.add(id);else expandedOrderIds.delete(id);
    });
  });
}
async function fetchSavedOrder(id) {
  try {
    const data=await api('/api/order-status/'+encodeURIComponent(id)+'?token='+encodeURIComponent(tableToken));
    if(!data||data.id!==id||!Array.isArray(data.items))throw Error('Máy chủ chưa trả dữ liệu đơn đầy đủ.');
    savedOrderDetails.set(id,data);receiptErrors.delete(id);
  } catch (e) {
    receiptErrors.set(id,'Chưa thể tải lại đơn từ máy chủ: '+e.message+'. Vui lòng hỏi nhân viên nếu cần.');
  }
  if(currentView==='orders') renderSavedOrders();
}
async function refreshSavedOrders(all=false) {
  if(refreshingOrders||!tableToken||!savedOrderIds.length)return;
  refreshingOrders=true;
  try { await Promise.all((all?savedOrderIds:savedOrderIds.slice(0,1)).map(fetchSavedOrder)); }
  finally {refreshingOrders=false;}
}
function startNewOrder() {
  if(sending||pendingPayload)return;
  confirmed=false;showError('');hidden('#confirmation',true);
  cart.clear();itemNotes.clear();note.value='';selectedPaymentMethod='cash';syncPaymentMethod();render();showView('menu');
}

async function verifyRecentOrder() {
  if (!recentOrderId || !tableToken) return;
  const target = $('#recentStatus');
  hidden('#recentStatus', false);
  try {
    const data = await api('/api/order-status/' + encodeURIComponent(recentOrderId) + '?token=' + encodeURIComponent(tableToken));
    const waiting = data.items.filter(i => i.status === 'new').length;
    const preparing = data.items.filter(i => i.status === 'preparing').length;
    const ready = data.items.filter(i => i.status === 'ready' || i.status === 'served').length;
    target.textContent = 'Đơn gần nhất #' + recentOrderId.slice(0,8) + ' · ' +
      waiting + ' món chờ bếp · ' + preparing + ' đang làm · ' + ready + ' sẵn sàng/đã phục vụ. ' +
      (data.persistent ? 'Đã xác minh dữ liệu PostgreSQL.' : 'Dữ liệu thử nghiệm RAM.');
  } catch (error) {
    target.textContent = 'Chưa xác minh được trạng thái đơn gần nhất #' + recentOrderId.slice(0,8) +
      '. Không tạo đơn mới để thay thế; hãy nhờ nhân viên kiểm tra. ' + error.message;
  }
}

function savePending() {
  if (!pendingKey) return;
  try { if (pendingPayload) sessionStorage.setItem(pendingKey, JSON.stringify(pendingPayload));
        else sessionStorage.removeItem(pendingKey); } catch (_) { /* session storage may be blocked */ }
}
function restorePending() {
  if (!pendingKey) return false;
  try {
    const raw = sessionStorage.getItem(pendingKey); if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (snapshot.token !== tableToken || !Array.isArray(snapshot.items) || !snapshot.items.length ||
        !/^[0-9a-f-]{36}$/i.test(snapshot.requestId) ||
        snapshot.items.some(it => !products.some(p => p.id === it.id) || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 20)) {
      sessionStorage.removeItem(pendingKey); return false;
    }
    // Keep the method identical on retry; never silently switch from transfer to cash.
    if (snapshot.paymentMethod && !['cash','bank_transfer'].includes(snapshot.paymentMethod)) {
      sessionStorage.removeItem(pendingKey); return false;
    }
    pendingPayload = snapshot;
    if(snapshot.paymentMethod) selectedPaymentMethod = snapshot.paymentMethod;
    syncPaymentMethod();
    cart.clear();itemNotes.clear();snapshot.items.forEach(it => {cart.set(it.id,it.qty);if(it.note)itemNotes.set(it.id,String(it.note).slice(0,160))});
    note.value = snapshot.note || '';
    return true;
  } catch (_) { return false; }
}
function art(p) { return p.station === 'bar' ? '🥤' : /phở|bún/i.test(p.name) ? '🍜' : /cơm/i.test(p.name) ? '🍚' : /khoai/i.test(p.name) ? '🍟' : '🍽️'; }
function hidden(sel, isHidden) { $(sel).classList.toggle('hidden', isHidden); }
function showError(message, retry = false) {
  $('#submitError').textContent = message;
  hidden('#submitError', !message);
  hidden('#retryHint', !retry);
}
async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin', ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (_) { throw Object.assign(new Error('Không kết nối được máy chủ. Thử gửi lại để kiểm tra đơn.'), { ambiguous: true }); }
  let data;
  try { data = await response.json(); } catch (_) { throw Object.assign(new Error('Máy chủ trả lời không hợp lệ.'), { ambiguous: true }); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Không thể thực hiện yêu cầu.'), { status: response.status, ambiguous: response.status >= 500 });
  return data;
}
function totalStats() {
  const byId = new Map(products.map(p => [p.id, p]));
  let count = 0, subtotal = 0;
  for (const [id, qty] of cart) { const p = byId.get(id); if (p) { count += qty; subtotal += p.price * qty; } }
  return {count, subtotal};
}
function availableQty(item){if(!item||item.available_quantity==null)return Infinity;return Math.max(0,Math.floor(Number(item.available_quantity)||0))}
function stockBadge(item){
 const n=availableQty(item);
 if(n===0)return '<span class="qr-stock-pill is-out">'+(item.inventory_configured?'Hết hàng':'Chưa cập nhật kho')+'</span>';
 if(n<=10)return '<span class="qr-stock-pill is-low">Sắp hết · còn '+n+' phần</span>';
 return '<span class="qr-stock-pill is-ready">Còn hàng</span>';
}
function hasUnavailableCart(){return [...cart].some(([id,qty])=>{const p=products.find(x=>x.id===id);return !p||qty>availableQty(p)})}
function changeQuantity(id, delta) {
  if (sending || pendingPayload || confirmed) return;
  const qty = cart.get(id) || 0;
  const item=products.find(p=>p.id===id);if(!item)return;
  const next = Math.max(0, Math.min(20, qty + delta));
  if(delta>0&&next>availableQty(item)){showError('Món '+item.name+' không còn đủ số lượng. Vui lòng giảm số lượng hoặc chọn món khác.');return}
  if (next) cart.set(id, next); else {cart.delete(id);itemNotes.delete(id);}
  showError(''); render();
}
function itemNoteField(p,placement) {
 const saved=escapeHTML(itemNotes.get(p.id)||'');
 return `<label class="qr-dish-note"><span>Ghi chú cho món <small>(không bắt buộc)</small></span><textarea data-item-note="${p.id}" data-placement="${placement}" maxlength="160" rows="2" placeholder="Ví dụ: không hành, ít cay, không đá…">${saved}</textarea></label>`;
}
function quantityUI(p, qty) {
  if (!qty) return availableQty(p)===0?'<span class="qr-sold-out-action">Hết hàng</span>':`<button class="qr-add" data-item="${p.id}" data-delta="1" type="button" aria-label="Thêm ${escapeHTML(p.name)}">+</button>`;
  return `<div class="qr-stepper"><button type="button" data-item="${p.id}" data-delta="-1" aria-label="${qty === 1 ? 'Xóa' : 'Giảm'} ${escapeHTML(p.name)}">${qty === 1 ? '×' : '−'}</button><span>${qty}</span><button type="button" data-item="${p.id}" data-delta="1" aria-label="Thêm ${escapeHTML(p.name)}">+</button></div>`;
}
function wireSteppers() {
  document.querySelectorAll('[data-item][data-delta]').forEach(button => {
    const item=products.find(p=>p.id===button.dataset.item);
    button.disabled = sending || Boolean(pendingPayload) || confirmed || (Number(button.dataset.delta)>0&&(!item||(cart.get(item.id)||0)>=availableQty(item)));
    button.addEventListener('click', () => changeQuantity(button.dataset.item, Number(button.dataset.delta)));
  });
  // The entire menu tile is a real, keyboard-accessible button. The +/- controls
  // are separate siblings, so clicking them never increments twice.
  document.querySelectorAll('#menuList [data-select-item]').forEach(button => {
    const item=products.find(p=>p.id===button.dataset.selectItem);
    button.disabled = sending || Boolean(pendingPayload) || confirmed || !item || (cart.get(item.id)||0)>=availableQty(item);
    button.addEventListener('click', () => changeQuantity(button.dataset.selectItem, 1));
  });
  document.querySelectorAll('[data-item-note]').forEach(field=>{
    field.disabled=sending || Boolean(pendingPayload) || confirmed;
    field.addEventListener('input',()=>{
      if(field.disabled)return;
      const id=field.dataset.itemNote;
      const value=field.value.slice(0,160);
      if(value)itemNotes.set(id,value);else itemNotes.delete(id);
      // Mirror the note in menu and cart without rerendering or losing focus.
      document.querySelectorAll('[data-item-note]').forEach(other=>{
        if(other!==field&&other.dataset.itemNote===id)other.value=value;
      });
    });
  });
}
function render() {
  const {count, subtotal} = totalStats();
  const groups = {};
  for (const p of products) (groups[p.category] ??= []).push(p);
  $('#menuList').innerHTML = Object.entries(groups).map(([category, list]) => `
    <h3 class="qr-category">${escapeHTML(category)}</h3>
    <div class="qr-menu-grid">${list.map(p => `<article class="qr-menu-card${cart.get(p.id) ? ' is-selected' : ''}${availableQty(p)===0?' is-sold-out':''}">
      <button type="button" class="qr-card-hit" data-select-item="${p.id}" aria-label="Chọn ${escapeHTML(p.name)}, thêm một phần vào giỏ hàng" aria-controls="cartList" ${availableQty(p)===0?'disabled':''}></button>
      <div class="qr-menu-head"><div class="qr-food-art" aria-hidden="true">${art(p)}</div><div><h3>${escapeHTML(p.name)}</h3><small>${p.station === 'bar' ? 'Quầy bar' : 'Nhà bếp'}</small></div></div>
      <div class="qr-menu-bottom"><span class="qr-money">${money(p.price)}</span>${quantityUI(p, cart.get(p.id)||0)}</div><div class="qr-stock-indicator">${stockBadge(p)}</div>
      ${cart.get(p.id)?itemNoteField(p,'menu'):''}
    </article>`).join('')}</div>`).join('') || '<p class="qr-empty">Chưa có món trong thực đơn.</p>';
  $('#cartList').innerHTML = [...cart.entries()].map(([id, qty]) => {
    const p = products.find(x => x.id === id);
    return p ? `<article class="qr-cart-card"><div class="qr-cart-main"><div class="qr-food-art" aria-hidden="true">${art(p)}</div><div class="qr-cart-info"><h3>${escapeHTML(p.name)}</h3><small>${escapeHTML(p.category)} · ${p.station === 'bar' ? 'Quầy bar' : 'Nhà bếp'}</small><span class="qr-money">${money(qty*p.price)}</span></div>${quantityUI(p, qty)}</div>${itemNoteField(p,'cart')}</article>` : '';
  }).join('') || '<p class="qr-empty">Giỏ hàng trống. Quay lại thực đơn để chọn món.</p>';
  $('#cartCountBadge').textContent = count;
  $('#cartTitleCount').textContent = `${count} món`;
  $('#subtotal').textContent = money(subtotal);
  $('#total').textContent = money(subtotal);
  $('#viewCartLabel').textContent = `Xem giỏ hàng · ${count} món`;
  submit.disabled = sending || !count || !table || confirmed || hasUnavailableCart();
  note.disabled = sending || Boolean(pendingPayload) || confirmed;
  syncPaymentMethod();
  if (!sending && !confirmed) setOrderButton('idle');
  wireSteppers();
}
function showView(view) {
  currentView = view;
  hidden('#menuPane', view !== 'menu'); hidden('#cartPane', view !== 'cart'); hidden('#ordersPane', view !== 'orders'); hidden('#stickyBottom', view === 'orders');
  hidden('#viewCart', view !== 'menu'); hidden('#orderAction', view !== 'cart');
  if(view==='orders'){renderSavedOrders();void refreshSavedOrders(true);}
  for (const [tabId, value] of [['#menuTab','menu'],['#cartTab','cart'],['#ordersTab','orders']]) {
    $(tabId).classList.toggle('active', value === view);
    $(tabId).setAttribute('aria-selected', value === view ? 'true' : 'false');
  }
  window.scrollTo({top:0,behavior:'instant'});
}
function setOrderButton(state) {
  submit.classList.toggle('placing', state === 'loading' || state === 'check');
  submit.classList.toggle('checked', state === 'check');
  submit.classList.toggle('success', state === 'success');
  submit.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  const check = '<svg class="qr-button-check" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9 17L20 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  $('#submitContent').innerHTML = state === 'check' ? check :
    state === 'success' ? '<span class="qr-button-success-text">✓ Gọi món thành công</span>' :
    '<span id="submitLabel">Xác nhận gọi món</span><span aria-hidden="true">🔒</span>';
  $('#orderLive').textContent = state === 'loading' ? 'Đang gửi yêu cầu gọi món' :
    state === 'check' || state === 'success' ? 'Gọi món thành công. Đơn đã được máy chủ ghi nhận.' : '';
  submit.setAttribute('aria-label', state === 'check' || state === 'success' ? 'Gọi món thành công' : 'Xác nhận gọi món');
  submit.disabled = state !== 'idle' || sending || !totalStats().count || !table || confirmed || hasUnavailableCart();
}
let successTimers = [];
function finishSuccessAnimation() {
  if(recentOrderId)expandedOrderIds.add(recentOrderId);
  successTimers.forEach(clearTimeout);
  successTimers = [];
  hidden('#orderSuccessOverlay', true);
  renderSavedOrders();
  showView('orders');
}
function playOrderSuccessAnimation(orderId) {
  const overlay = $('#orderSuccessOverlay');
  $('#successOrderId').textContent = '#' + orderId.slice(0, 8);
  $('#successPaymentMethod').textContent = 'Phương thức: ' + (selectedPaymentMethod === 'bank_transfer' ? 'Chuyển khoản' : 'Tiền mặt') + ' · Chưa xác nhận thanh toán';
  overlay.classList.add('hidden');
  setOrderButton('check');
  successTimers.push(setTimeout(() => {
    setOrderButton('success');
  }, 470));
  successTimers.push(setTimeout(() => {
    overlay.classList.remove('hidden');
    $('#viewNewOrder').focus({preventScroll:true});
  }, 820));
  // Chỉ khách bấm "Xem chi tiết đơn hàng" mới chuyển trang. Tuyệt đối không tự đóng thông báo.
}
async function submitOrder() {
  if (sending || confirmed || !table || !totalStats().count) return;
  if(hasUnavailableCart()){showError('Một số món trong giỏ đã hết hàng hoặc vượt tồn kho. Hãy giảm số lượng trước khi đặt.');return}
  if(!pendingPayload&&selectedPaymentMethod==='bank_transfer'&&!bankRecipient){showError('Chưa có tài khoản ngân hàng nhận tiền. Bạn hãy chọn Tiền mặt hoặc liên hệ nhân viên.');return}
  const animationStart = Date.now();
  if (!pendingPayload) pendingPayload = {
    token: tableToken,
    items: [...cart].map(([id, qty]) => ({id, qty,note:(itemNotes.get(id)||'').trim().slice(0,160)})),
    requestId: newUUID(),
    paymentMethod: selectedPaymentMethod,
    note: note.value.trim().slice(0,160),
  };
  savePending();
  sending = true; showError(''); setOrderButton('loading'); render(); setOrderButton('loading');
  try {
    const order = await api('/api/orders', {method:'POST',body:JSON.stringify(pendingPayload)});
    if (!order?.id) throw Object.assign(new Error('Máy chủ chưa trả mã đơn hợp lệ.'), {ambiguous:true});
    confirmed = true;
    rememberOrderId(order.id);
    void verifyRecentOrder();
    $('#confirmationText').textContent = `Mã đơn: #${order.id.slice(0,8)} · ${pendingPayload.items.reduce((n,it)=>n+it.qty,0)} món · ${table.name}.`;
    hidden('#confirmation', false);
    pendingPayload = null; savePending(); cart.clear(); itemNotes.clear(); note.value = '';
    renderSavedOrders();
    // Keep loading visible long enough to perceive the original button-to-spinner morph.
    const remaining = Math.max(0, 500 - (Date.now() - animationStart));
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
    playOrderSuccessAnimation(order.id);
  } catch (error) {
    // 4xx rejects an invalid payload. A network/5xx error is ambiguous: never create a new idempotency key on retry.
    if (!error.ambiguous) { pendingPayload = null; savePending(); }
    if(error.status===409)void refreshMenuAvailability(true);
    showError(error.message || 'Chưa thể gửi đơn.', Boolean(pendingPayload));
  } finally {
    sending = false;
    render();
    if (!confirmed) { hidden('#orderSuccessOverlay', true); setOrderButton('idle'); }
  }
}
let menuRefreshBusy=false;
async function refreshMenuAvailability(force=false){
 if(!tableToken||!table||menuRefreshBusy||sending||pendingPayload||confirmed)return;
 menuRefreshBusy=true;
 try{
  const data=await api('/api/menu/'+tableToken);
  if(!Array.isArray(data.items))return;
  const updated=data.items.filter(p=>p.active!==false);
  const changed=force||updated.length!==products.length||updated.some((p,i)=>{
   const old=products[i];return !old||p.id!==old.id||p.available_quantity!==old.available_quantity||p.inventory_configured!==old.inventory_configured;
  });
  products=updated;
  if(changed&&document.activeElement?.tagName!=='TEXTAREA')render();
 }catch(_){/* The server always checks stock again at order commit. */}
 finally{menuRefreshBusy=false}
}
async function init() {
  if (!tableToken) { $('#notice').textContent = 'QR không hợp lệ. Vui lòng quét lại mã QR được dán tại bàn.'; render(); return; }
  try {
    const data = await api(`/api/menu/${tableToken}`);
    if (!data?.table || !Array.isArray(data.items)) throw Error('Phản hồi thực đơn không hợp lệ.');
    table = data.table; products = data.items.filter(p=>p.active!==false); mode = data.mode;
    try{
      const config=await api('/api/payment/recipient?token='+encodeURIComponent(tableToken));
      bankRecipient=config.configured?config.recipient:null;
    }catch{bankRecipient=null}
    $('#tableName').textContent = `${table.name} · ${table.zone}`;
    $('#tableBadge').textContent = table.name;
    $('#cartTable').textContent = table.name;
    if (mode === 'pilot') {
      $('#notice').textContent = 'BẢN THỬ NGHIỆM: Đơn được lưu RAM và có thể mất khi máy chủ khởi động lại. Không dùng vận hành thực tế.';
    } else {
      $('#notice').classList.add('is-online');
      $('#notice').textContent = 'Đã kết nối thực đơn. Đơn sẽ được lưu và hiển thị trên hệ thống bếp/bar sau khi xác nhận.';
    }
    restoreSavedOrderIds();
    if(savedOrderIds.length) {recentOrderId=savedOrderIds[0];void verifyRecentOrder();}
    const restored = restorePending();
    render();
    if (restored) { showError('Tìm thấy yêu cầu đặt món chưa rõ kết quả từ phiên trước. Hãy kiểm tra rồi nhấn xác nhận để thử lại với cùng mã đơn.', true); showView('cart'); }
    else if(savedOrderIds.length) showView('orders');
  } catch (error) {
    $('#notice').textContent = `Không tải được thực đơn: ${error.message}`;
  }
}
$('#menuTab').addEventListener('click',()=>showView('menu'));
$('#cartTab').addEventListener('click',()=>showView('cart'));
$('#viewCart').addEventListener('click',()=>showView('cart'));
$('#backToMenu').addEventListener('click',()=>showView('menu'));
$('#orderMore').addEventListener('click',startNewOrder);
$('#orderMoreFromReceipt').addEventListener('click',startNewOrder);
$('#ordersTab').addEventListener('click',()=>showView('orders'));
$('#refreshOrders').addEventListener('click',()=>{void refreshSavedOrders(true);});
$('#viewNewOrder').addEventListener('click',finishSuccessAnimation);
submit.addEventListener('click', submitOrder);
setInterval(() => { if (!document.hidden && currentView === 'orders') void refreshSavedOrders(false); }, 12000);
setInterval(() => { if (!document.hidden && (currentView==='menu'||currentView==='cart')) void refreshMenuAvailability(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentView === 'orders') void refreshSavedOrders(false);if(!document.hidden&&(currentView==='menu'||currentView==='cart'))void refreshMenuAvailability(true); });
showView('menu');init();
