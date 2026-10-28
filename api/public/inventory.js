'use strict';
// Source design: user-provided Premium Low Stock Alert HTML/CSS and React JSX.
// Runtime stays vanilla JS to preserve the existing zero-build SalesHub backend.
const $=selector=>document.querySelector(selector);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const toNumber=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
const showQty=value=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(toNumber(value));
let stockData=null,stockFilter='all',selectedId=null,loading=false,saving=false,synced=false,pendingMovement=null;
const activeModal=()=>document.querySelector('dialog[open]');
const getItem=id=>stockData?.items?.find(item=>item.id===id);
const stockStatus=item=>{
 const qty=toNumber(item.quantity),level=toNumber(item.reorder_level);
 return qty<=0||(level>0&&qty<=level*.25)?'critical':qty<=level?'low':'healthy';
};
const stockLabel=status=>status==='critical'?'Nguy cấp':status==='low'?'Sắp hết':'Đủ hàng';
const stockIcon=(name,extra='')=>'<svg class="stock-ui-icon'+(extra?' '+extra:'')+'" aria-hidden="true" focusable="false"><use href="#stock-icon-'+name+'"></use></svg>';
const statusIcon=status=>status==='critical'?'triangle-alert':status==='low'?'package-open':'package';
async function request(url,options={}){
 let r;try{r=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}})}
 catch{const e=Error('Không kết nối được máy chủ. Kiểm tra kết nối trước khi thao tác lại.');e.ambiguous=true;throw e}
 let data;try{data=await r.json()}catch{const e=Error('Máy chủ trả về dữ liệu không hợp lệ. Hãy kiểm tra lại trạng thái giao dịch.');e.ambiguous=true;throw e}
 if(!r.ok){const e=Error(data.error||'Không thể xử lý yêu cầu.');e.status=r.status;throw e}
 return data;
}
function showError(message){
 $('#stockError').hidden=!message;$('#stockError').textContent=message;
}
function setReady(allowed){
 $('#stockContent').hidden=!allowed;$('#accessGate').hidden=allowed;
}
function renderAlert(item,i){
 const status=stockStatus(item),qty=toNumber(item.quantity),level=toNumber(item.reorder_level);
 const progress=level>0?Math.max(0,Math.min(100,Math.round(qty/level*100))):0;
 return '<button type="button" class="stock-alert-item" data-move="'+escapeHTML(item.id)+'" title="Cập nhật số lượng '+escapeHTML(item.name)+'">'+
 '<span class="stock-alert-symbol '+status+'" aria-hidden="true"><span class="stock-alert-index">'+String(i+1).padStart(2,'0')+'</span>'+stockIcon(statusIcon(status))+'</span>'+
 '<span class="stock-alert-details"><span class="stock-alert-title"><b>'+escapeHTML(item.name)+'</b><span class="stock-status '+status+'">'+stockLabel(status)+'</span></span>'+
 '<span class="stock-alert-sub">Ngưỡng nhập thêm: '+showQty(level)+' '+escapeHTML(item.unit)+'</span>'+
 '<span class="stock-progress-row"><span class="stock-progress-track"><span class="stock-progress-fill '+status+'" style="display:block;width:'+progress+'%"></span></span>'+
 '<span class="stock-progress-label">'+showQty(qty)+'/'+showQty(level)+'</span></span></span>'+
 '<span class="stock-alert-quantity '+status+'"><strong>'+showQty(qty)+'</strong><small>'+escapeHTML(item.unit)+'</small></span><span class="stock-alert-chevron" aria-hidden="true">'+stockIcon('chevron-right')+'</span></button>';
}
function renderItem(item){
 const status=stockStatus(item);
 return '<article class="stock-item">'+
 '<span class="stock-item-visual '+status+'" aria-hidden="true">'+stockIcon(statusIcon(status))+'</span>'+
 '<div class="stock-item-center"><div class="stock-item-name">'+escapeHTML(item.name)+'</div>'+
 '<div class="stock-item-meta"><span class="stock-status '+status+'">'+stockLabel(status)+'</span><span>Ngưỡng: '+showQty(item.reorder_level)+' '+escapeHTML(item.unit)+'</span></div></div>'+
 '<div class="stock-item-amount"><strong>'+showQty(item.quantity)+'</strong><small>'+escapeHTML(item.unit)+' còn</small></div>'+
 '<div class="stock-item-actions"><button type="button" class="stock-mini-action primary" data-move="'+escapeHTML(item.id)+'">'+stockIcon('arrow-down-up')+' Nhập / xuất</button>'+
 '<button type="button" class="stock-mini-action" data-reorder="'+escapeHTML(item.id)+'">'+stockIcon('sliders-horizontal')+' Ngưỡng</button></div></article>';
}
function renderMovements(){
 const kinds={purchase:'Nhập hàng',opening:'Tồn đầu kỳ',adjustment_in:'Điều chỉnh tăng',adjustment_out:'Điều chỉnh giảm',consume:'Xuất theo đơn QR',restore:'Hoàn trả hàng'};
 const rows=stockData?.movements||[];
 $('#stockMovementList').innerHTML=rows.map(m=>{
  const delta=toNumber(m.delta),positive=delta>0;
  const date=new Date(m.created_at);
  const time=Number.isFinite(date.getTime())?date.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'—';
  return '<article class="stock-history-row"><span class="stock-history-icon '+(positive?'in':'out')+'" aria-hidden="true">'+stockIcon(positive?'arrow-down-left':'arrow-up-right')+'</span><div class="stock-history-left"><strong>'+escapeHTML(m.item_name)+'</strong><p>'+escapeHTML(kinds[m.kind]||'Cập nhật kho')+' · '+escapeHTML(time)+(m.note?' · '+escapeHTML(m.note):'')+'</p></div><strong class="stock-history-delta '+(positive?'':'out')+'">'+(positive?'+':'−')+showQty(Math.abs(delta))+' '+escapeHTML(m.unit)+'</strong></article>';
 }).join('')||'<p class="stock-empty">Chưa có hoạt động nhập / xuất nào được lưu.</p>';
}
function render(){
 if(!stockData)return;
 const items=stockData.items||[],low=items.filter(x=>toNumber(x.quantity)<=toNumber(x.reorder_level));
 const summary=stockData.summary||{total:items.length,low:low.length,critical:low.filter(x=>stockStatus(x)==='critical').length,healthy:items.length-low.length};
 for(const [selector,value] of [['#stockTotal',summary.total],['#stockLow',summary.low],['#stockCritical',summary.critical],['#stockHealthy',summary.healthy],['#alertNumber',summary.low]])$(selector).textContent=showQty(value);
 $('#alertBadge').textContent=showQty(low.length)+' MỤC';
 const priority={critical:0,low:1,healthy:2};
 low.sort((a,b)=>priority[stockStatus(a)]-priority[stockStatus(b)]||toNumber(a.quantity)/Math.max(toNumber(a.reorder_level),1)-toNumber(b.quantity)/Math.max(toNumber(b.reorder_level),1));
 $('#stockAlertList').innerHTML=low.length?low.map(renderAlert).join(''):'<p class="stock-empty stock-empty-success">'+stockIcon('circle-check')+'<span>Hiện không có nguyên liệu dưới ngưỡng cảnh báo.<br>Tiếp tục theo dõi tồn kho thường xuyên.</span></p>';
 const query=$('#stockSearch').value.trim().toLocaleLowerCase('vi-VN');
 const filtered=items.filter(item=>(stockFilter==='all'||(stockFilter==='low'?toNumber(item.quantity)<=toNumber(item.reorder_level):toNumber(item.quantity)>toNumber(item.reorder_level)))&&(!query||item.name.toLocaleLowerCase('vi-VN').includes(query)));
 $('#stockResultCount').textContent=showQty(filtered.length)+' nguyên liệu · tổng '+showQty(items.length);
 $('#stockItemList').innerHTML=filtered.map(renderItem).join('')||'<p class="stock-empty">'+(items.length?'Không tìm thấy nguyên liệu phù hợp. Thử đổi bộ lọc.':'Kho chưa có nguyên liệu. Chọn “Thêm nguyên liệu” để bắt đầu với dữ liệu thực tế.')+'</p>';
 $('#viewAllAlerts').disabled=!low.length;
 renderMovements();
}
async function loadStock(){
 if(loading)return;loading=true;$('#refreshStock').disabled=true;
 try{
  const response=await request('/api/admin/inventory');
  if(!Array.isArray(response.items)||!Array.isArray(response.movements))throw Error('Danh sách kho không hợp lệ.');
  stockData=response;synced=true;setReady(true);showError('');
  render();
  $('#syncLabel').textContent='Đã đồng bộ · '+new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
 }catch(e){
  synced=false;$('#syncLabel').textContent='Chưa đồng bộ';
  if(e.status===401||e.status===403){setReady(false);$('#accessGate h2').textContent='Phiên đăng nhập hoặc quyền truy cập không hợp lệ.';if(activeModal())activeModal().close();}
  else{showError(e.message);if(stockData)render();}
 }finally{loading=false;$('#refreshStock').disabled=false}
}
function closeDialog(){
 if(saving)return;
 if(pendingMovement&&activeModal()?.id==='movementDialog'){
  feedback('#movementFeedback','Giao dịch vừa gửi chưa được xác nhận. Hãy thử gửi lại cùng mã giao dịch để tránh nhập / xuất trùng.');
  return;
 }
 const d=activeModal();if(d)d.close();
 selectedId=null;
}
function dialog(id){const el=$(id);if(el.showModal)el.showModal();}
function beginMovement(id){
 if(!synced||saving){showError('Vui lòng đồng bộ kho trước khi thao tác.');return}
 const item=getItem(id);if(!item)return;
 selectedId=id;pendingMovement=null;
 $('#movementForm').reset();$('#movementTitle').textContent='Cập nhật '+item.name;
 $('#movementSubtitle').textContent='Tồn hiện tại: '+showQty(item.quantity)+' '+item.unit;
 $('#movementFeedback').textContent='';updateMovementFields();dialog('#movementDialog');
}
function beginThreshold(id){
 if(!synced||saving){showError('Vui lòng đồng bộ kho trước khi thao tác.');return}
 const item=getItem(id);if(!item)return;
 selectedId=id;$('#reorderForm').reset();$('#reorderTitle').textContent='Ngưỡng cảnh báo · '+item.name;
 $('#reorderForm').elements.namedItem('reorderLevel').value=item.reorder_level;
 $('#reorderFeedback').textContent='';dialog('#reorderDialog');
}
function updateMovementFields(){
 const purchase=$('#movementKind').value==='purchase';
 $('#purchaseUnitPriceLabel').hidden=!purchase;$('#purchasePaymentLabel').hidden=!purchase;
 $('#movementAccounting').textContent=purchase?'Nhập mua hàng sẽ tự ghi khoản chi vào Thu–chi sau khi xác nhận đã thanh toán. Không ghi chi lần thứ hai.':'Thao tác này chỉ cập nhật tồn kho, không tự ghi thu–chi. Phải ghi rõ lý do.';
 $('#movementNoteRequired').hidden=purchase;
 $('#movementForm').elements.namedItem('unitCost').required=purchase;
 $('#movementForm').elements.namedItem('note').required=!purchase;
}
function setSaving(form,flag){
 saving=flag;form.querySelector('[type="submit"]').disabled=flag;
 form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=flag);
}
function feedback(id,message){$(id).textContent=message}
document.addEventListener('click',event=>{
 const closer=event.target.closest('[data-close-dialog]');if(closer){closeDialog();return}
 const move=event.target.closest('[data-move]');if(move){beginMovement(move.dataset.move);return}
 const threshold=event.target.closest('[data-reorder]');if(threshold){beginThreshold(threshold.dataset.reorder)}
});
for(const d of document.querySelectorAll('dialog'))d.addEventListener('cancel',event=>{if(saving||(d.id==='movementDialog'&&pendingMovement)){event.preventDefault();if(pendingMovement)feedback('#movementFeedback','Giao dịch chưa xác nhận. Vui lòng thử lại cùng mã trước khi đóng.');}else selectedId=null});
$('#addStockItem').addEventListener('click',()=>{if(!synced)return showError('Chưa đồng bộ kho. Hãy bấm Làm mới.');$('#itemForm').reset();$('#itemFeedback').textContent='';dialog('#itemDialog')});
$('#refreshStock').addEventListener('click',loadStock);
$('#stockSearch').addEventListener('input',render);
document.querySelectorAll('[data-stock-filter]').forEach(button=>button.addEventListener('click',()=>{
 stockFilter=button.dataset.stockFilter;
 document.querySelectorAll('[data-stock-filter]').forEach(x=>{x.classList.toggle('active',x===button);x.setAttribute('aria-pressed',String(x===button))});
 render();
}));
$('#viewAllAlerts').addEventListener('click',()=>{
 if(!synced)return;const filter=$('[data-stock-filter="low"]');filter.click();
 $('#stockManage').scrollIntoView({behavior:'smooth',block:'start'});
});
$('#movementKind').addEventListener('change',()=>{if(!pendingMovement)updateMovementFields()});
$('#itemForm').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||!synced)return;
 const form=event.currentTarget;
 const body=Object.fromEntries(new FormData(form));body.reorderLevel=Number(body.reorderLevel);
 setSaving(form,true);feedback('#itemFeedback','Đang lưu nguyên liệu…');
 let createdId=null;
 try{
  const result=await request('/api/admin/inventory/items',{method:'POST',body:JSON.stringify(body)});
  createdId=result.item?.id||null;$('#itemDialog').close();await loadStock();
 }catch(e){feedback('#itemFeedback',e.message)}
 finally{setSaving(form,false)}
 if(createdId&&synced)beginMovement(createdId);
});
$('#reorderForm').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||!synced||!selectedId)return;
 const form=event.currentTarget,id=selectedId,level=Number(form.elements.namedItem('reorderLevel').value);
 setSaving(form,true);feedback('#reorderFeedback','Đang lưu mức cảnh báo…');
 try{await request('/api/admin/inventory/items/'+encodeURIComponent(id)+'/reorder',{method:'PATCH',body:JSON.stringify({reorderLevel:level})});$('#reorderDialog').close();selectedId=null;await loadStock()}
 catch(e){feedback('#reorderFeedback',e.message)}
 finally{setSaving(form,false)}
});
$('#movementForm').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||!synced||!selectedId)return;
 const form=event.currentTarget,id=selectedId;
 if(!pendingMovement){
  const raw=Object.fromEntries(new FormData(form));
  pendingMovement={inventoryItemId:id,kind:raw.kind,quantity:Number(raw.quantity),note:raw.note||'',requestId:crypto.randomUUID()};
  if(raw.kind==='purchase'){pendingMovement.unitCost=Number(raw.unitCost);pendingMovement.paymentMethod=raw.paymentMethod}
 }
 setSaving(form,true);feedback('#movementFeedback','Đang lưu giao dịch kho…');
 try{
  const result=await request('/api/admin/inventory/movements',{method:'POST',body:JSON.stringify(pendingMovement)});
  pendingMovement=null;$('#movementDialog').close();selectedId=null;
  await loadStock();
  if(result.movement?.duplicate)showError('Giao dịch này đã được ghi nhận trước đó, hệ thống không tạo thêm phiếu mới.');
 }catch(e){
  feedback('#movementFeedback',e.message+(e.ambiguous?' Không thay đổi số lượng và không bấm gửi yêu cầu khác. Bấm lại sẽ dùng cùng mã giao dịch để tránh trùng lặp.':''));
  if(!e.ambiguous&&e.status&&e.status<500)pendingMovement=null;
 }finally{setSaving(form,false)}
});
(async()=>{
 try{const me=await request('/api/me');if(me.role!=='admin')throw Object.assign(Error('Chỉ chủ cửa hàng có quyền xem và điều chỉnh kho.'),{status:403});await loadStock()}
 catch(e){setReady(false);$('#syncLabel').textContent='Chưa xác thực';$('#accessGate h2').textContent=e.status===403?'Tài khoản chưa có quyền quản lý kho':'Cần đăng nhập để tiếp tục';$('#accessGate p').textContent=e.message}
})();
setInterval(()=>{if(synced&&!document.hidden&&!activeModal())loadStock()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!activeModal())loadStock()});
