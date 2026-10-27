'use strict';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lockers=[],zone='A',status='all',selected=null,loading=false,saving=false,pending=null,authorized=false;
async function api(path,method='GET',body){let r;try{r=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})}catch{throw Error('Mất kết nối. Tải lại để kiểm tra trạng thái tủ trước khi thử tiếp.')};let j;try{j=await r.json()}catch{throw Error('Máy chủ chưa phản hồi đầy đủ. Tải lại để kiểm tra trạng thái tủ.')};if(!r.ok){const e=Error(j.error||'Không thể xử lý thao tác.');e.status=r.status;throw e}return j;}
function notice(message,error=false){$('#lockerNotice').hidden=!message;$('#lockerNotice').textContent=message;$('#lockerNotice').className='notice'+(error?' error':'');}
function feedback(message){$('#dialogFeedback').hidden=!message;$('#dialogFeedback').textContent=message;}
function draw(){
 const busy=lockers.filter(x=>x.rental_id).length;$('#freeCount').textContent=lockers.length-busy;$('#busyCount').textContent=busy;
 const q=$('#lockerSearch').value.trim().toLocaleLowerCase('vi-VN');
 const list=lockers.filter(l=>(q||l.zone===zone)&&(status==='all'||(status==='busy'?!!l.rental_id:!l.rental_id))&&(!q||[l.code,l.customer_name,l.customer_phone].join(' ').toLocaleLowerCase('vi-VN').includes(q)));
 $('#resultCount').textContent=q?list.length+' tủ khớp tìm kiếm trong cả hai dãy':list.length+' tủ · Dãy '+zone+' · '+zone+'1–'+zone+'30';
 $('#lockerGrid').setAttribute('aria-label',q?'Kết quả tìm tủ':'Sơ đồ dãy '+zone);
 $('#lockerGrid').innerHTML=list.map(l=>'<button type="button" class="locker-tile'+(l.rental_id?' occupied':'')+'" data-locker="'+l.code+'" aria-label="Tủ '+l.code+' — '+(l.rental_id?'đang thuê':'trống')+'"><span class="locker-mark" aria-hidden="true">✓</span><span class="locker-number">'+l.code+'</span><span class="locker-status"><i class="dot '+(l.rental_id?'busy':'free')+'"></i>'+(l.rental_id?'Đang thuê':'Trống')+'</span><span class="locker-person">'+(l.rental_id?esc(l.customer_name):'Chạm để thuê')+'</span></button>').join('')||'<p class="empty-grid">Không tìm thấy tủ phù hợp. Thử đổi bộ lọc hoặc từ khóa.</p>';
 $('#lockerGrid').querySelectorAll('[data-locker]').forEach(b=>b.addEventListener('click',()=>openLocker(b.dataset.locker)));
}
async function load(){if(loading||!authorized)return;loading=true;$('#refreshLockers').disabled=true;try{const result=await api('/api/lockers');lockers=result.lockers;$('#rentalPrice').textContent=Number(result.rentalFee||30000).toLocaleString('vi-VN')+'đ / tủ';draw();$('#syncStatus').textContent='Đã đồng bộ '+new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});notice('');}catch(e){notice(e.message,true);$('#syncStatus').textContent='Chưa đồng bộ';if(e.status===401||e.status===403){authorized=false;$('#lockerContent').hidden=true;$('#accessGate').hidden=false;$('#accessGate h2').textContent='Phiên đăng nhập hoặc quyền truy cập đã thay đổi.';if($('#lockerDialog').open)$('#lockerDialog').close();}}finally{loading=false;$('#refreshLockers').disabled=false}}
function openLocker(code){
 selected=lockers.find(x=>x.code===code);if(!selected)return;
 pending=null;feedback('');$('#rentForm').reset();$('#dialogTitle').textContent='Tủ '+code;
 $('#dialogEyebrow').textContent=selected.rental_id?'THÔNG TIN KHÁCH THUÊ':'CHO THUÊ TỦ';
 $('#rentForm').hidden=!!selected.rental_id;$('#occupiedDetails').hidden=!selected.rental_id;$('#returnConfirmation').hidden=true;$('#startReturn').hidden=false;$('#legacyFeeForm').hidden=!selected.rental_id||!!selected.charged_amount;$('#legacyFeeFeedback').textContent='';
 if(selected.rental_id){$('#renterName').textContent=selected.customer_name;$('#renterPhone').textContent=selected.customer_phone;$('#renterPhone').href='tel:'+selected.customer_phone;$('#rentedAt').textContent=new Date(selected.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});$('#renterFee').textContent=selected.charged_amount?Number(selected.charged_amount).toLocaleString('vi-VN')+'đ · '+(selected.payment_method==='bank_transfer'?'Chuyển khoản':'Tiền mặt'):'Lượt thuê cũ — chưa có phiếu thu tự động';$('#renterNote').textContent=selected.note||'Không có ghi chú';}
 $('#lockerDialog').showModal();if(!selected.rental_id)$('#customerName').focus();
}
function closeDialog(){if(!saving){$('#lockerDialog').close();pending=null;selected=null}}
$('#closeDialog').addEventListener('click',closeDialog);
$('#lockerDialog').addEventListener('cancel',e=>{if(saving)e.preventDefault()});
$('#lockerDialog').addEventListener('click',e=>{if(e.target===$('#lockerDialog'))closeDialog()});
document.querySelectorAll('[data-zone]').forEach(b=>b.addEventListener('click',()=>{zone=b.dataset.zone;$('#lockerSearch').value='';document.querySelectorAll('[data-zone]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b))});draw()}));
document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>{status=b.dataset.status;document.querySelectorAll('[data-status]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});draw()}));
$('#lockerSearch').addEventListener('input',draw);$('#refreshLockers').addEventListener('click',load);
$('#rentForm').addEventListener('submit',async e=>{
 e.preventDefault();if(saving||!selected)return;
 if(!pending){pending={...Object.fromEntries(new FormData(e.currentTarget)),confirmPayment:true,requestId:crypto.randomUUID()};}
 saving=true;$('#rentButton').disabled=true;$('#closeDialog').disabled=true;feedback('Đang lưu lượt thuê…');
 try{const result=await api('/api/lockers/'+selected.code+'/rent','POST',pending);$('#lockerDialog').close();pending=null;await load();notice(result.ended?'Lượt thuê này đã kết thúc. Sơ đồ tủ đã được cập nhật.':'Đã cho thuê tủ và tự ghi thu 30.000đ vào sổ Thu–chi.');}
 catch(error){feedback(error.message+(error.status?'':' Bấm lại sẽ kiểm tra cùng lượt thuê, không tạo lượt mới.'));if(error.status&&error.status<500)pending=null;await load();}
 finally{saving=false;$('#rentButton').disabled=false;$('#closeDialog').disabled=false;}
});
$('#startReturn').addEventListener('click',()=>{$('#startReturn').hidden=true;$('#returnConfirmation').hidden=false;$('#confirmReturn').focus()});
$('#cancelReturn').addEventListener('click',()=>{$('#startReturn').hidden=false;$('#returnConfirmation').hidden=true});
$('#confirmReturn').addEventListener('click',async()=>{
 if(saving||!selected?.rental_id)return;saving=true;$('#confirmReturn').disabled=true;$('#closeDialog').disabled=true;feedback('Đang cập nhật trả tủ…');
 try{await api('/api/lockers/'+selected.code+'/release','POST',{rentalId:selected.rental_id,confirm:true});$('#lockerDialog').close();await load();notice('Đã nhận trả tủ '+selected.code+'. Tủ sẵn sàng cho khách tiếp theo.');}
 catch(e){feedback(e.message);await load();}finally{saving=false;$('#confirmReturn').disabled=false;$('#closeDialog').disabled=false;}
});
(async()=>{try{const me=await api('/api/me');if(me.role!=='admin'&&me.workArea!=='equipment'){ $('#accessGate h2').textContent=me.staff?'Tài khoản này chưa được phân công quản lý tủ đồ.':'Đăng nhập để quản lý tủ đồ';return;}authorized=true;$('#backLink').href='/admin';$('#backLink').hidden=me.role!=='admin';$('#accessGate').hidden=true;$('#lockerContent').hidden=false;await load();}catch(e){$('#accessGate h2').textContent='Chưa kết nối được máy chủ.';$('#accessGate p').textContent=e.message;}})();
setInterval(()=>{if(!document.hidden&&!$('#lockerDialog').open)load()},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#lockerDialog').open)load()});

$('#legacyFeeForm').addEventListener('submit',async e=>{
 e.preventDefault();if(saving||!selected?.rental_id)return;saving=true;$('#legacyFeeButton').disabled=true;$('#closeDialog').disabled=true;$('#legacyFeeFeedback').textContent='Đang ghi thu…';
 try{await api('/api/lockers/'+selected.code+'/collect','POST',{rentalId:selected.rental_id,paymentMethod:$('#legacyPaymentMethod').value,confirmPayment:true});$('#lockerDialog').close();await load();notice('Đã ghi thu 30.000đ cho lượt thuê cũ.');}
 catch(error){$('#legacyFeeFeedback').textContent=error.message;}finally{saving=false;$('#legacyFeeButton').disabled=false;$('#closeDialog').disabled=false;}
});

$('#workLogout').addEventListener('click',async()=>{try{await api('/api/logout','POST',{})}finally{location.assign('/staff')}});
