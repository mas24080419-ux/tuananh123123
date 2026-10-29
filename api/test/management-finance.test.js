'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {buildReport,overview,queries}=require('../management-finance');
const seed=()=>({
 cash:[{
  sales:{amount:244000,orders:3,cash:130000,bank:114000},
  ledger:{income:80000,purchases:50000,overhead:30000,cash:20000,bank:60000},
  due:{unpaid_orders:2,unpaid_value:450000},
  costs:{food_cogs:84000,zero_cost_movements:0,valued_lines:3},
  stock:{ingredient_count:6,missing_unit_cost_count:0,stock_value_estimate:120000},
  recipe:{active_items_without_recipe:0},
  cohort:{created_orders:5}
 }],
 services:[{source:'locker',transactions:2,amount:60000},{source:'float',transactions:1,amount:20000}],
 expenses:[{type:'stock_purchase',category:'Nhập nguyên liệu',amount:50000,transactions:1},
           {type:'other_expense',category:'Điện nước',amount:30000,transactions:1}],
 trend:[{period:'2026-10-26',incoming:324000,outgoing:80000}],
 products:[{name:'Dừa xiêm',category:'Đồ uống',quantity:4,line_sales:244000,ingredient_cost:84000,missing_consumption_lines:0}],
 due:[{id:'11111111-1111-4111-8111-111111111111',table_name:'Bàn 02',created_at:'2026-10-26T05:00:00Z',unpaid_amount:450000}]
});
test('cashflow separates paid orders, service receipts, inventory purchases, operating costs and COGS',()=>{
 const r=buildReport(seed(),'2026-10-01','2026-10-29');
 assert.equal(r.summary.cashIn,324000);
 assert.equal(r.summary.cashOut,80000);
 assert.equal(r.summary.netCashflow,244000);
 assert.equal(r.summary.foodCogsEstimate,84000);
 assert.equal(r.summary.contributionEstimate,210000);
 assert.equal(r.summary.stockPurchases,50000);
 assert.equal(r.summary.otherExpenses,30000);
 assert.equal(r.summary.cashReceived,150000);
 assert.equal(r.summary.bankReceived,174000);
 assert.equal(r.summary.unpaidAmount,450000);
 assert.equal(r.revenueSegments.find(x=>x.source==='locker').amount,60000);
 assert.equal(r.revenueSegments.find(x=>x.source==='float').amount,20000);
 assert.equal(r.summary.profitVerified,false);
 assert.equal(r.quality.paidLineValueMismatch,false);
});
test('quality gate flags uncosted stock movements and recipes; never claims audited profit',()=>{
 const t=seed();
 t.cash[0].costs.zero_cost_movements=4;
 t.cash[0].stock.missing_unit_cost_count=5;
 t.cash[0].recipe.active_items_without_recipe=2;
 t.products[0].missing_consumption_lines=1;
 const r=buildReport(t,'2026-10-01','2026-10-29');
 assert.equal(r.quality.level,'incomplete');
 assert.equal(r.quality.costCoverageIncomplete,true);
 assert.equal(r.summary.reliableProfit,null);
 assert(r.quality.issues.some(x=>x.text.includes('5 nguyên liệu')));
 assert(r.quality.issues.some(x=>x.text.includes('chưa liên kết xuất kho')));
});
test('mismatch between paid amount and current lines is marked for review',()=>{
 const t=seed();t.products[0].line_sales=200000;
 const r=buildReport(t,'2026-10-01','2026-10-29');
 assert.equal(r.quality.paidLineValueMismatch,true);
 assert(r.quality.issues.some(x=>x.text.includes('khác số tiền thực thu')));
});
test('refuses silent unsafe integer truncation and requests over allowed period',async()=>{
 const t=seed();t.cash[0].sales.amount='9007199254740993';
 assert.throws(()=>buildReport(t,'2026-10-01','2026-10-29'),/giới hạn/);
 const pool={query(){throw Error('Should not reach DB')}};
 await assert.rejects(()=>overview(pool,'2025-01-01','2026-10-29'),e=>e.status===400);
 await assert.rejects(()=>overview(pool,'2026-10-30','2026-10-29'),e=>e.status===400);
});
test('all finance queries read only, use bound local date filters, and keep stock buying separate from cost',()=>{
 for(const [name,sql] of Object.entries(queries)){
  assert.match(sql,/BETWEEN \$1::date AND \$2::date/,'Date filter '+name);
  assert.doesNotMatch(sql,/\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
 }
 assert(queries.cash.includes("v.kind IN ('consume','restore')"));
 assert(queries.cash.includes("source='stock_purchase'"));
});
test('finance page has protected API and mobile navigation',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const staticCode=fs.readFileSync(path.join(__dirname,'../static-files.js'),'utf8');
 const side=fs.readFileSync(path.join(__dirname,'../public/pos-sidebar.js'),'utf8');
 const markup=fs.readFileSync(path.join(__dirname,'../public/financial-intelligence.html'),'utf8');
 assert(server.includes("p==='/api/admin/financial-model'"));
 assert(server.includes("if(!await requireAdmin(req,res))return"));
 assert(staticCode.includes("['/admin/financial-intelligence', 'financial-intelligence.html']"));
 assert(side.includes("link('/admin/financial-intelligence','Phân tích tài chính','chart')"));
 assert(markup.includes('id="fiQuality"'));
 assert(markup.includes('id="fiScenarioForm"'));
});

test('financial dashboard JavaScript compiles without requiring browser runtime',()=>{
 const vm=require('node:vm');
 const client=fs.readFileSync(path.join(__dirname,'../public/financial-intelligence.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(client,{filename:'financial-intelligence.js'}));
 assert(client.includes("r.quality.level==='incomplete'?'Chưa đủ dữ liệu'"),'Incomplete cost must not show a profit number');
 assert(client.includes("function breakEven("),'Scenario model must be present');
});
