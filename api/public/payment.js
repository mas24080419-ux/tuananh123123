'use strict';
const $=s=>document.querySelector(s);
const show=(message,error=false)=>{$('#notice').textContent=message;$('#notice').className='info status'+(error?' error':'')};
async function api(path,opts={}){
 const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
 let j;try{j=await r.json()}catch{throw Error('Máy chủ trả về dữ liệu không hợp lệ')}
 if(!r.ok)throw Error(j.error||'Không lưu được cấu hình');return j;
}
let banks=[];
function renderBanks(selectedBin=''){
 const select=$('#bankSelect');
 const sorted=[...banks].sort((a,b)=>a.name.localeCompare(b.name,'vi'));
 select.replaceChildren();
 const option=document.createElement('option');
 option.value='';option.textContent='Chọn ngân hàng nhận tiền';select.append(option);
 for(const bank of sorted){
  const opt=document.createElement('option');opt.value=bank.bin;opt.textContent=bank.name;
  select.append(opt);
 }
 // Preserve an older configured bank if VietQR no longer lists its routing code.
 if(selectedBin&&!sorted.some(bank=>bank.bin===selectedBin)){
  const opt=document.createElement('option');opt.value=selectedBin;opt.textContent='Ngân hàng đã lưu (mã '+selectedBin+')';select.append(opt);
 }
 select.value=selectedBin||'';
}
function display(bank){
 const okay=bank&&bank.enabled;
 $('#previewCard').hidden=!okay;
 if(!okay)return;
 const params=new URLSearchParams({amount:'1000',addInfo:'TT6 KIEM TRA',accountName:bank.account_name||bank.accountName});
 const bin=bank.bank_bin||bank.bankBin,account=bank.account_number||bank.accountNumber;
 $('#previewQr').src='https://img.vietqr.io/image/'+bin+'-'+account+'-compact2.png?'+params.toString();
 $('#previewName').textContent=bank.account_name||bank.accountName;
 const selected=banks.find(b=>b.bin===bin);$('#previewDescription').textContent=(selected?selected.name:'Ngân hàng mã '+bin)+' · STK '+account;
}
async function init(){
 try{
  const me=await api('/api/me');if(me.role!=='admin'){location.replace('/admin');return}
  const [directory,r]=await Promise.all([api('/api/admin/payment-banks'),api('/api/admin/payment-settings')]);
  banks=Array.isArray(directory.banks)?directory.banks.filter(b=>/^\d{6}$/.test(b.bin)&&b.name):[];
  if(!banks.length)throw Error('Chưa tải được danh sách ngân hàng. Vui lòng tải lại trang.');
  renderBanks(r.payment?.bank_bin||'');
  $('#bankDirectoryNote').textContent=directory.source==='fallback'?'Đang dùng danh sách ngân hàng dự phòng. Chỉ cần chọn tên ngân hàng.':'Danh sách ngân hàng được đồng bộ từ VietQR. Không cần nhập PIN hay BIN.';
  if(r.payment){$('#bankAccount').value=r.payment.account_number;$('#bankName').value=r.payment.account_name;$('#bankEnabled').checked=r.payment.enabled;display(r.payment);show('Đã tải cấu hình ngân hàng từ Neon.')}
  else show('Chọn ngân hàng và nhập tài khoản nhận tiền của cửa hàng.');
 }catch(e){show(e.message,true)}
}
$('#bankForm').addEventListener('submit',async e=>{
 e.preventDefault();const b=$('#save');b.disabled=true;
 try{
  const body={bankBin:$('#bankSelect').value,accountNumber:$('#bankAccount').value.trim(),accountName:$('#bankName').value.trim(),enabled:$('#bankEnabled').checked};
  const r=await api('/api/admin/payment-settings',{method:'PUT',body:JSON.stringify(body)});
  display(r.payment);show('Đã lưu ngân hàng nhận tiền. Hãy kiểm tra thông tin bằng app ngân hàng trước khi nhận thanh toán thật.');
 }catch(e){show(e.message,true)}finally{b.disabled=false}
});
init();
