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
  for(const value of [x.name,x.quantity,fmt(x.lineSales),fmt(x.ingredientCost),fmt(x.contributionEstimate),x.missingConsumptionLines?'Có ('+x.missingConsumptionLines+')':'—'])
   row.append(el('td',null,String(value)));
  products.append(row);
 }
 if(!r.products.length){const row=el('tr'),cell=el('td','fi-empty','Chưa có món thuộc đơn đã thanh toán trong kỳ.');cell.colSpan=6;row.append(cell);products.append(row)}
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
  ['Món','Số lượng','Doanh thu','Giá vốn','Chênh lệch sơ bộ'],...report.products.map(x=>[x.name,x.quantity,x.lineSales,x.ingredientCost,x.contributionEstimate])];
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
  const me=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());
  if(me.role!=='admin'){location.assign('/login');return}
  const response=await fetch('/api/admin/financial-model?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),{credentials:'same-origin',cache:'no-store'});
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
$('#fiRange').addEventListener('submit',e=>{e.preventDefault();void load()});
$('#fiExport').addEventListener('click',csv);
void load();
