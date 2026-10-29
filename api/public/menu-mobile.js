/* Mobile-only menu presentation. All writes keep the existing /api/v1/admin/core/catalog APIs. */
(() => {
 'use strict';
 const host=document.getElementById('mobileMenuApp');
 if(!host)return;
 const list=document.getElementById('mobileMenuList');
 const filters=document.getElementById('mobileMenuFilters');
 const count=document.getElementById('mobileMenuCount');
 const input=document.getElementById('mobileMenuSearch');
 let catalog=[],filter='all',editingDisabled=false;
 const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const price=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0});
 const svgPath={
  food:'<path d="M4 3v7a4 4 0 0 0 4 4v7M8 3v7M12 3v7a4 4 0 0 1-4 4M18 3v18m0-18c5 1 6 9 0 10"/>',
  drink:'<path d="M4 4h16l-2 17H6L4 4ZM3 8h18M9 3l3-2M12 3l3-2"/>',
  snack:'<path d="M6 3h12l3 7-3 11H6L3 10l3-7ZM3 10h18M9 3l1 7m5-7-1 7"/>',
  box:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
  right:'<path d="m9 18 6-6-6-6"/>'
 };
 const icon=(type)=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+svgPath[type]+'</svg>';
 const kind=item=>{
  const group=String(item.category||'').toLocaleLowerCase('vi-VN');
  if(/uống|cà phê|trà|nước|giải khát|bar/.test(group))return 'drink';
  if(/nhẹ|vặt|ăn chơi|tráng miệng/.test(group))return 'snack';
  if(/ăn|món|bếp|thực phẩm/.test(group))return 'food';
  return 'box';
 };
 const filterTitle=value=>value==='all'?'Tất cả':value==='active'?'Đang bán':value==='hidden'?'Tạm ẩn':value.startsWith('cat:')?value.slice(4):value;
 const filterItems=()=>{
  const categories=[...new Set(catalog.map(x=>String(x.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
  const choices=[['all',catalog.length],['active',catalog.filter(x=>x.active).length],['hidden',catalog.filter(x=>!x.active).length],
    ...categories.map(cat=>['cat:'+cat,catalog.filter(x=>x.category===cat).length])];
  if(!choices.some(([value])=>value===filter))filter='all';
  filters.innerHTML=choices.map(([value,n])=>'<button type="button" data-filter="'+escapeHTML(value)+'" class="'+(filter===value?'is-active':'')+'" aria-pressed="'+String(filter===value)+'">'+escapeHTML(filterTitle(value))+' <span>'+n+'</span></button>').join('');
 };
 function matches(item){
  if(filter==='active'&&!item.active)return false;
  if(filter==='hidden'&&item.active)return false;
  if(filter.startsWith('cat:')&&item.category!==filter.slice(4))return false;
  const query=input.value.trim().toLocaleLowerCase('vi-VN');
  if(!query)return true;
  return [item.name,item.sku,item.category,item.station==='bar'?'Bar':'Bếp'].some(x=>String(x??'').toLocaleLowerCase('vi-VN').includes(query));
 }
 function itemHTML(item){
  const category=String(item.category||'Khác');
  const id=escapeHTML(item.id);
  const active=Boolean(item.active);
  const status=active?'Đang bán':'Tạm ẩn';
  const type=kind(item);
  return '<article class="tt6-menu-item">'+
   '<button type="button" class="tt6-menu-item-info" data-edit="menu" data-id="'+id+'" aria-label="Sửa '+escapeHTML(item.name)+'">'+
   '<span class="tt6-menu-item-symbol tt6-menu-type-'+type+'">'+icon(type)+'</span>'+
   '<span class="tt6-menu-item-details"><span class="tt6-menu-item-name">'+escapeHTML(item.name)+'</span>'+
   '<span class="tt6-menu-item-price">'+price.format(Number(item.price)||0)+' ₫</span>'+
   '<span class="tt6-menu-item-meta">'+escapeHTML(category)+' · '+(item.station==='bar'?'Bar':'Bếp')+(item.sku?' · '+escapeHTML(item.sku):'')+'</span></span>'+
   '<span class="tt6-menu-item-chevron">'+icon('right')+'</span></button>'+
   '<div class="tt6-menu-item-availability"><span class="tt6-menu-status '+(active?'is-on':'is-off')+'">'+
   '<span class="tt6-menu-status-dot"></span>'+status+'</span>'+
   '<button type="button" role="switch" class="tt6-menu-switch '+(active?'is-on':'')+'" data-toggle="'+id+'" aria-checked="'+String(active)+'" aria-label="'+(active?'Tạm ẩn ':'Mở bán ')+escapeHTML(item.name)+'"><span class="tt6-menu-switch-knob"></span></button></div></article>';
 }
 function draw(){
  if(!Array.isArray(catalog))return;
  filterItems();
  const shown=catalog.filter(matches);
  count.textContent=shown.length+' món · tổng '+catalog.length;
  list.innerHTML=shown.length?shown.map(itemHTML).join(''):
    '<div class="tt6-menu-empty">Không có món phù hợp.<small>Thử từ khóa hoặc bộ lọc khác.</small></div>';
 }
 filters.addEventListener('click',event=>{
  const button=event.target.closest('button[data-filter]');
  if(!button)return;filter=button.dataset.filter;draw();
 });
 input.addEventListener('input',draw);
 document.getElementById('mobileMenuAdd').addEventListener('click',()=>{
  if(editingDisabled)return;
  const button=document.querySelector('#menu .ui-form-toggle');
  const form=document.getElementById('menuForm');
  if(!button||!form)return;
  // The original form is reused; no duplicate controls, API or server writes.
  form.reset();
  form.elements.namedItem('id').value='';
  setTimeout(()=>{
   if(!document.querySelector('#menu .ui-form-card.is-open'))button.click();
   const title=document.getElementById('menuSheetTitle');if(title)title.textContent='Thêm món';
  },0);
 });
 window.TT6MenuMobile={
  render(items){catalog=Array.isArray(items)?items:[];draw()},
  isEnabled(){return window.matchMedia('(max-width:760px)').matches},
  setBusy(busy){editingDisabled=busy;document.getElementById('mobileMenuAdd').disabled=busy}
 };
})();
