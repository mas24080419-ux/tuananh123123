'use strict';
let floatCatalog={},floatType='',floatPending=null,floatSaving=false,floatLoading=false;
const vnd=n=>Number(n).toLocaleString('vi-VN')+'đ';
function floatLock(){
 const locked=Boolean(floatPending);
 for(const id of ['floatQuantity','floatPaymentMethod','floatNote','floatMinus','floatPlus'])$('#'+id).disabled=locked;
 $('#floatTypes').querySelectorAll('button').forEach(b=>b.disabled=locked);
}
function equipmentPane(which){
 $('#lockerPane').hidden=which!=='lockers';$('#floatPane').hidden=which!=='floats';
 $('#showLockers').classList.toggle('active',which==='lockers');$('#showFloats').classList.toggle('active',which==='floats');
 $('#showLockers').setAttribute('aria-pressed',String(which==='lockers'));$('#showFloats').setAttribute('aria-pressed',String(which==='floats'));
 if(which==='floats')loadFloats();else load();
}
function floatAmount(){
 const quantity=Number($('#floatQuantity').value),item=floatCatalog[floatType],valid=item&&Number.isInteger(quantity)&&quantity>=1&&quantity<=10000;
 $('#floatTotal').textContent=valid?vnd(item.price*quantity):'—';
 $('#floatCalculation').textContent=item?item.name+' · '+vnd(item.price)+' × '+(quantity||0):'Chọn loại phao';
 $('#floatSubmit').disabled=!valid||floatSaving;
 $('#floatSubmit').textContent=valid?'Đã nhận '+vnd(item.price*quantity)+' — Ghi thu':'Đã nhận tiền — Ghi thu';
}
async function loadFloats(){
 if(!authorized||floatLoading)return;floatLoading=true;
 try{
  const report=await api('/api/area/receipts?area=equipment');floatCatalog=report.floatTypes||{};
  if(!Object.hasOwn(floatCatalog,floatType))floatType=Object.keys(floatCatalog)[0]||'';
  $('#floatTypes').innerHTML=Object.entries(floatCatalog).map(([key,item])=>'<button type="button" data-float-type="'+esc(key)+'" class="float-type'+(key===floatType?' active':'')+'" aria-pressed="'+String(key===floatType)+'"><span class="float-symbol" aria-hidden="true">'+(key==='child_vest'?'♧':key==='black_adult'?'◉':'◎')+'</span><b>'+esc(item.name)+'</b><strong>'+vnd(item.price)+'</strong><small>Mỗi áo / phao · mỗi lượt</small></button>').join('');
  $('#floatTypes').querySelectorAll('[data-float-type]').forEach(b=>b.addEventListener('click',()=>{if(floatSaving)return;floatType=b.dataset.floatType;$('#floatTypes').querySelectorAll('[data-float-type]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});floatAmount()}));
  $('#floatReceipts').innerHTML=report.receipts.slice(0,20).map(r=>{const label=r.float_type?floatCatalog[r.float_type]?.name:(report.serviceNames||{})[r.service];return '<article class="equipment-receipt"><div><b>'+esc(label||'Phiếu thu dịch vụ')+' × '+Number(r.quantity)+'</b><p>'+esc(new Date(r.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}))+' · '+(r.payment_method==='cash'?'Tiền mặt':'Chuyển khoản')+' · '+esc(r.employee)+'</p><p>'+esc(r.note)+'</p></div><strong>'+vnd(r.amount)+'</strong></article>'}).join('')||'<p class="empty-grid">Chưa có phiếu thu hôm nay.</p>';
  floatAmount();floatLock();
 }catch(e){$('#floatFeedback').textContent=e.message;if(e.status===401||e.status===403)load();}finally{floatLoading=false;}
}
$('#showLockers').addEventListener('click',()=>equipmentPane('lockers'));
$('#showFloats').addEventListener('click',()=>equipmentPane('floats'));
$('#floatQuantity').addEventListener('input',floatAmount);
$('#floatMinus').addEventListener('click',()=>{if(floatSaving)return;$('#floatQuantity').value=Math.max(1,(Number($('#floatQuantity').value)||1)-1);floatAmount()});
$('#floatPlus').addEventListener('click',()=>{if(floatSaving)return;$('#floatQuantity').value=Math.min(10000,(Number($('#floatQuantity').value)||0)+1);floatAmount()});
$('#refreshFloatReceipts').addEventListener('click',loadFloats);
$('#floatForm').addEventListener('submit',async e=>{
 e.preventDefault();if(floatSaving||!floatCatalog[floatType])return;
 if(!floatPending)floatPending={service:'float',floatType,quantity:Number($('#floatQuantity').value),paymentMethod:$('#floatPaymentMethod').value,note:$('#floatNote').value,confirmPayment:true,requestId:crypto.randomUUID()};
 floatSaving=true;floatLock();$('#floatSubmit').disabled=true;$('#floatFeedback').textContent='Đang ghi thu…';
 try{const result=await api('/api/area/receipts?area=equipment','POST',floatPending);floatPending=null;$('#floatForm').reset();await loadFloats();$('#floatFeedback').textContent='Đã ghi thu '+vnd(result.amount)+' và cập nhật sổ Thu–chi.';}
 catch(error){if(error.status&&error.status<500)floatPending=null;$('#floatFeedback').textContent=error.message+(floatPending?' Bấm lại sẽ kiểm tra cùng phiếu thu, không ghi thêm phiếu mới.':'');}
 finally{floatSaving=false;floatAmount();floatLock();}
});
