'use strict';
const $=s=>document.querySelector(s);
const fmt=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(n)||0)+' ₫';
const d=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('#fiTo').value=d;$('#fiFrom').value=d.slice(0,7)+'-01';
let report=null;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function money(id,n){$(id).textContent=fmt(n)}
function empty(parent,label){parent.replaceChildren(el('p','fi-empty',label))}
function render(){
 const r=report,s=r.summary;
 money('#fiCashIn',s.cashIn);money('#fiCashOut',s.cashOut);money('#fiNetCash',s.netCashflow);
 $('#fiContribution').textContent=r.quality.level==='incomplete'?'Chưa đủ dữ liệu':fmt(s.contributionEstimate);
 money('#fiFoodCogs',s.foodCogsEstimate);
 money('#fiStock',s.inventoryValueEstimate);
 $('#fiPaidOrders').textContent=new Intl.NumberFormat('vi-VN').format(s.settledOrders);
 $('#fiDueCount').textContent=s.unpaidOrders+' đơn';
 $('#fiDueAmount').textContent=fmt(s.unpaidAmount)+' chưa xác nhận';
 $('#fiQuality').classList.toggle('is-clear',r.quality.level==='provisional');
 $('#fiQualityHeading').textContent=r.quality.level==='incomplete'?'Độ tin cậy lợi nhuận: Chưa đủ dữ liệu':'Độ tin cậy: Sơ bộ, cần đối chiếu chứng từ';
 const issues=$('#fiIssues');issues.replaceChildren();
 for(const x of r.quality.issues)issues.append(el('p','fi-issue',x.text));
 issues.append(el('p','fi-issue','Chưa có cơ sở xác nhận đầy đủ khấu hao, thuế và các khoản chi phí ngoài hệ thống.'));
 const revenue=$('#fiRevenue'),largest=Math.max(1,...r.revenueSegments.map(x=>x.amount));
 revenue.replaceChildren();
 for(const x of r.revenueSegments.filter(x=>x.amount>0)){
  const line=el('div','fi-bar-line');const title=el('div','fi-bar-top');
  title.append(el('span',null,x.name),el('b',null,fmt(x.amount)));
  const rail=el('div','fi-bar-rail'),fill=el('span','fi-bar-fill');
  fill.style.width=(100*x.amount/largest).toFixed(1)+'%';rail.append(fill);
  line.append(title,rail);revenue.append(line);
 }
 if(!revenue.children.length)empty(revenue,'Chưa có khoản thu xác nhận trong kỳ.');
 const expenses=$('#fiExpenses');expenses.replaceChildren();
 const addExpense=(label,amount)=>{
  const row=el('div','fi-breakdown-row');row.append(el('span',null,label),el('strong',null,fmt(amount)));expenses.append(row);
 };
 addExpense('Chi mua nguyên liệu (dòng tiền)',s.stockPurchases);
 addExpense('Các khoản chi khác',s.otherExpenses);
 for(const x of r.expenses.filter(x=>x.type!=='stock_purchase'))addExpense('↳ '+x.name,x.amount);
 const trend=$('#fiTrend');trend.replaceChildren();
 const max=Math.max(1,...r.trend.flatMap(x=>[x.incoming,x.outgoing]));
 for(const x of r.trend){
  const item=el('div','fi-trend-item'),pair=el('div','fi-trend-pair');
  const income=el('i'),expense=el('i');
  income.style.height=(x.incoming?Math.max(3,Math.round(105*x.incoming/max)):0)+'px';
  expense.style.height=(x.outgoing?Math.max(3,Math.round(105*x.outgoing/max)):0)+'px';
  item.title=x.period+' · Thu '+fmt(x.incoming)+' · Chi '+fmt(x.outgoing)+' · Thuần '+fmt(x.net);
  pair.append(income,expense);item.append(pair,el('small',null,x.period.slice(5)));trend.append(item);
 }
 if(!r.trend.length)empty(trend,'Chưa có dòng tiền phát sinh trong kỳ.');

 const products=$('#fiProducts');products.replaceChildren();
 for(const x of r.products){
  const row=el('tr');
  for(const value of [x.name,x.quantity,fmt(x.lineSales),fmt(x.ingredientCost),x.contributionEstimate===null?'Chưa đủ dữ liệu':fmt(x.contributionEstimate),(x.missingConsumptionLines||x.zeroCostLines)?'Thiếu ('+(x.missingConsumptionLines||0)+' chưa xuất, '+(x.zeroCostLines||0)+' chưa giá)':'Đã liên kết'])
   row.append(el('td',null,String(value)));
  products.append(row);
 }
 if(!r.products.length){const row=el('tr'),cell=el('td','fi-empty','Chưa có món thuộc đơn đã thanh toán trong kỳ.');cell.colSpan=6;row.append(cell);products.append(row)}
 renderUnitEconomics(r.unitEconomics);
 const due=$('#fiDueList');due.replaceChildren();
 for(const x of r.unpaidRecent){
  const line=el('div','fi-due-row');line.append(el('span',null,x.table+' · '+x.id.slice(0,8)),el('strong',null,fmt(x.amount)));due.append(line);
 }
 if(!r.unpaidRecent.length)empty(due,'Không có đơn chưa thanh toán trong khoảng ngày đã chọn.');
 $('#fiFootnote').textContent=r.quality.caveat+' Cập nhật lúc '+new Date(r.asOf).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+'.';
}
function csv(){
 if(!report)return;
 const s=report.summary,rows=[['SalesHub Financial Intelligence',report.range.from,report.range.to],
  ['Khoản mục','Giá trị (VND)'],['Tiền thực thu',s.cashIn],['Tiền thực chi',s.cashOut],
  ['Dòng tiền thuần',s.netCashflow],['Giá vốn món ước tính',s.foodCogsEstimate],
  ['Tiền nhập nguyên liệu',s.stockPurchases],['Các khoản chi khác',s.otherExpenses],
  ['Kết quả quản trị sơ bộ - chưa xác minh lợi nhuận',s.contributionEstimate],
  ['Đơn chưa thanh toán',s.unpaidOrders],['Giá trị đơn chưa xác nhận',s.unpaidAmount],
  ['Chất lượng dữ liệu',report.quality.level],['CẢNH BÁO',report.quality.caveat],
  ...report.quality.issues.map(x=>['Lưu ý',x.text]),
  ['Nguồn thu','Số tiền VND'],...report.revenueSegments.map(x=>[x.name,x.amount]),
  ['Món','Số lượng','Doanh thu','Giá vốn','Chênh lệch sơ bộ'],...report.products.map(x=>[x.name,x.quantity,x.lineSales,x.ingredientCost,x.contributionEstimate===null?'Chưa đủ dữ liệu':x.contributionEstimate]),
  ['GIÁ VỐN HIỆN TẠI THEO MÓN'],['Món','Giá bán','Giá vốn/món','Biên gộp %'],
  ...(report.unitEconomics?.recipes||[]).map(x=>[x.name,x.unitPrice,x.estimatedUnitCost??'Chưa đủ dữ liệu',x.estimatedMarginPct??'—']),
  ['HIỆU QUẢ DỊCH VỤ'],['Dịch vụ','Số lượt','Thực thu','Chi phí trực tiếp','Chênh lệch','Biên gộp %','Phiếu chưa có giá vốn'],
  ...(report.unitEconomics?.services||[]).map(x=>[x.name,x.quantity,x.received,x.knownDirectCost,x.estimatedContribution??'Chưa đủ dữ liệu',x.estimatedMarginPct??'—',x.missingCostReceipts])];
 const quote=v=>{let x=String(v??'');if(/^[=+\-@\t\r]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';};
 const blob=new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SalesHub_Financial_Intelligence_'+report.range.from+'_'+report.range.to+'.csv';
 a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function load(){
 const from=$('#fiFrom').value,to=$('#fiTo').value,loadBtn=$('#fiLoad'),status=$('#fiStatus');
 if(!from||!to||from>to){status.textContent='Vui lòng chọn khoảng ngày hợp lệ.';status.className='fi-status is-error';return}
 loadBtn.disabled=true;status.className='fi-status';status.textContent='Đang tổng hợp báo cáo tài chính…';
 try{
  const me=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());
  if(me.role!=='admin'){location.assign('/login');return}
  const response=await fetch('/api/v1/finance/reports/profitability?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),{credentials:'same-origin',cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Không tải được mô hình tài chính.');
  report=data;render();$('#fiContent').hidden=false;$('#fiExport').disabled=false;
  status.textContent='Báo cáo '+from+' → '+to+' · dữ liệu PostgreSQL · chỉ đọc.';
 }catch(error){status.className='fi-status is-error';status.textContent='Lỗi: '+error.message}
 finally{loadBtn.disabled=false}
}

function breakEven(fixed,variablePct,averageTicket){
 if(!Number.isSafeInteger(fixed)||fixed<0||!Number.isFinite(variablePct)||variablePct<0||variablePct>=100||!Number.isSafeInteger(averageTicket)||averageTicket<=0)throw Error('Nhập chi phí cố định từ 0đ, tỷ lệ biến phí dưới 100% và giá trị đơn lớn hơn 0.');
 const contributionRatio=1-variablePct/100;
 const revenue=Math.ceil(fixed/contributionRatio);
 const orders=Math.ceil(revenue/averageTicket);
 if(!Number.isSafeInteger(revenue)||!Number.isSafeInteger(orders))throw Error('Giá trị kịch bản vượt giới hạn an toàn.');
 return {revenue,orders,daily:Math.ceil(orders/30)};
}
$('#fiScenarioForm').addEventListener('submit',event=>{
 event.preventDefault();
 try{
  const results=breakEven(Number($('#fiFixed').value),Number($('#fiVariable').value),Number($('#fiTicket').value));
  $('#fiBreakEvenRevenue').textContent=fmt(results.revenue);
  $('#fiBreakEvenOrders').textContent=new Intl.NumberFormat('vi-VN').format(results.orders);
  $('#fiBreakEvenDaily').textContent=new Intl.NumberFormat('vi-VN').format(results.daily);
  $('#fiScenarioResults').hidden=false;
  $('#fiScenarioNotice').textContent='Kết quả chỉ dựa trên các giả định đã nhập. Không bao gồm thuế, đầu tư hoặc biến động giá vốn ngoài dự kiến.';
 }catch(e){$('#fiScenarioResults').hidden=true;$('#fiScenarioNotice').textContent=e.message}
});

function percentage(value){
 return value===null||value===undefined?'—':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(value)+'%';
}
function tableRow(container,values){
 const tr=document.createElement('tr');
 for(const value of values)tr.append(el('td',null,String(value)));
 container.append(tr);
}
function renderUnitEconomics(info){
 const recipes=$('#fiRecipeRows'),services=$('#fiServiceRows');
 if(!recipes||!services)return;
 recipes.replaceChildren();services.replaceChildren();
 for(const x of info?.recipes||[]){
  tableRow(recipes,[x.name,fmt(x.unitPrice),x.ingredientCount,
   x.configured?fmt(x.estimatedUnitCost):'Chưa đủ dữ liệu',
   x.configured?fmt(x.estimatedUnitContribution):'Chưa đủ dữ liệu',
   x.configured?percentage(x.estimatedMarginPct):'—']);
 }
 if(!recipes.children.length){const tr=el('tr'),td=el('td','fi-empty','Chưa có món đang bán.');td.colSpan=6;tr.append(td);recipes.append(tr)}
 for(const x of info?.services||[]){
  tableRow(services,[x.name,x.quantity,fmt(x.received),
   x.knownDirectCost===0&&x.missingCostReceipts>0?'Chưa đủ dữ liệu':fmt(x.knownDirectCost),
   x.estimatedContribution===null?'Chưa đủ dữ liệu':fmt(x.estimatedContribution),
   percentage(x.estimatedMarginPct),x.missingCostReceipts||'Không']);
 }
 if(!services.children.length){const tr=el('tr'),td=el('td','fi-empty','Chưa có phiếu thu dịch vụ trong kỳ.');td.colSpan=7;tr.append(td);services.append(tr)}
}
async function refreshCostRates(){
 const container=$('#fiRateForms'),status=$('#fiRateStatus');if(!container)return;
 status.textContent='Đang tải định mức...';
 try{
  const response=await fetch('/api/v1/finance/service-costs',{credentials:'same-origin',cache:'no-store'});
  const json=await response.json();
  if(!response.ok)throw Error(json.error||'Không lấy được giá vốn dịch vụ.');
  container.replaceChildren();
  for(const service of json.services||[]){
   const form=el('form','fi-rate-card'),name=el('strong',null,service.name),
    description=el('small',null,(service.sellPrice===null?'Giá bán theo phiếu':('Giá bán '+fmt(service.sellPrice)))+' / '+service.unit);
   const number=el('input');number.type='number';number.min='0';number.max='1000000000';
   number.step='1';number.inputMode='numeric';number.required=true;
   number.placeholder='Chưa nhập giá vốn';number.setAttribute('aria-label','Giá vốn '+service.name);
   if(service.configured)number.value=String(service.unitCost);
   const control=el('div','fi-rate-control'),button=el('button',null,'Lưu định mức');
   button.type='submit';control.append(number,button);
   const hint=el('small','fi-rate-message',service.configured?'Đã cấu hình · Chỉ áp dụng lượt mới':'Chưa cấu hình · Không dùng 0đ mặc định');
   form.append(name,description,control,hint);
   form.addEventListener('submit',async e=>{
    e.preventDefault();button.disabled=true;hint.textContent='Đang lưu...';
    try{
     if(number.value.trim()==='')throw Error('Vui lòng điền định mức.');
     const value=Number(number.value);
     if(!Number.isSafeInteger(value)||value<0||value>1000000000)throw Error('Vui lòng nhập giá vốn nguyên VND từ 0 đến 1 tỷ.');
     const response=await fetch('/api/v1/finance/service-costs',{
      method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({serviceKey:service.key,unitCost:value})
     });
     const data=await response.json();if(!response.ok)throw Error(data.error||'Không lưu được.');
     hint.textContent='Đã lưu '+fmt(data.rate.unitCost)+' / '+service.unit+'. Không đổi phiếu cũ.';
     status.textContent='Đã cập nhật '+service.name+'. Phiếu mới sẽ tự chốt giá vốn này.';
    }catch(error){hint.textContent='Lỗi: '+error.message}finally{button.disabled=false}
   });
   container.append(form);
  }
  status.textContent='Giá vốn dịch vụ là định mức do chủ cửa hàng nhập, không tự trừ tiền mặt.';
 }catch(error){status.textContent='Lỗi tải định mức: '+error.message}
}

async function refreshIngredientCosts(){
 const container=$('#fiIngredientForms'),status=$('#fiIngredientStatus');
 if(!container)return;status.textContent='Đang tải giá vốn nguyên liệu...';
 try{
  const response=await fetch('/api/v1/finance/ingredient-costs',{credentials:'same-origin',cache:'no-store'});
  const json=await response.json();if(!response.ok)throw Error(json.error||'Không lấy được danh sách nguyên liệu.');
  container.replaceChildren();
  for(const ingredient of json.ingredients||[]){
   const form=el('form','fi-rate-card'),name=el('strong',null,ingredient.name),
     description=el('small',null,'Đơn vị '+ingredient.unit+' · Tồn '+ingredient.quantity+' · Giá vốn kho '+fmt(ingredient.purchaseAverageUnitCost));
   const field=el('input');field.type='number';field.step='1';field.min='1';field.max='1000000000';
   field.inputMode='numeric';field.required=true;field.placeholder='Nhập giá vốn / '+ingredient.unit;
   field.setAttribute('aria-label','Giá vốn tham chiếu '+ingredient.name);
   if(ingredient.standardUnitCost!==null)field.value=String(ingredient.standardUnitCost);
   const wrap=el('div','fi-rate-control'),save=el('button',null,'Lưu giá vốn');
   save.type='submit';wrap.append(field,save);
   const clear=el('button','fi-cost-clear','Dùng giá vốn kho');clear.type='button';
   clear.disabled=ingredient.standardUnitCost===null;wrap.append(clear);
   const hint=el('small','fi-rate-message',ingredient.standardUnitCost===null?
     'Hiện đang theo giá vốn kho'+(ingredient.purchaseAverageUnitCost===0?' (chưa có giá)':''):
     'Đang dùng giá vốn tham chiếu · '+fmt(ingredient.standardUnitCost));
   const update=async value=>{
    save.disabled=true;clear.disabled=true;hint.textContent='Đang lưu...';
    try{
     const response=await fetch('/api/v1/finance/ingredient-costs',{method:'PUT',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({ingredientId:ingredient.id,unitCost:value})});
     const updated=await response.json();if(!response.ok)throw Error(updated.error||'Không lưu được.');
     hint.textContent=value===null?'Đã trở về giá vốn nhập kho.':'Đã lưu '+fmt(value)+' / '+ingredient.unit+'. Chỉ áp dụng món mới.';
     if(value===null)field.value='';clear.disabled=value===null;
     status.textContent='Đã cập nhật '+ingredient.name+'. Tải lại báo cáo để xem giá vốn món hiện tại.';
    }catch(error){hint.textContent='Lỗi: '+error.message}finally{save.disabled=false;clear.disabled=value===null}
   };
   form.addEventListener('submit',e=>{
    e.preventDefault();if(!field.value.trim()){hint.textContent='Nhập đơn giá vốn trước khi lưu.';return}
    const value=Number(field.value);
    if(!Number.isSafeInteger(value)||value<1||value>1000000000){hint.textContent='Đơn giá vốn phải là số nguyên 1–1 tỷ VND.';return}
    void update(value);
   });
   clear.addEventListener('click',()=>{if(!clear.disabled)void update(null)});
   form.append(name,description,wrap,hint);container.append(form);
  }
  if(!container.children.length)container.append(el('p','fi-empty','Chưa có nguyên liệu đang kinh doanh.'));
  status.textContent='Giá tham chiếu ghi riêng; phiếu nhập, số lượng tồn và dòng tiền không đổi.';
 }catch(error){status.textContent='Lỗi tải nguyên liệu: '+error.message}
}
$('#fiIngredientsRefresh')?.addEventListener('click',()=>{void refreshIngredientCosts()});
void refreshIngredientCosts();
$('#fiRatesRefresh')?.addEventListener('click',()=>{void refreshCostRates()});
void refreshCostRates();
$('#fiRange').addEventListener('submit',e=>{e.preventDefault();void load()});
$('#fiExport').addEventListener('click',csv);
void load();
