(() => {
 'use strict';
 const byId=id=>document.getElementById(id);
 function setup(){
  const dialog=byId('archQrDialog'),launch=byId('archQrLaunch'),picker=byId('archQrTable'),
   image=byId('archQrImage'),placeholder=byId('archQrPlaceholder'),selectedName=byId('archQrSelectedName'),
   guestLink=byId('archQrGuestLink'),printLink=byId('archQrPrintLink'),feedback=byId('archQrFeedback');
  if(!dialog||!launch||!picker||!image)return;
  let tables=[],currentToken='',fetchIndex=0;
  function showStatus(message,isError=false){feedback.textContent=message;feedback.classList.toggle('is-error',isError)}
  function clearQr(){
   image.hidden=true;image.removeAttribute('src');currentToken='';
   guestLink.hidden=true;guestLink.removeAttribute('href');
   printLink.hidden=true;printLink.removeAttribute('href');
   selectedName.textContent='';
   placeholder.hidden=false;
  }
  function chooseTable(){
   clearQr();
   const table=tables.find(t=>t.id===picker.value);
   if(!table){placeholder.textContent='Không có bàn đang mở QR';showStatus('Chưa có mã QR khả dụng. Kiểm tra tại Quản trị → Món & bàn.',true);return}
   currentToken=table.token;
   selectedName.textContent=table.name+(table.zone?' · '+table.zone:'');
   placeholder.textContent='Đang lấy mã QR từ server…';
   const token=table.token;
   const src='/qr/'+token+'.svg';
   const publicLink='/t/'+token;
   image.onload=()=>{
    if(currentToken!==token)return;
    image.hidden=false;placeholder.hidden=true;
    showStatus('Mã QR thật đã sẵn sàng. Dùng camera điện thoại quét để đặt món.');
   };
   image.onerror=()=>{
    if(currentToken!==token)return;
    image.hidden=true;placeholder.hidden=false;
    placeholder.textContent='Không tải được mã QR cho '+table.name;
    showStatus('Không tải được QR từ server. Hãy kiểm tra phiên đăng nhập hoặc thử chọn bàn khác.',true);
   };
   image.src=src;
   guestLink.href=publicLink;guestLink.hidden=false;
   printLink.href=src;printLink.hidden=false;
  }
  async function loadTables(){
   const request=++fetchIndex;
   clearQr();picker.disabled=true;picker.replaceChildren(new Option('Đang tải danh sách bàn…',''));
   placeholder.textContent='Đang tải mã QR thực từ hệ thống…';
   showStatus('Đang xác minh danh sách QR hoạt động.');
   try {
    const response=await fetch('/api/v1/tables',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(response.status===401||response.status===403?'Cần đăng nhập tài khoản có quyền quản lý QR.':'HTTP '+response.status);
    const result=await response.json();
    if(request!==fetchIndex)return;
    if(!Array.isArray(result.tables))throw Error('Dữ liệu bàn không hợp lệ.');
    tables=result.tables.filter(t=>t&&t.active===true&&typeof t.id==='string'&&typeof t.name==='string'&&typeof t.token==='string'&&/^[0-9a-f]{48}$/i.test(t.token));
    picker.replaceChildren();
    if(!tables.length){picker.add(new Option('Không có bàn mở QR',''));chooseTable();return}
    for(const t of tables)picker.add(new Option(t.name+(t.zone?' · '+t.zone:''),t.id));
    picker.disabled=false;
    chooseTable();
   }catch(error){
    if(request!==fetchIndex)return;
    picker.replaceChildren(new Option('Không tải được danh sách bàn',''));
    placeholder.textContent='Không có QR để hiển thị';
    showStatus('Không thể tải mã QR: '+error.message,true);
   }
  }
  function openQr(){
   if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
   else if(!dialog.open)dialog.setAttribute('open','');
   launch.setAttribute('aria-expanded','true');
   void loadTables();
  }
  function closeQr(){
   fetchIndex++;
   if(dialog.open&&typeof dialog.close==='function')dialog.close();
   else dialog.removeAttribute('open');
   launch.setAttribute('aria-expanded','false');
   launch.focus({preventScroll:true});
  }
  launch.setAttribute('aria-expanded','false');
  launch.addEventListener('click',openQr);
  byId('archQrClose')?.addEventListener('click',closeQr);
  byId('archQrDone')?.addEventListener('click',closeQr);
  picker.addEventListener('change',chooseTable);
  dialog.addEventListener('cancel',()=>{fetchIndex++;launch.setAttribute('aria-expanded','false')});
  dialog.addEventListener('close',()=>launch.setAttribute('aria-expanded','false'));
  dialog.addEventListener('click',event=>{
   if(event.target!==dialog)return;
   const rect=dialog.getBoundingClientRect();
   if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeQr();
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
 else setup();
})();