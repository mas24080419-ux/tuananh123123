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
 const action=selectable?'<div class="row-actions">'+chooser+'<button type="button" class="mark-paid" data-id="'+esc(r.id)+'" data-method="'+esc(r.payment_method||'')+'">Đã nhận tiền</button></div>':'<span class="mini">Không có thao tác</span>';
 return '<tr><td><strong>#'+esc(r.id.slice(0,8))+'</strong><div class="mini">'+esc(shortDate(r.created_at))+'</div></td>'+
 '<td>'+esc(r.table_name)+'</td><td>'+esc(methodText(r.payment_method))+'</td><td class="tight"><strong>'+cash(amount)+'</strong></td>'+
 '<td>'+status+(r.paid_at?'<div class="mini">Lúc '+esc(shortDate(r.paid_at))+'</div>':'')+'</td><td>'+action+'</td></tr>';
 }).join(''):'<tr><td colspan="6" class="empty">Không có đơn nào trong khoảng ngày đã chọn.</td></tr>';
 $('#orders').querySelectorAll('.mark-paid').forEach(btn=>btn.addEventListener('click',()=>markPaid(btn)));
}
async function markPaid(button){
 const id=button.dataset.id;
 const row=button.closest('tr');
 const paymentMethod=button.dataset.method||row.querySelector('.pick-method')?.value||'';
 if(!['cash','bank_transfer'].includes(paymentMethod)){notice('Hãy chọn Tiền mặt hoặc Chuyển khoản cho đơn cũ trước khi xác nhận.', 'error');return}
 const amount=row.cells[3].textContent;
 const method=methodText(paymentMethod);
 if(!window.confirm('XÁC NHẬN ĐÃ THỰC SỰ NHẬN ĐỦ '+amount+' bằng '+method+' cho đơn #'+id.slice(0,8)+'?'))return;
 button.disabled=true;
 try{
  const result=await request('/api/admin/orders/'+encodeURIComponent(id)+'/confirm-payment',{method:'POST',body:JSON.stringify({confirm:true,paymentMethod})});
  // Refresh the row immediately; do not silently leave a paid order clickable if a separate poll is running.
  const matched=(latest?.orders||[]).find(o=>o.id===id);
  if(matched){matched.payment_status='paid';matched.paid_amount=result.payment.amount;matched.payment_method=paymentMethod;matched.paid_at=new Date().toISOString();applyOrderFilters()}
  await reload(false);
  notice(result.payment.already?'Đơn này đã được ghi nhận thanh toán trước đó.':'Đã xác nhận và ghi sổ '+cash(result.payment.amount)+' cho đơn #'+id.slice(0,8)+'.');
 }catch(e){notice(e.message,'error');button.disabled=false}
}

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
 const data=await request('/api/admin/summary?'+params.toString());
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
