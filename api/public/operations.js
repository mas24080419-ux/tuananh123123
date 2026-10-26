'use strict';
const $=x=>document.querySelector(x);
const fmt=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(n)||0)+' đ';
const dec=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(Number(n)||0);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dtime=x=>new Date(x).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('#dateFrom').value=today.slice(0,7)+'-01';$('#dateTo').value=today;
let data=null,busy=false,ledgerExpanded=false;const pending=new Map();
function notice(s,mode='ok'){$('#notice').textContent=s;$('#notice').className='notice '+mode+(s?'':' hidden')}
async function api(url,options={}){
 let r;try{r=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}})}catch{const e=Error('Mất kết nối. Thử lại để kiểm tra giao dịch.');e.ambiguous=true;throw e}
 let j;try{j=await r.json()}catch{const e=Error('Máy chủ trả lời không hợp lệ.');e.ambiguous=true;throw e}
 if(!r.ok){const e=Error(j.error||'Yêu cầu bị từ chối');e.status=r.status;e.ambiguous=r.status>=500;throw e}return j;
}
const empty=(cols,msg)=>'<tr><td colspan="'+cols+'" class="empty">'+esc(msg)+'</td></tr>';

function filteredLedger(){
 if(!data)return[];
 const q=$('#opsLedgerSearch').value.trim().toLocaleLowerCase('vi-VN'),dir=$('#opsLedgerDirection').value;
 return (data.entries||[]).filter(x=>(dir==='all'||x.direction===dir)&&(!q||[x.category,x.note,x.source].join(' ').toLocaleLowerCase('vi-VN').includes(q)));
}
function filteredStock(){
 if(!data)return[];
 const q=$('#opsStockSearch').value.trim().toLocaleLowerCase('vi-VN'),lowOnly=$('#opsLowOnly').checked;
 return (data.inventory||[]).filter(x=>(!lowOnly||x.low_stock)&&(!q||String(x.name).toLocaleLowerCase('vi-VN').includes(q)));
}
function downloadCsv(filename,headers,rows){
 if(!rows.length){notice('Không có bản ghi để xuất theo bộ lọc hiện tại.','error');return}
 const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const body='\ufeff'+[headers,...rows].map(c=>c.map(safe).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function redrawViews(){if(data)render()}
$('#opsLedgerSearch').addEventListener('input',redrawViews);
$('#opsLedgerDirection').addEventListener('change',redrawViews);
$('#opsStockSearch').addEventListener('input',redrawViews);
$('#opsLowOnly').addEventListener('change',redrawViews);
$('#opsLedgerMore').addEventListener('click',()=>{ledgerExpanded=true;redrawViews()});
$('#opsLedgerExport').addEventListener('click',()=>downloadCsv('TamTrang6_ThuChi_'+$('#dateFrom').value+'_'+$('#dateTo').value+'.csv',
 ['Mã','Ngày','Loại','Danh mục','Số tiền VND','Phương thức','Nguồn','Diễn giải'],
 filteredLedger().map(x=>[x.id,x.created_at,x.direction,x.category,x.amount,x.payment_method,x.source,x.note])));
$('#opsStockExport').addEventListener('click',()=>downloadCsv('TamTrang6_TonKho.csv',
 ['Mã','Tên','Đơn vị','Tồn','Ngưỡng cảnh báo','Đơn giá bình quân VND','Cần nhập'],
 filteredStock().map(x=>[x.id,x.name,x.unit,x.quantity,x.reorder_level,x.avg_unit_cost,x.low_stock?'Có':'Không'])));

function render(){
 if(!data)return;
 const s=data.finance;
 [['#totalIn',fmt(s.total_in)],['#totalOut',fmt(s.total_out)],['#netCash',fmt(s.net_cashflow)],['#lowStock',s.low_stock_count],
 ['#salesReceived',fmt(s.sales_received)],['#purchases',fmt(s.stock_purchases)],['#inventoryValue','Giá trị kho ước tính: '+fmt(s.stock_value_estimate)]].forEach(([i,v])=>$(i).textContent=v);
 const methods={cash:'Tiền mặt',bank_transfer:'Chuyển khoản'};
 $('#opsLedgerCount').textContent=filteredLedger().length+' khoản khớp bộ lọc · trong '+data.entries.length+' khoản đã tải.';
 $('#opsStockCount').textContent=filteredStock().length+' nguyên liệu khớp bộ lọc · trong '+data.inventory.length+' nguyên liệu.';
 $('#opsMissingRecipe').textContent=data.menu.filter(m=>!data.recipes.some(r=>r.menu_item_id===m.id)).length+' / '+data.menu.length+' món chưa khai báo định mức nguyên liệu.';
 $('#financeRows').innerHTML=filteredLedger().map(x=>'<tr><td>'+esc(dtime(x.created_at))+'</td><td><span class="pill '+(x.direction==='expense'?'danger':'')+'">'+(x.direction==='expense'?'Chi':'Thu')+'</span></td><td>'+esc(x.category)+(x.source==='stock_purchase'?'<div class="muted">Tự ghi khi nhập kho</div>':'')+'</td><td>'+esc(methods[x.payment_method]||'—')+'</td><td><b>'+fmt(x.amount)+'</b></td><td>'+esc(x.note)+'</td></tr>').join('')||empty(6,'Chưa có khoản thu–chi phát sinh.');
 const entries=filteredLedger();
 const recent=ledgerExpanded?entries:entries.slice(0,15);
 $('#opsLedgerMobile').innerHTML=recent.length?recent.map(x=>{
  const expense=x.direction==='expense',method=methods[x.payment_method]||'Không rõ';
  const label=x.source==='stock_purchase'?x.category+' · Nhập kho':x.category;
  const mark=expense?'↑':'↓';
  const note=x.note?'<small>'+esc(x.note)+'</small>':'';
  return '<article class="tt6-transaction '+(expense?'expense':'income')+'">'+
    '<span class="tt6-transaction-icon" aria-hidden="true">'+mark+'</span>'+
    '<div class="tt6-transaction-info"><strong>'+esc(label)+'</strong>'+note+
    '<span class="tt6-transaction-meta">'+esc(dtime(x.created_at))+' · '+esc(method)+'</span></div>'+
    '<b class="tt6-transaction-amount">'+(expense?'−':'+')+fmt(x.amount)+'</b></article>';
 }).join(''):'<p class="tt6-transactions-empty">Chưa có giao dịch trong kỳ này. Chọn “Ghi khoản thu” hoặc “Ghi khoản chi” để bắt đầu.</p>';
 $('#opsLedgerMore').hidden=entries.length<=15||ledgerExpanded;
 $('#opsLedgerMore').textContent='Xem tất cả '+entries.length+' giao dịch';
 $('#inventoryRows').innerHTML=filteredStock().map(x=>'<tr><td><b>'+esc(x.name)+'</b><div class="muted">'+esc(x.unit)+'</div></td><td>'+dec(x.quantity)+'</td><td>'+dec(x.reorder_level)+'</td><td>'+fmt(x.avg_unit_cost)+'</td><td><span class="pill '+(x.low_stock?'danger':'')+'">'+(x.low_stock?'Cần nhập':'Đủ hàng')+'</span></td></tr>').join('')||empty(5,'Chưa tạo nguyên liệu. Bắt đầu ở biểu mẫu phía trên.');
 $('#recipeRows').innerHTML=data.recipes.map(r=>'<tr><td>'+esc(r.menu_name)+'</td><td>'+esc(r.ingredient_name)+'</td><td><b>'+dec(r.quantity_per_unit)+'</b> '+esc(r.unit)+'</td></tr>').join('')||empty(3,'Chưa có định mức. Các món chưa tự trừ kho.');
 const kinds={purchase:'Nhập mua',opening:'Tồn đầu kỳ',adjustment_in:'Điều chỉnh tăng',adjustment_out:'Hao hụt/giảm',consume:'Đơn QR',restore:'Hủy món chưa làm'};
 $('#movementRows').innerHTML=data.movements.map(r=>'<tr><td>'+esc(dtime(r.created_at))+'</td><td>'+esc(r.item_name)+'</td><td>'+esc(kinds[r.kind]||r.kind)+'</td><td><b>'+((Number(r.delta)>0)?'+':'')+dec(r.delta)+' '+esc(r.unit)+'</b></td><td>'+esc(r.note)+'</td></tr>').join('')||empty(5,'Chưa có phiếu kho.');
 const prevStock=$('#stockItem').value,prevRecipe=$('#recipeItem').value,prevDish=$('#recipeMenu').value;
 const options=data.inventory.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.name)+' ('+esc(i.unit)+')</option>').join('');
 $('#stockItem').innerHTML='<option value="">Chọn nguyên liệu</option>'+options;
 $('#recipeItem').innerHTML='<option value="">Chọn nguyên liệu</option>'+options;
 $('#recipeMenu').innerHTML='<option value="">Chọn món</option>'+data.menu.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join('');
 if(data.inventory.some(i=>i.id===prevStock))$('#stockItem').value=prevStock;
 if(data.inventory.some(i=>i.id===prevRecipe))$('#recipeItem').value=prevRecipe;
 if(data.menu.some(m=>m.id===prevDish))$('#recipeMenu').value=prevDish;
 const rows=data.daily.slice(-20),max=Math.max(...rows.flatMap(r=>[Number(r.inflow)||0,Number(r.outflow)||0]),1);
 $('#cashChart').innerHTML=rows.length?rows.map(r=>'<div class="bar-group" title="'+esc(r.day)+' | Thu '+fmt(r.inflow)+' | Chi '+fmt(r.outflow)+'"><div style="display:flex;align-items:end;gap:2px;height:132px;width:100%;justify-content:center"><div class="bar-pos" style="height:'+Math.max(2,Math.round(Number(r.inflow)/max*120))+'px"></div><div class="bar-neg" style="height:'+Math.max(2,Math.round(Number(r.outflow)/max*120))+'px"></div></div><span>'+esc(String(r.day).slice(5))+'</span></div>').join(''):'<div class="empty">Chưa có dòng tiền trong thời gian đã chọn.</div>';
}
function drawFinancialCharts(report){
 const ids=['#opsExpensePie','#opsPaymentPie','#opsCashBars'];
 if(!report||report.error||!window.TT6FinanceCharts){ids.forEach(x=>$(x).textContent='Không tải được biểu đồ: '+(report?.error||'Thiếu thư viện biểu đồ'));return}
 const ui=window.TT6FinanceCharts;
 ui.donut($('#opsExpensePie'),report.expense_categories.map(x=>({name:x.name,amount:x.amount})),
   {title:'Danh mục chi tiêu',totalLabel:'TỔNG CHI',drilldown:true,transactions:report.expense_transactions});
 ui.donut($('#opsPaymentPie'),report.payment_methods,{title:'Cơ cấu thanh toán',totalLabel:'ĐÃ NHẬN'});
 ui.trend($('#opsCashBars'),report.series,report.range.granularity);
}
async function load(){
 if(busy)return;busy=true;
 try{const params=new URLSearchParams({from:$('#dateFrom').value,to:$('#dateTo').value});
  const [operations,finance]=await Promise.all([api('/api/admin/operations?'+params),
    api('/api/admin/analytics?'+params).catch(e=>({error:e.message}))]);
  data=operations;render();drawFinancialCharts(finance);
  notice('');
 }catch(e){notice(e.message,'error');if(e.status===403||e.status===401)location.assign('/admin')}
 finally{busy=false}
}
function kindFields(){
 const purchase=$('#stockKind').value==='purchase';
 $('#purchaseFields').classList.toggle('hidden',!purchase);
 $('#purchaseFields input[name="unitCost"]').required=purchase;
}
$('#stockKind').addEventListener('change',kindFields);kindFields();
document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('[data-section]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active))});
 document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===b.dataset.section));
}));
async function submit(form,path,transform){
 const button=form.querySelector('[type="submit"]');
 const payload=transform(Object.fromEntries(new FormData(form)));
 const key=form.id;
 const existing=pending.get(key);
 const body=existing||{...payload,requestId:crypto.randomUUID()};
 if(!existing)pending.set(key,body);
 button.disabled=true;
 try{
  await api(path,{method:form.id==='recipeForm'?'PUT':'POST',body:JSON.stringify(body)});
  pending.delete(key);form.reset();kindFields();
  await load();
  if(form.id==='financeForm'){
   closeFinanceSheet();
   showFinanceToast('Giao dịch đã được lưu vào sổ thu–chi.');
  }else notice('Đã lưu nghiệp vụ vào Neon.');
 }catch(e){
  if(!e.ambiguous)pending.delete(key);
  const message=e.message+(e.ambiguous?' Kiểm tra sổ giao dịch trước khi thử lại để tránh trùng khoản thu/chi.':'');
  notice(message,'error');
  if(form.id==='financeForm')$('#financeFormNotice').textContent=message;
 }
 finally{button.disabled=false}
}
/* App-like transaction editor. The existing Neon POST and requestId guard stay unchanged. */
let financeLastFocus=null,financeToastTimer=null;
function showFinanceToast(message){
 const target=$('#financeToast');
 target.textContent=message;
 target.classList.add('is-visible');
 clearTimeout(financeToastTimer);
 financeToastTimer=setTimeout(()=>target.classList.remove('is-visible'),4500);
}
function selectFinanceDirection(direction){
 const form=$('#financeForm'),type=direction==='income'?'income':'expense';
 form.elements.namedItem('direction').value=type;
 $('#quickExpense').classList.toggle('is-selected',type==='expense');
 $('#quickIncome').classList.toggle('is-selected',type==='income');
 $('#quickExpense').setAttribute('aria-pressed',String(type==='expense'));
 $('#quickIncome').setAttribute('aria-pressed',String(type==='income'));
 $('#financeEntryHeading').textContent=type==='income'?'Ghi khoản thu khác':'Ghi khoản chi';
 $('#financeEntryHelp').textContent=type==='income'?
  'Chỉ ghi khoản thu ngoài đơn QR, ví dụ: hoàn ứng hoặc dịch vụ khác. Không ghi lại món đã thanh toán.':
  'Ghi chi phí vận hành. Nhập nguyên liệu tại mục Tồn kho để chi phí không bị ghi hai lần.';
 $('#financeSubmit').textContent=type==='income'?'Lưu khoản thu':'Lưu khoản chi';
 $('#quick-entry').dataset.direction=type;
}
function openFinanceSheet(direction,launcher){
 selectFinanceDirection(direction);
 financeLastFocus=launcher||document.activeElement;
 $('#financeFormNotice').textContent='';
 document.body.classList.add('tt6-sheet-open');
 $('#tt6-money-dialog').setAttribute('aria-modal','true');
 $('#closeFinanceSheet').setAttribute('aria-expanded','true');
 const input=$('#financeForm').elements.namedItem('amount');
 input.focus({preventScroll:true});
}
function closeFinanceSheet(){
 if(!document.body.classList.contains('tt6-sheet-open'))return;
 document.body.classList.remove('tt6-sheet-open');
 $('#tt6-money-dialog').removeAttribute('aria-modal');
 $('#closeFinanceSheet').setAttribute('aria-expanded','false');
 if(financeLastFocus&&typeof financeLastFocus.focus==='function')financeLastFocus.focus({preventScroll:true});
 financeLastFocus=null;
}
$('#quickExpense').addEventListener('click',function(){openFinanceSheet('expense',this)});
$('#quickIncome').addEventListener('click',function(){openFinanceSheet('income',this)});
$('#financeFab').addEventListener('click',function(){openFinanceSheet('expense',this)});
$('#closeFinanceSheet').addEventListener('click',closeFinanceSheet);
$('#financeBackdrop').addEventListener('click',closeFinanceSheet);
$('#financeForm').elements.namedItem('direction').addEventListener('change',e=>selectFinanceDirection(e.target.value));
$('#financeForm').addEventListener('reset',()=>setTimeout(()=>selectFinanceDirection('expense'),0));
document.addEventListener('keydown',e=>{
 if(!document.body.classList.contains('tt6-sheet-open'))return;
 if(e.key==='Escape'){e.preventDefault();closeFinanceSheet();return}
 if(e.key!=='Tab')return;
 const focusables=[...$('#tt6-money-dialog').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')].filter(x=>x.getClientRects().length>0);
 if(!focusables.length)return;
 const first=focusables[0],last=focusables[focusables.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
function updateFinancePeriod(){
 const from=$('#dateFrom').value,to=$('#dateTo').value;
 const month=from.slice(0,7)===to.slice(0,7);
 $('#financePeriodCaption').textContent=month?'Tháng '+from.slice(5,7)+'/'+from.slice(0,4):from.split('-').reverse().join('/')+' – '+to.split('-').reverse().join('/');
}
updateFinancePeriod();
$('#dateFilter').addEventListener('submit',()=>{
 updateFinancePeriod();
 if(window.matchMedia('(max-width: 760px)').matches)$('#tt6DateFold').open=false;
});
const financeMode=new URLSearchParams(location.search).get('type');
selectFinanceDirection(financeMode==='income'?'income':'expense');
// Deep links from dashboard open the real editor; ordinary visits show the wallet overview.
document.body.classList.add('tt6-finance-enhanced');
if(financeMode==='income'||financeMode==='expense'){
 openFinanceSheet(financeMode,$('#quick'+(financeMode==='income'?'Income':'Expense')));
}
const analyticsFold=$('#financeAnalyticsFold');
if(window.matchMedia('(min-width: 900px)').matches)analyticsFold.open=true;
$('#financeForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/admin/finance/entries',x=>({...x,amount:Number(x.amount)}))});
$('#createItemForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/admin/inventory/items',x=>({...x,reorderLevel:Number(x.reorderLevel)}))});
$('#stockForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/admin/inventory/movements',x=>({...x,quantity:Number(x.quantity),unitCost:x.kind==='purchase'?Number(x.unitCost):0}))});
$('#recipeForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/admin/inventory/recipes',x=>({...x,quantityPerUnit:Number(x.quantityPerUnit)}))});
$('#dateFilter').addEventListener('submit',e=>{e.preventDefault();load()});
$('#refresh').addEventListener('click',load);
(async()=>{try{const m=await api('/api/me');if(m.role!=='admin'){location.assign('/admin');return}await load()}catch(e){notice(e.message,'error')}})();

