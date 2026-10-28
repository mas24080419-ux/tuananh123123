'use strict';
const $=s=>document.querySelector(s);
function notice(message,error=false){const el=$('#notice');el.textContent=message;el.className='info status'+(error?' error':'')}
async function api(url,options={}){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...options});
 let data;try{data=await r.json()}catch{throw Error('Máy chủ trả về dữ liệu không hợp lệ')}
 if(!r.ok)throw Error(data?.error||'Không xử lý được yêu cầu');
 return data;
}
const label={'970422':'MB Bank','970415':'VietinBank'};
function display(account){
 const card=$('[data-bin="'+account.bankBin+'"]');if(!card)return;
 const form=card.querySelector('form');
 form.elements.namedItem('accountNumber').value=account.accountNumber;
 form.elements.namedItem('accountName').value=account.accountName;
 form.elements.namedItem('enabled').checked=Boolean(account.enabled);
 const panel=card.querySelector('.tt6-bank-preview');
 panel.hidden=!account.enabled;
 if(!account.enabled)return;
 const query=new URLSearchParams({amount:'1000',addInfo:account.bankBin==='970415'?'SEVQR TT6 TEST':'TT6 TEST',accountName:account.accountName});
 card.querySelector('.bankPreviewQr').src='https://img.vietqr.io/image/'+account.bankBin+'-'+account.accountNumber+'-compact2.png?'+query;
 card.querySelector('.bankPreviewInfo').textContent=label[account.bankBin]+' · STK '+account.accountNumber+' · '+account.accountName;
}
async function init(){
 try{
  const me=await api('/api/me');if(me.role!=='admin'){location.replace('/login');return}
  const r=await api('/api/admin/receiving-banks');
  for(const account of r.accounts||[])if(label[account.bankBin])display(account);
  $('#sepayWebhookUrl').textContent=location.origin+'/api/webhooks/sepay';
  $('#sepayState').textContent=!r.sepay?.configured?'Chưa cấu hình khóa webhook — chỉ QR và xác nhận thủ công':
   r.sepay.autoConfirm?'HMAC đã cấu hình · Đối soát tự động được bật':'HMAC đã cấu hình · Chế độ thử nghiệm, chưa ghi doanh thu tự động';
  notice('Đã tải cấu hình từ PostgreSQL.');
 }catch(e){notice(e.message,true)}
}
document.querySelectorAll('.receivingBankForm').forEach(form=>form.addEventListener('submit',async event=>{
 event.preventDefault();
 const btn=form.querySelector('.bankSave');btn.disabled=true;
 const account={bankBin:form.dataset.bankBin,accountNumber:form.elements.namedItem('accountNumber').value.trim(),
 accountName:form.elements.namedItem('accountName').value.trim(),enabled:form.elements.namedItem('enabled').checked};
 try{
  const r=await api('/api/admin/receiving-banks',{method:'PUT',body:JSON.stringify(account)});
  display(r.account);
  notice('Đã lưu '+label[account.bankBin]+' trên PostgreSQL. Hãy quét QR kiểm tra thông tin.');
 }catch(e){notice(e.message,true)}finally{btn.disabled=false}
}));
function money(v){return new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(v)||0)+'đ'}
async function refreshTransactions(){
 const status=$('#bankTxStatus'),list=$('#bankTxList');
 if(!list)return;
 try{
  const result=await api('/api/admin/bank-transactions');
  const rows=result.transactions||[];
  status.textContent=rows.length?'Đang hiển thị '+rows.length+' thông báo giao dịch gần nhất.':'Chưa có thông báo giao dịch nào từ webhook đã xác thực.';
  const labels={needs_review:'Cần đối soát',verified_test:'Đã khớp · Chế độ thử nghiệm',auto_paid:'Đã tự xác nhận',already_paid:'Đơn đã được xác nhận trước đó'};
  list.replaceChildren();
  for(const tx of rows){
   const item=document.createElement('div');item.className='tt6-bank-tx-row';
   const heading=document.createElement('strong');
   heading.textContent=(label[tx.bankBin]||'Ngân hàng chưa xác định')+' · '+money(tx.amount);
   const detail=document.createElement('small');
   detail.textContent='Tài khoản '+(tx.accountTail||'chưa xác định')+' · Mã '+(tx.reference||'chưa khớp')+' · '+(tx.receivedAt?new Date(tx.receivedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'');
   const badge=document.createElement('span');badge.className='tt6-bank-tx-state';
   badge.textContent=labels[tx.status]||'Chờ kiểm tra';
   item.append(heading,detail,badge);list.append(item);
  }
 }catch(e){status.textContent='Không tải được nhật ký: '+e.message}
}
$('#refreshBankTx')?.addEventListener('click',refreshTransactions);
init();
void refreshTransactions();
