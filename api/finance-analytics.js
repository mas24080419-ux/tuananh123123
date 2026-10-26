'use strict';
// Finance analytics draws only from confirmed settlements and actual cash ledger.
// Never count unpaid QR orders or double-count stock purchases from movements.
module.exports=function financeAnalytics({pool}){
 const totalsSQL=`WITH pay AS (
 SELECT coalesce(paid_amount,0)::bigint amount FROM dining_orders
 WHERE payment_status='paid' AND paid_at IS NOT NULL
 AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ), f AS (
 SELECT amount,direction FROM finance_entries
 WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 )
 SELECT coalesce((SELECT sum(amount) FROM pay),0)::bigint sales,
 coalesce((SELECT sum(amount) FROM f WHERE direction='income'),0)::bigint other_income,
 coalesce((SELECT sum(amount) FROM pay),0)::bigint+coalesce((SELECT sum(amount) FROM f WHERE direction='income'),0)::bigint inflow,
 coalesce((SELECT sum(amount) FROM f WHERE direction='expense'),0)::bigint outflow,
 coalesce((SELECT sum(amount) FROM pay),0)::bigint+
 coalesce((SELECT sum(amount) FROM f WHERE direction='income'),0)::bigint-
 coalesce((SELECT sum(amount) FROM f WHERE direction='expense'),0)::bigint net,
 (SELECT count(*)::int FROM pay) settled_orders`;
 const expenseSQL=`SELECT CASE WHEN source='stock_purchase' THEN 'Nhập nguyên liệu' ELSE category END AS category,
 sum(amount)::bigint amount,count(*)::int transactions
 FROM finance_entries WHERE direction='expense' AND
 (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY 1 ORDER BY amount DESC,category`;
 const paymentSQL=`SELECT coalesce(payment_method,'unknown') method,sum(amount)::bigint amount
 FROM (
 SELECT payment_method,coalesce(paid_amount,0)::bigint amount
 FROM dining_orders WHERE payment_status='paid' AND paid_at IS NOT NULL
 AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 UNION ALL
 SELECT payment_method,amount::bigint FROM finance_entries WHERE direction='income'
 AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ) x GROUP BY 1 ORDER BY amount DESC`;
 const seriesSQL=`WITH e AS (
 SELECT paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh' local_at,
 coalesce(paid_amount,0)::bigint sales,0::bigint other_income,0::bigint outflow
 FROM dining_orders WHERE payment_status='paid' AND paid_at IS NOT NULL
 AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 UNION ALL
 SELECT created_at AT TIME ZONE 'Asia/Ho_Chi_Minh',
 0::bigint,CASE WHEN direction='income' THEN amount ELSE 0 END::bigint,
 CASE WHEN direction='expense' THEN amount ELSE 0 END::bigint
 FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 BETWEEN $1::date AND $2::date
 )
 SELECT to_char(date_trunc($3::text,local_at),'YYYY-MM-DD') period,
 sum(sales)::bigint sales,sum(other_income)::bigint other_income,sum(outflow)::bigint outflow
 FROM e GROUP BY 1 ORDER BY 1`;
 const recentSQL=`SELECT id,created_at,category,source,amount,note
 FROM finance_entries WHERE direction='expense' AND
 (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ORDER BY created_at DESC LIMIT 120`;
 const stockSQL=`SELECT count(*) FILTER (WHERE quantity<=reorder_level)::int low_stock_count,
 coalesce(sum(quantity*avg_unit_cost),0)::bigint stock_value_estimate
 FROM inventory_items WHERE active=true`;
 function periods(from,to,granularity){
  const result=[],date=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
  if(granularity==='month')date.setUTCDate(1);
  while(date<=end){
   result.push(date.toISOString().slice(0,10));
   if(granularity==='month')date.setUTCMonth(date.getUTCMonth()+1);
   else date.setUTCDate(date.getUTCDate()+1);
   if(result.length>370)throw Error('Too many analytics periods');
  }
  return result;
 }
 const amount=v=>{const n=Number(v||0);return Number.isSafeInteger(n)&&n>=0?n:0};
 async function overview(from,to){
  if(!pool){const e=Error('Báo cáo phân tích yêu cầu PostgreSQL, không có dữ liệu mô phỏng.');e.status=503;throw e}
  const span=Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
  const granularity=span>45?'month':'day',bounds=[from,to];
  const [totals,expenses,payments,series,recent,stock]=await Promise.all([
   pool.query(totalsSQL,bounds),pool.query(expenseSQL,bounds),pool.query(paymentSQL,bounds),
   pool.query(seriesSQL,[from,to,granularity]),pool.query(recentSQL,bounds),pool.query(stockSQL)
  ]);
  const t=totals.rows[0]||{},inv=stock.rows[0]||{};
  const byPeriod=new Map(series.rows.map(r=>[r.period,r]));
  const trend=periods(from,to,granularity).map(period=>{
   const r=byPeriod.get(period)||{},sales=amount(r.sales),other=amount(r.other_income),outflow=amount(r.outflow);
   return {period,sales,other_income:other,inflow:sales+other,outflow,net_cashflow:sales+other-outflow};
  });
  const expense_categories=expenses.rows.map(r=>({name:r.category,amount:amount(r.amount),count:Number(r.transactions||0)}));
  const paymentLabel={cash:'Tiền mặt',bank_transfer:'Chuyển khoản',unknown:'Chưa xác định (đơn cũ)'};
  const payment_methods=payments.rows.map(r=>({name:paymentLabel[r.method]||'Khác',amount:amount(r.amount)}));
  const summary={sales_received:amount(t.sales),other_income:amount(t.other_income),
   total_in:amount(t.inflow),total_out:amount(t.outflow),net_cashflow:Number(t.net||0),
   settled_orders:Number(t.settled_orders||0),low_stock_count:Number(inv.low_stock_count||0),
   stock_value_estimate:amount(inv.stock_value_estimate)};
  return {mode:'postgres',range:{from,to,granularity},summary,expense_categories,payment_methods,
   series:trend,expense_transactions:recent.rows.map(r=>({
     id:r.id,created_at:r.created_at,category:r.source==='stock_purchase'?'Nhập nguyên liệu':r.category,
     amount:amount(r.amount),note:r.note||''
   })),as_of:new Date().toISOString(),
   caveat:'Dòng tiền thuần = tiền thực thu + thu khác − chi vận hành và nhập hàng. Không phải lợi nhuận kế toán.'};
 }
 return {overview};
};
