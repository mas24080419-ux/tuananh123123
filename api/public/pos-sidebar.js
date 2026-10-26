/* Tắm Tráng 6 sidebar — adapted from the public MediQueue Premium Sidebar
   interaction patterns (groups, desktop collapse, mobile drawer). Presentation
   only: auth, RBAC, API calls and route guards remain with the POS backend. */
(() => {
'use strict';
const PATH = window.location.pathname;
const STORE_KEY = 'tt6:admin-sidebar:collapsed';
const iconPaths={
 home:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 restaurant:'<path d="M4 3v8m4-8v8M4 7h4m-2 4v10M15 3v18m0-18c5 0 6 6 0 8"/>',
 table:'<path d="M4 10h16M7 10v11m10-11v11M5 5h14v5H5z"/>',
 chart:'<path d="M3 20V10m6 10V4m6 16v-8m6 8v-6"/>',
 wallet:'<rect x="2" y="5" width="20" height="16" rx="3"/><path d="M2 9h20m-6 5h3"/>',
 chef:'<path d="M6 14a4 4 0 0 1-1-8 5 5 0 0 1 9-2 5 5 0 0 1 5 8v4H6zM6 20h13"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3c0-3 3-5 6-5s6 2 6 5v3M17 5a3 3 0 0 1 0 6m3 10v-3c0-2-1-4-3-5"/>',
 qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3m7-3h-2m-3 7h-2m7-4v4h-4"/>',
 box:'<path d="m3 7 9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M4 9 2 12l2 3 3 1 2 3h6l2-3 3-1 2-3-2-3-3-1-2-3H9L7 8z"/>',
 person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 chevron:'<path d="m7 10 5 5 5-5"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 close:'<path d="M5 5l14 14M19 5 5 19"/>',
 panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
 arrow:'<path d="m9 18 6-6-6-6"/>'
};
const svg=(name)=>'<svg class="tt6-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(iconPaths[name]||iconPaths.home)+'</svg>';
const active=(route)=>PATH===route||(route==='/admin'&&PATH==='/admin/');
const link=(href,label,icon,options={})=>{
 const primary=href.split('#')[0];
 const selected=options.sub?PATH===primary&&window.location.hash===href.slice(primary.length):active(primary);
 return '<a class="tt6-side-link'+(selected?' is-active':'')+(options.sub?' tt6-side-sub-link':'')+'" href="'+href+'"'+(selected?' aria-current="page"':'')+'>'+
 svg(icon)+'<span class="tt6-side-text">'+label+'</span></a>';
};
const group=(label,icon,body,open)=>'<details class="tt6-side-group"'+(open?' open':'')+'><summary>'+svg(icon)+'<span class="tt6-side-text">'+label+'</span>'+svg('chevron')+'</summary><div class="tt6-side-subnav">'+body+'</div></details>';
function setup(){
 let shell=document.querySelector('.shell');
 if(!shell){
  const payment=document.querySelector('body > .wrap');
  if(!payment)return;
  shell=document.createElement('div');
  shell.className='shell tt6-payment-shell';
  payment.before(shell);
  payment.classList.add('tt6-payment-content');
  shell.append(payment);
 }
 let side=shell.querySelector(':scope > aside');
 if(!side){
  side=document.createElement('aside');
  shell.prepend(side);
 }
 side.className='tt6-sidebar tt6-ready';
 side.id='tt6-sidebar';
 side.setAttribute('aria-label','Thanh điều hướng quản trị Tắm Tráng 6');
 const advancedOpen=PATH==='/admin/core'&&!!window.location.hash&&['#suppliers','#customers','#reservations','#shifts','#audit'].includes(window.location.hash);
 side.innerHTML=
 '<div class="tt6-side-header">'+
 '<a href="/admin" class="tt6-side-brand" aria-label="Tắm Tráng 6 - Tổng quan"><img src="/tam-trang-6-logo.svg" alt="" width="44" height="44"><span class="tt6-side-brand-name"><strong>Tắm Tráng 6</strong><small>BEACH POS · QUẢN TRỊ</small></span></a>'+
 '<button type="button" id="tt6-collapse" class="tt6-side-collapse" aria-label="Thu gọn thanh điều hướng" aria-pressed="false" title="Thu gọn / mở rộng">'+svg('panel')+'</button>'+
 '<button type="button" id="tt6-side-mobile-close" class="tt6-side-mobile-close" aria-label="Đóng menu">'+svg('close')+'</button></div>'+
 '<div class="tt6-side-summary"><span class="tt6-side-summary-icon">'+svg('restaurant')+'</span><span class="tt6-side-summary-label"><b>Cửa hàng</b><small>Quản lý bán hàng</small></span></div>'+
 '<div class="tt6-side-scroller"><span class="tt6-side-section-label">ĐIỀU HƯỚNG</span>'+
 '<nav class="tt6-side-nav" aria-label="Các chức năng Tắm Tráng 6">'+
 link('/admin','Tổng quan','home')+
 link('/admin/core','Món & bàn','table')+
 link('/admin/operations','Thu–chi','wallet')+
 link('/staff','Màn hình bếp / Bar','chef')+
 '<span class="tt6-side-section-label">QUẢN LÝ CỬA HÀNG</span>'+
 link('/admin/users','Nhân viên & quyền','users')+
 link('/admin/payment','QR chuyển khoản','qr')+
 group('Nghiệp vụ khác','settings',
   link('/admin/core#customers','Khách hàng','person',{sub:true})+
   link('/admin/core#suppliers','Nhà cung cấp','box',{sub:true})+
   link('/admin/core#reservations','Đặt bàn','calendar',{sub:true})+
   link('/admin/core#shifts','Ca thu ngân','wallet',{sub:true})+
   link('/admin#security','Bảo mật & đổi mật khẩu','settings',{sub:true})+
   link('/admin/core#audit','Nhật ký thay đổi','chart',{sub:true}),
   advancedOpen)+
 '</nav></div>'+
 '<div class="tt6-side-bottom"><div class="tt6-side-user"><span class="tt6-side-avatar">QT</span><span class="tt6-side-user-label"><strong>Quản trị cửa hàng</strong><small>Dữ liệu lưu trên Neon</small></span>'+svg('settings')+'</div>'+
 '<span class="tt6-side-footnote">TẮM TRÁNG 6 · QUẢN LÝ CỬA HÀNG</span></div>';
 // A background layer is not a UI button. The old <button> picked up
 // the global POS orange button background (!) in iOS Messenger/Safari.
 const overlay=document.createElement('div');
 overlay.id='tt6-side-overlay';
 overlay.className='tt6-side-overlay';
 overlay.setAttribute('aria-hidden','true');
 overlay.hidden=true;
 document.body.append(overlay);
 const mobile=document.createElement('div');
 mobile.id='tt6-mobile-header';
 mobile.className='tt6-mobile-header';
 mobile.innerHTML='<button type="button" class="tt6-mobile-open" id="tt6-mobile-open" aria-controls="tt6-sidebar" aria-expanded="false" aria-label="Mở menu">'+svg('menu')+'</button>'+
 '<img src="/tam-trang-6-logo.svg" width="34" height="34" alt=""><span>Tắm Tráng 6</span><small>QUẢN TRỊ</small>';
 document.body.insertBefore(mobile,shell);
 // Bottom navigation and drawer share the desktop sidebar route definitions.
 const bottom=document.createElement('nav');
 bottom.id='tt6-mobile-bottom';
 bottom.className='tt6-mobile-bottom';
 bottom.setAttribute('aria-label','Điều hướng nhanh');
 const mobileLink=(href,label,iconName)=>'<a href="'+href+'" class="tt6-mobile-bottom-link'+(PATH===href?' is-active':'')+'"'+(PATH===href?' aria-current="page"':'')+'>'+svg(iconName)+'<span>'+label+'</span></a>';
 bottom.innerHTML=mobileLink('/admin','Tổng quan','home')+
   mobileLink('/admin/core','Món & bàn','table')+
   mobileLink('/admin/operations','Thu–chi','wallet')+
   mobileLink('/admin/users','Nhân viên','users')+
   '<button type="button" id="tt6-bottom-more" aria-label="Mở toàn bộ chức năng">'+svg('menu')+'<span>Thêm</span></button>';
 document.body.appendChild(bottom);
 const btn=mobile.querySelector('#tt6-mobile-open');
 const more=bottom.querySelector('#tt6-bottom-more');
 const collapse=side.querySelector('#tt6-collapse');
 const closeButton=side.querySelector('#tt6-side-mobile-close');
 let lastFocus=null;
 const isMobile=()=>window.matchMedia('(max-width: 760px)').matches;
 const close=()=>{
  document.body.classList.remove('tt6-menu-open');
  overlay.hidden=true;
  btn.setAttribute('aria-expanded','false');
  side.removeAttribute('aria-modal');
  side.removeAttribute('role');
  if(lastFocus && document.activeElement && side.contains(document.activeElement))lastFocus.focus();
 };
 const open=()=>{
  if(!isMobile())return;
  lastFocus=document.activeElement;
  document.body.classList.add('tt6-menu-open');
  overlay.hidden=false;
  btn.setAttribute('aria-expanded','true');
  side.setAttribute('role','dialog');
  side.setAttribute('aria-modal','true');
  side.querySelector('.tt6-side-brand')?.focus();
 };
 btn.addEventListener('click',()=>document.body.classList.contains('tt6-menu-open')?close():open());
 more.addEventListener('click',open);
 overlay.addEventListener('click',close);
 closeButton.addEventListener('click',close);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.body.classList.contains('tt6-menu-open')){e.preventDefault();close()}
  if(e.key==='Tab'&&document.body.classList.contains('tt6-menu-open')){
   const focusables=[...side.querySelectorAll('a,button,summary')].filter(el=>!el.closest('details:not([open])') && el.getClientRects().length);
   if(!focusables.length)return;
   const first=focusables[0],last=focusables[focusables.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
 });
 side.addEventListener('click',e=>{
  const linkEl=e.target.closest('a[href]');
  if(!linkEl)return;
  const url=new URL(linkEl.href,window.location.href);
  if(url.pathname===PATH&&url.hash){
   const token=url.hash.slice(1);
   const tab=document.querySelector('[data-tab="'+token+'"],[data-section="'+token+'"]');
   if(tab){
     e.preventDefault();history.replaceState(null,'',url.href);tab.click();
     side.querySelectorAll('a.tt6-side-sub-link').forEach(a=>{
       const selected=a.getAttribute('href')===url.pathname+url.hash;
       a.classList.toggle('is-active',selected);
       if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
     });
   }
  }
  if(isMobile())close();
 });
 const persist=()=>{
  try{localStorage.setItem(STORE_KEY,String(document.body.classList.contains('tt6-side-collapsed')))}catch{}
 };
 let saved=false;try{saved=localStorage.getItem(STORE_KEY)==='true'}catch{}
 document.body.classList.toggle('tt6-side-collapsed',saved);
 collapse.setAttribute('aria-pressed',String(saved));
 collapse.addEventListener('click',()=>{
  const collapsed=document.body.classList.toggle('tt6-side-collapsed');
  collapse.setAttribute('aria-pressed',String(collapsed));
  collapse.setAttribute('aria-label',collapsed?'Mở rộng thanh điều hướng':'Thu gọn thanh điều hướng');
  persist();
 });
 window.addEventListener('resize',()=>{if(!isMobile())close()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
else setup();
})();