/* V11: show data first, allow a single accounting or stock form on demand. */
(function quietOperations(){
 const actions=[
  {section:'inventory',name:'Thêm nguyên liệu',form:'createItemForm'},
  {section:'inventory',name:'Nhập / xuất kho',form:'stockForm'},
  {section:'recipes',name:'Sửa định mức',form:'recipeForm'}
 ];
 const toggles=new Map();
 for(const action of actions){
  const section=document.getElementById(action.section);
  const form=document.getElementById(action.form);
  const panel=form?.closest('.panel');
  if(!section||!panel)throw Error('Thiếu biểu mẫu '+action.form);
  panel.classList.add('ui-hide-by-default');
  const button=document.createElement('button');button.type='button';button.className='ui-quiet-action';
  button.textContent='+ '+action.name;button.setAttribute('aria-expanded','false');
  const show=(open)=>{
   for(const other of actions.filter(x=>x.section===action.section&&x.form!==action.form)){
    const node=document.getElementById(other.form)?.closest('.panel');
    node?.classList.remove('is-open');
    const oldButton=toggles.get(other.form)?.button;
    if(oldButton){oldButton.textContent='+ '+other.name;oldButton.setAttribute('aria-expanded','false')}
   }
   panel.classList.toggle('is-open',open);
   button.textContent=open?'Đóng biểu mẫu':'+ '+action.name;
   button.setAttribute('aria-expanded',String(open));
   if(open)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  button.addEventListener('click',()=>show(!panel.classList.contains('is-open')));
  form.addEventListener('reset',()=>setTimeout(()=>show(false),0));
  toggles.set(action.form,{button,show});
 }
 for(const sectionName of ['inventory','recipes']){
  const section=document.getElementById(sectionName);
  const row=document.createElement('div');row.className='ui-toolbar';
  for(const action of actions.filter(x=>x.section===sectionName))row.append(toggles.get(action.form).button);
  const columns=section.querySelector('.columns');
  const remaining=[...section.querySelectorAll(':scope > .panel')];
  // The ledger and the current inventory/recipe tables are the default starting point.
  for(const panel of remaining)section.insertBefore(panel,columns);
  if(sectionName==='recipes'){
   const list=columns.querySelector(':scope > .panel:not(.ui-hide-by-default)');
   if(list)section.insertBefore(list,columns);
  }
  section.insertBefore(row,columns);
 }
 // Move financial chart into an optional disclosure at the bottom.
 const finance=document.getElementById('finance');
 const chart=finance.querySelector('.columns > .panel:not(.ui-hide-by-default)');
 if(chart){
  const details=document.createElement('details');details.className='ui-detail';
  const summary=document.createElement('summary');summary.textContent='Biểu đồ dòng tiền';
  details.append(summary,chart);finance.append(details);
 }
 const cols=finance.querySelector('.columns');if(cols)cols.style.display='block';
 const inv=document.getElementById('inventory').querySelector('.columns');if(inv)inv.style.display='block';
 const recipe=document.getElementById('recipes').querySelector('.columns');if(recipe)recipe.style.display='block';
 const fromHash=location.hash.slice(1);
 const tab=document.querySelector('[data-section="'+fromHash+'"]');
 if(tab)tab.click();
})();
