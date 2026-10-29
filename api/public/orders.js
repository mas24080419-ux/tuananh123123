'use strict';
let latest=null,loading=false;
function renderBarChart(rows){
 const el=$('#dailyChart');el.replaceChildren();
 if(!rows.length){el.innerHTML='<div class="empty">Chưa có khoản thu trong khoảng thời gian này.</div>';return}
 const subset=rows.slice(-20),max=Math.max(...subset.map(r=>Number(r.collected)||0),1);
 for(const r of subset){
  const col=document.createElement('div');col.className='chart-col';
  const bar=document.createElement('div');bar.className='chart-bar';
  bar.style.height=Math.max(2,Math.round(152*Number(r.collected)/max))+'px';
  bar.title=r.day+': '+cash(r.collected);
  const label=document.createElement('span');label.textContent=r.day.slice(5);
  col.append(bar,label);el.append(col);
 }
}
function renderTop(rows){
 const max=Math.max(...rows.map(r=>Number(r.quantity)),1);
 $('#topItems').innerHTML=rows.length?rows.map(r=>'<div class="bar-row"><span>'+esc(r.name)+'<small>'+cash(r.amount)+'</small></span><b>'+Number(r.quantity)+'</b><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(100*Number(r.quantity)/max)+'%"></div></div></div>').join(''):'<div class="empty">Chưa có món nào trong kỳ.</div>';
}
function methodText(method){return method==='cash'?'Tiền mặt':method==='bank_transfer'?'Chuyển khoản':'Đơn cũ: chưa rõ'}
function renderOrders(rows){
 $('#adminOrderCount').textContent=rows.length+' đơn khớp bộ lọc (trong tối đa 100 đơn đã tải).';
 $('#orders').innerHTML=rows.length?rows.map(r=>{
 const amount=Number(r.total_vnd)||0;
 const status=r.payment_status==='paid'?'<span class="pill paid">Đã thu</span>':r.payment_status==='refunded'?'<span class="pill unknown">Đã hoàn tiền</span>':'<span class="pill">Chưa thu</span>';
 const selectable=r.payment_status==='unpaid'&&amount>0;
 const chooser=!r.payment_method?'<select class="pick-method" aria-label="Chọn cách thu tiền cho đơn cũ"><option value="">Chọn cách thu</option><option value="cash">Tiền mặt</option><option value="bank_transfer">Chuyển khoản</option></select>':'';
 const action=selectable?'<div class="row-actions">'+chooser+
  '<button type="button" class="mark-paid" data-id="'+esc(r.id)+'" data-method="'+esc(r.payment_method||'')+'" aria-expanded="false" aria-label="Xác nhận thanh toán cho đơn '+esc(r.id.slice(0,8))+'">Đã nhận tiền</button></div>'+
  '<div class="payment-confirm-panel" hidden><div class="payment-confirm-title">Xác nhận đã nhận tiền</div><p class="payment-confirm-detail" role="status"></p>'+
  '<p class="payment-confirm-explain">Chỉ xác nhận khi đã nhận đủ tiền mặt hoặc kiểm tra giao dịch chuyển khoản thực tế.</p>'+
  '<div class="payment-confirm-actions"><button type="button" class="payment-cancel">Hủy</button><button type="button" class="payment-approve" data-id="'+esc(r.id)+'">Xác nhận đã nhận đủ</button></div>'+
  '<p class="payment-row-feedback" role="status" aria-live="polite" hidden></p></div>':
  '<span class="mini">Không có thao tác</span>';
 return '<tr data-order-id="'+esc(r.id)+'"><td data-label="Đơn hàng"><strong>#'+esc(r.id.slice(0,8))+'</strong><div class="mini">'+esc(shortDate(r.created_at))+'</div></td>'+
 '<td data-label="Bàn">'+esc(r.table_name)+'</td><td data-label="Phương thức">'+esc(methodText(r.payment_method))+'</td><td class="tight" data-label="Số tiền"><strong>'+cash(amount)+'</strong></td>'+
 '<td data-label="Trạng thái">'+status+(r.paid_at?'<div class="mini">Lúc '+esc(shortDate(r.paid_at))+'</div>':'')+'</td><td data-label="Thu tiền">'+action+'</td></tr>';
 }).join(''):'<tr><td colspan="6" class="empty">Không có đơn nào trong khoảng ngày đã chọn.</td></tr>';
}
// An in-page confirmation is reliable in Safari, Chrome and embedded phone browsers.
// It does NOT send a payment request on the first tap.
let paymentPending=false;
function paymentNotice(row,message,isError=false){
 const note=row.querySelector('.payment-row-feedback');
 if(note){note.hidden=false;note.textContent=message;note.classList.toggle('is-error',isError)}
 notice(message,isError?'error':'ok');
}
function paymentDetails(row){
 const button=row.querySelector('.mark-paid');
 const select=row.querySelector('.pick-method');
 const paymentMethod=button?.dataset.method||select?.value||'';
 const order=(latest?.orders||[]).find(o=>o.id===button?.dataset.id);
 return {paymentMethod,order};
}
function openPaymentConfirmation(button){
 if(paymentPending)return;
 const row=button.closest('tr'),{paymentMethod,order}=paymentDetails(row);
 if(!order){paymentNotice(row,'Không tìm thấy đơn trong danh sách. Hãy tải lại.',true);return}
 if(!['cash','bank_transfer'].includes(paymentMethod)){
  paymentNotice(row,'Vui lòng chọn Tiền mặt hoặc Chuyển khoản trước khi xác nhận.',true);
  row.querySelector('.pick-method')?.focus();
  return;
 }
 if(order.payment_status!=='unpaid'||Number(order.total_vnd)<=0){
  paymentNotice(row,'Đơn hàng không đủ điều kiện xác nhận thu tiền. Hãy tải lại.',true);
  return;
 }
 // Keep one expanded confirmation so that tapping any other order can't act on the wrong row.
 $('#orders').querySelectorAll('.payment-confirm-panel').forEach(panel=>{
  if(panel!==row.querySelector('.payment-confirm-panel'))panel.hidden=true;
 });
 $('#orders').querySelectorAll('.mark-paid').forEach(b=>b.setAttribute('aria-expanded',String(b===button)));
 const panel=row.querySelector('.payment-confirm-panel');
 panel.hidden=false;
 panel.querySelector('.payment-confirm-detail').textContent=
  'Đơn #'+order.id.slice(0,8)+' · '+cash(order.total_vnd)+' · '+methodText(paymentMethod);
 const feedback=panel.querySelector('.payment-row-feedback');
 feedback.hidden=true;feedback.textContent='';
 panel.scrollIntoView?.({block:'nearest',behavior:'auto'});
 panel.querySelector('.payment-approve').focus({preventScroll:true});
}
async function submitPayment(button){
 if(paymentPending)return;
 const row=button.closest('tr'),{paymentMethod,order}=paymentDetails(row);
 if(!order||!['cash','bank_transfer'].includes(paymentMethod)||row.querySelector('.payment-confirm-panel')?.hidden){
  paymentNotice(row,'Thông tin xác nhận không hợp lệ. Vui lòng thử lại.',true);return
 }
 paymentPending=true;
 button.disabled=true;button.textContent='Đang lưu…';
 const opener=row.querySelector('.mark-paid');
 if(opener)opener.disabled=true;
 try{
  const result=await request('/api/v1/admin/orders/'+encodeURIComponent(order.id)+'/payment-confirmations',
   {method:'POST',body:JSON.stringify({confirm:true,paymentMethod})});
  const matched=(latest?.orders||[]).find(o=>o.id===order.id);
  if(matched){matched.payment_status='paid';matched.paid_amount=result.payment.amount;matched.payment_method=paymentMethod;matched.paid_at=new Date().toISOString()}
  applyOrderFilters();
  // Refresh is separate; do not overwrite a successful confirmation with a generic notice.
  await reload(false);
  notice(result.payment.already?'Đơn này đã được ghi nhận trước đó.':
   'Đã nhận '+cash(result.payment.amount)+' cho đơn #'+order.id.slice(0,8)+'.','ok');
 }catch(e){
  paymentNotice(row,'Không thể xác nhận đơn #'+order.id.slice(0,8)+': '+e.message,true);
  button.disabled=false;button.textContent='Thử xác nhận lại';
  if(opener)opener.disabled=false;
 }finally{paymentPending=false}
}
// Delegate clicks so cards still work after refresh and mobile layout changes.
$('#orders').addEventListener('click',e=>{
 const pay=e.target.closest('button.mark-paid');
 if(pay){openPaymentConfirmation(pay);return}
 const cancel=e.target.closest('button.payment-cancel');
 if(cancel){
  const row=cancel.closest('tr');row.querySelector('.payment-confirm-panel').hidden=true;
  row.querySelector('.mark-paid')?.setAttribute('aria-expanded','false');
  return
 }
 const approve=e.target.closest('button.payment-approve');
 if(approve){void submitPayment(approve)}
});
// Re-select a method only changes the pre-confirmation summary, never silently confirms.
$('#orders').addEventListener('change',e=>{
 if(!e.target.matches('.pick-method'))return;
 const row=e.target.closest('tr'),panel=row?.querySelector('.payment-confirm-panel');
 if(panel&&!panel.hidden){panel.hidden=true;row.querySelector('.mark-paid')?.setAttribute('aria-expanded','false')}
});

function filteredOrders(){
 if(!latest)return[];
 const q=$('#adminOrderSearch').value.trim().toLocaleLowerCase('vi-VN');
 const status=$('#adminPaymentFilter').value,method=$('#adminMethodFilter').value;
 return (latest.orders||[]).filter(o=>
  (!q||String(o.id||'').toLowerCase().includes(q)||String(o.table_name||'').toLocaleLowerCase('vi-VN').includes(q))&&
  (status==='all'||o.payment_status===status)&&
  (method==='all'||(method==='unknown'?!o.payment_method:o.payment_method===method)));
}
function applyOrderFilters(){renderOrders(filteredOrders())}
function exportOrderRows(){
 const rows=filteredOrders();
 if(!rows.length){notice('Không có đơn hàng phù hợp để xuất.','error');return}
 const columns=['Mã đơn','Thời gian','Bàn','Phương thức','Trạng thái','Tổng tiền','Tiền đã thu'];
 const safe=v=>{
  let text=String(v??'');
  if(/^[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 };
 const records=rows.map(r=>[r.id,r.created_at,r.table_name,methodText(r.payment_method),r.payment_status,r.total_vnd,r.paid_amount||'']);
 const csv='\ufeff'+[columns,...records].map(a=>a.map(safe).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='TamTrang6_DonHang_'+$('#from').value+'_'+$('#to').value+'.csv';
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#adminOrderSearch').addEventListener('input',applyOrderFilters);
$('#adminPaymentFilter').addEventListener('change',applyOrderFilters);
$('#adminMethodFilter').addEventListener('change',applyOrderFilters);
$('#adminExportOrders').addEventListener('click',exportOrderRows);

async function reload(announce=true){
 if(loading)return;
 loading=true;
 try{
 const params=new URLSearchParams({from:$('#from').value,to:$('#to').value});
 const data=await request('/api/v1/admin/summary?'+params.toString());
 latest=data;
 const s=data.summary||{};
 for(const [key,v] of [['#totalOrders',s.order_count],['#orderValue',cash(s.order_value)],['#collected',cash(s.collected)],['#outstanding',cash(s.outstanding)],['#unpaidOrders',s.unpaid_orders],['#paidCash',cash(s.paid_cash)],['#paidTransfer',cash(s.paid_transfer)],['#paidUnknown',cash(s.paid_unknown)],['#paidOrders',s.paid_orders]])text(key,v??'0');
 renderBarChart(data.daily||[]);renderTop(data.top_items||[]);applyOrderFilters();

 if(announce)notice(data.mode==='pilot'?'Đang ở chế độ thử nghiệm: dữ liệu sẽ mất nếu khởi động lại máy chủ.':'Đã đồng bộ với dữ liệu PostgreSQL · '+new Date().toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),'ok');
 }catch(e){notice(e.message,'error');if(e.status===401||e.status===403)screen(false)}
 finally{loading=false}
}
$('#refresh').addEventListener('click',reload);
setupOwnerShared(reload,()=>{latest=null});
