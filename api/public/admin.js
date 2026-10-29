'use strict';
let latest=null,loading=false;
function renderFinanceAnalytics(report){
 if(!report||report.error||!window.TT6FinanceCharts){
  const msg=report?.error||'Chưa tải được thư viện biểu đồ.';
  for(const id of ['#faExpensePie','#faPaymentPie','#faCashBars'])$(id).textContent='Không thể tải báo cáo: '+msg;
  return;
 }
 const ch=window.TT6FinanceCharts;
 ch.donut($('#faExpensePie'),report.expense_categories.map(x=>({name:x.name,amount:x.amount})),
    {title:'Tỷ trọng chi phí theo danh mục',totalLabel:'TỔNG CHI',drilldown:false});
 ch.donut($('#faPaymentPie'),report.payment_methods,
    {title:'Cơ cấu phương thức tiền thực thu',totalLabel:'ĐÃ NHẬN'});
 ch.trend($('#faCashBars'),report.series,report.range.granularity);
}
async function reload(){
 if(loading)return;
 loading=true;
 try{
 const params=new URLSearchParams({from:$('#from').value,to:$('#to').value});
 const analyticsReport=await request('/api/finance/reports/analytics?'+params.toString());
 renderFinanceAnalytics(analyticsReport);
 notice('Đã cập nhật biểu đồ · '+new Date().toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}));
 }catch(e){notice(e.message,'error');if(e.status===401||e.status===403)screen(false)}
 finally{loading=false}
}
setupOwnerShared(reload,()=>{latest=null});
