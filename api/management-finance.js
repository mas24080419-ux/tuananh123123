'use strict';
// SalesHub Financial Intelligence V1 — owner-only, read-only managerial accounting.
// Basis: actual cash collections; purchases are cash outflows, not period COGS.
// COGS uses the historical unit_cost on stock consumption/restore movements,
// matched to fully paid orders at their settlement date.
const unitEconomics=require('./unit-economics');
const TZONE='Asia/Ho_Chi_Minh';
const day="(paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";
const ledgerDay="(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";
const queries={
 cash:`WITH sales AS (
  SELECT COALESCE(SUM(paid_amount),0)::bigint amount,
         COUNT(*)::int orders,
         COALESCE(SUM(paid_amount) FILTER(WHERE payment_method='cash'),0)::bigint cash,
         COALESCE(SUM(paid_amount) FILTER(WHERE payment_method='bank_transfer'),0)::bigint bank
  FROM dining_orders WHERE payment_status='paid' AND paid_at IS NOT NULL
   AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ), ledger AS (
  SELECT COALESCE(SUM(amount) FILTER(WHERE direction='income'),0)::bigint income,
         COALESCE(SUM(amount) FILTER(WHERE direction='expense' AND source='stock_purchase'),0)::bigint purchases,
         COALESCE(SUM(amount) FILTER(WHERE direction='expense' AND source<>'stock_purchase'),0)::bigint overhead,
         COALESCE(SUM(amount) FILTER(WHERE direction='income' AND payment_method='cash'),0)::bigint cash,
         COALESCE(SUM(amount) FILTER(WHERE direction='income' AND payment_method='bank_transfer'),0)::bigint bank
  FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ), due AS (
  SELECT COUNT(*)::int unpaid_orders,
         COALESCE(SUM((SELECT COALESCE(SUM(l.quantity*l.unit_price) FILTER(WHERE l.status<>'cancelled'),0) FROM dining_order_lines l WHERE l.order_id=o.id)),0)::bigint unpaid_value
  FROM dining_orders o WHERE o.payment_status='unpaid'
   AND (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ), costs AS (
  SELECT COALESCE(SUM(-v.delta*v.unit_cost),0)::bigint food_cogs,
         COUNT(*) FILTER(WHERE v.kind='consume' AND v.unit_cost=0)::int zero_cost_movements,
         COUNT(DISTINCT v.order_line_id) FILTER(WHERE v.kind='consume')::int valued_lines
  FROM inventory_movements v JOIN dining_order_lines l ON l.id=v.order_line_id
  JOIN dining_orders o ON o.id=l.order_id
  WHERE v.kind IN ('consume','restore') AND o.payment_status='paid' AND o.paid_at IS NOT NULL
    AND (o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 ), stock AS (
  SELECT COUNT(*)::int ingredient_count,
         COUNT(*) FILTER(WHERE avg_unit_cost=0)::int missing_unit_cost_count,
         COALESCE(SUM(quantity*avg_unit_cost),0)::bigint stock_value_estimate
  FROM inventory_items WHERE active=true
 ), recipe AS (
  SELECT COUNT(*)::int active_items_without_recipe
  FROM menu_items m WHERE active=true
    AND NOT EXISTS(SELECT 1 FROM inventory_recipes r WHERE r.menu_item_id=m.id)
 ), cohort AS (
  SELECT COUNT(*)::int created_orders,
   COALESCE(SUM(CASE WHEN payment_status='unpaid' THEN 0 ELSE 1 END),0)::int no_longer_unpaid
  FROM dining_orders WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 )
 SELECT row_to_json(sales) sales,row_to_json(ledger) ledger,row_to_json(due) due,
        row_to_json(costs) costs,row_to_json(stock) stock,row_to_json(recipe) recipe,row_to_json(cohort) cohort
 FROM sales,ledger,due,costs,stock,recipe,cohort`,
 services:`SELECT CASE WHEN lr.id IS NOT NULL THEN 'locker'
                    WHEN ar.service='float' THEN 'float'
                    WHEN ar.service='restroom' THEN 'restroom'
                    WHEN ar.id IS NOT NULL THEN 'other_service'
                    ELSE 'other_income' END AS source,
         COUNT(*)::int transactions,COALESCE(SUM(f.amount),0)::bigint amount
 FROM finance_entries f
 LEFT JOIN locker_rentals lr ON lr.finance_entry_id=f.id
 LEFT JOIN area_receipts ar ON ar.finance_entry_id=f.id
 WHERE f.direction='income' AND (f.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY 1 ORDER BY amount DESC`,
 expenses:`SELECT CASE WHEN source='stock_purchase' THEN 'stock_purchase' ELSE 'other_expense' END AS type,
       category,COUNT(*)::int transactions,COALESCE(SUM(amount),0)::bigint amount
 FROM finance_entries WHERE direction='expense'
 AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY 1,2 ORDER BY amount DESC`,
 trend:`WITH flows AS (
  SELECT (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS flow_day,COALESCE(paid_amount,0)::bigint incoming,0::bigint outgoing
  FROM dining_orders WHERE payment_status='paid' AND paid_at IS NOT NULL
  AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
  UNION ALL
  SELECT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS flow_day,
  (CASE WHEN direction='income' THEN amount ELSE 0 END)::bigint,
  (CASE WHEN direction='expense' THEN amount ELSE 0 END)::bigint
  FROM finance_entries WHERE (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 )
 SELECT to_char(date_trunc($3::text,flow_day::timestamp),'YYYY-MM-DD') period,
        COALESCE(SUM(incoming),0)::bigint incoming,COALESCE(SUM(outgoing),0)::bigint outgoing
 FROM flows GROUP BY 1 ORDER BY 1`,
 products:`SELECT l.name,m.category,COALESCE(SUM(l.quantity),0)::int quantity,
        COALESCE(SUM(l.quantity*l.unit_price),0)::bigint line_sales,
        COALESCE(SUM(c.cost),0)::bigint ingredient_cost,
        COUNT(*) FILTER(WHERE c.has_consumption=0)::int missing_consumption_lines
 FROM dining_order_lines l
 JOIN dining_orders o ON o.id=l.order_id
 LEFT JOIN menu_items m ON m.id=l.menu_item_id
 LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(-v.delta*v.unit_cost),0)::bigint cost,
         COUNT(*) FILTER(WHERE v.kind='consume')::int has_consumption
  FROM inventory_movements v WHERE v.order_line_id=l.id AND v.kind IN ('consume','restore')
 ) c ON true
 WHERE o.payment_status='paid' AND o.paid_at IS NOT NULL AND l.status<>'cancelled'
 AND (o.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY l.name,m.category ORDER BY line_sales DESC LIMIT 30`,
 due:`SELECT o.id,t.name table_name,o.created_at,
   COALESCE(SUM(l.quantity*l.unit_price) FILTER(WHERE l.status<>'cancelled'),0)::bigint unpaid_amount
 FROM dining_orders o JOIN dining_tables t ON t.id=o.table_id
 LEFT JOIN dining_order_lines l ON l.order_id=o.id
 WHERE o.payment_status='unpaid'
 AND (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
 GROUP BY o.id,t.name,o.created_at ORDER BY o.created_at DESC LIMIT 12`
};
function integer(v){const n=Number(v??0);if(!Number.isSafeInteger(n))throw Error('Số liệu tài chính vượt giới hạn tính toán an toàn.');return n}
const sum=(array,key)=>array.reduce((a,x)=>a+integer(x[key]),0);
function buildReport(raw,from,to){
 const base=raw.cash[0]||{},sale=base.sales||{},ledger=base.ledger||{},due=base.due||{},cost=base.costs||{},stock=base.stock||{},recipe=base.recipe||{},cohort=base.cohort||{};
 const receivedFood=integer(sale.amount),income=integer(ledger.income),paidPurchase=integer(ledger.purchases),otherExpense=integer(ledger.overhead);
 const cashIn=receivedFood+income,cashOut=paidPurchase+otherExpense,estimatedCogs=integer(cost.food_cogs);
 const ingredientsMissing=integer(stock.missing_unit_cost_count),recipeMissing=integer(recipe.active_items_without_recipe);
 const zeroMoves=integer(cost.zero_cost_movements);
 const sales=raw.products.map(r=>({name:r.name,category:r.category||'Khác',quantity:integer(r.quantity),
  lineSales:integer(r.line_sales),ingredientCost:integer(r.ingredient_cost),
  missingConsumptionLines:integer(r.missing_consumption_lines)}));
 const missingSoldMovements=sales.reduce((n,p)=>n+p.missingConsumptionLines,0);
 const coverageIncomplete=ingredientsMissing>0||zeroMoves>0||recipeMissing>0||missingSoldMovements>0;
 const productTotals=sum(sales,'lineSales'),revenueMismatch=productTotals!==receivedFood;
 const flags=[];
 if(ingredientsMissing>0)flags.push({level:'critical',text:ingredientsMissing+' nguyên liệu hoạt động chưa có đơn giá vốn; lãi gộp có thể bị ghi cao.'});
 if(recipeMissing>0)flags.push({level:'critical',text:recipeMissing+' món đang bán chưa có định mức nguyên liệu; chưa thể tính giá vốn đầy đủ.'});
 if(zeroMoves>0)flags.push({level:'warning',text:zeroMoves+' lượt xuất kho trong đơn đã thu tiền có giá vốn 0đ.'});
 if(missingSoldMovements>0)flags.push({level:'warning',text:missingSoldMovements+' dòng món đã thanh toán chưa liên kết xuất kho nguyên liệu.'});
 if(revenueMismatch&&integer(sale.orders)>0)flags.push({level:'warning',text:'Tổng giá trị món hiện tại khác số tiền thực thu; có thể do điều chỉnh/hủy món sau thanh toán hoặc chênh lệch hóa đơn.'});
 if(integer(due.unpaid_orders)>0)flags.push({level:'info',text:integer(due.unpaid_orders)+' đơn tạo trong kỳ vẫn chưa xác nhận thanh toán.'});
 if(raw.expenses.some(x=>x.type==='other_expense'))flags.push({level:'info',text:'Chi phí nhập thủ công chưa được phân loại kế toán thành chi phí, đầu tư, thuế hoặc khoản vay.'});
 const grossEstimate=receivedFood-estimatedCogs;
 const operatingResult=grossEstimate+income-otherExpense;
 const trend=raw.trend.map(x=>({period:String(x.period),incoming:integer(x.incoming),outgoing:integer(x.outgoing),net:integer(x.incoming)-integer(x.outgoing)}));
 const segments=[{name:'Món ăn & đồ uống',source:'dining',amount:receivedFood,transactions:integer(sale.orders)},...raw.services.map(s=>({
  name:({locker:'Tủ đồ',float:'Phao bơi',restroom:'Tắm tráng / vệ sinh',other_service:'Dịch vụ khác',other_income:'Thu khác chưa phân loại'})[s.source]||s.source,
  source:s.source,amount:integer(s.amount),transactions:integer(s.transactions)
 }))];
 return {
  version:'finance-management-v1',accountingBasis:'cash_settlement_with_ingredient_cost_proxy',range:{from,to},
  summary:{cashIn,cashOut,netCashflow:cashIn-cashOut,foodReceived:receivedFood,serviceAndOtherIncome:income,
   settledOrders:integer(sale.orders),foodCogsEstimate:estimatedCogs,stockPurchases:paidPurchase,
   otherExpenses:otherExpense,contributionEstimate:operatingResult,
   reliableProfit:null,
   profitVerified:false,unpaidOrders:integer(due.unpaid_orders),unpaidAmount:integer(due.unpaid_value),
   cashReceived:integer(sale.cash)+integer(ledger.cash),bankReceived:integer(sale.bank)+integer(ledger.bank),
   inventoryValueEstimate:integer(stock.stock_value_estimate),
   ingredientCount:integer(stock.ingredient_count),missingCostCount:ingredientsMissing,
   itemsMissingRecipe:recipeMissing,createdOrders:integer(cohort.created_orders)
  },
  quality:{level:coverageIncomplete||revenueMismatch?'incomplete':'provisional',issues:flags,
   costCoverageIncomplete:coverageIncomplete,paidLineValueMismatch:revenueMismatch,
   caveat:'Đây là báo cáo quản trị theo tiền đã thu; giá vốn từ lịch sử xuất kho. Không phải báo cáo lợi nhuận kế toán/thuế đã kiểm toán. Chưa tính đủ công nợ, khấu hao, thuế và mọi chi phí chưa ghi sổ.'},
  revenueSegments:segments,expenses:raw.expenses.map(x=>({name:x.category,type:x.type,amount:integer(x.amount),transactions:integer(x.transactions)})),
  products:sales.map(x=>({...x,contributionEstimate:x.lineSales-x.ingredientCost})),
  trend,unpaidRecent:raw.due.map(x=>({id:x.id,table:x.table_name,createdAt:x.created_at,amount:integer(x.unpaid_amount)})),
  asOf:new Date().toISOString()
 };
}
async function overview(pool,from,to){
 if(!pool)throw Object.assign(Error('Báo cáo yêu cầu PostgreSQL.'),{status:503});
 const fromDate=Date.parse(from+'T00:00:00Z'),toDate=Date.parse(to+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(fromDate)||!Number.isFinite(toDate)||toDate<fromDate||(toDate-fromDate)/86400000>366)throw Object.assign(Error('Khoảng báo cáo không hợp lệ hoặc vượt 367 ngày.'),{status:400});
 const span=(toDate-fromDate)/86400000,interval=span>45?'month':'day';
 const [cash,services,expenses,trend,products,due]=await Promise.all([
  pool.query(queries.cash,[from,to]),pool.query(queries.services,[from,to]),pool.query(queries.expenses,[from,to]),
  pool.query(queries.trend,[from,to,interval]),pool.query(queries.products,[from,to]),pool.query(queries.due,[from,to])
 ]);
 const report=buildReport({cash:cash.rows,services:services.rows,expenses:expenses.rows,trend:trend.rows,products:products.rows,due:due.rows},from,to);
 report.range.granularity=interval;
 report.unitEconomics=await unitEconomics.overview(pool,from,to);
 if(report.unitEconomics.quality.uncostedMenuItems>0){
  report.quality.issues.push({level:'warning',text:report.unitEconomics.quality.uncostedMenuItems+' món đang bán chưa đủ định mức/giá nguyên liệu hiện tại.'});
  report.quality.level='incomplete';
 }
 if(report.unitEconomics.quality.uncostedServiceReceipts>0){
  report.quality.issues.push({level:'warning',text:report.unitEconomics.quality.uncostedServiceReceipts+' phiếu dịch vụ trong kỳ chưa có định mức giá vốn tại thời điểm bán.'});
  report.quality.level='incomplete';
 }
 return report;
}
module.exports={overview,buildReport,queries};
