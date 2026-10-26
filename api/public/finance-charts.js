/* Shared Tắm Tráng 6 SVG charts — no external chart service and no mock amounts. */
(function(){
 'use strict';
 const palette=['#118c83','#f19c5b','#4e79ad','#8c77bb','#d26479','#7d99a7','#f3c36c','#579c70','#af8882','#7a9cbd'];
 const format=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(n)||0)+' đ';
 const count=n=>Number(n)||0;
 const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const svgEl=tag=>document.createElementNS('http://www.w3.org/2000/svg',tag);
 function placeholder(container,message){
  container.replaceChildren(el('p','tt6-chart-empty',message));
 }
 function legendRow(name,value,total,color,isButton){
  const row=el(isButton?'button':'div','tt6-chart-legend-row');
  if(isButton)row.type='button';
  const swatch=el('i','tt6-chart-swatch');swatch.style.background=color;
  row.append(swatch,el('span','tt6-chart-legend-name',name),
   el('strong','tt6-chart-legend-value',format(value)),
   el('small','tt6-chart-legend-pct',total>0?Math.round(100*value/total)+'%':'0%'));
  return row;
 }
 function donut(container,raw,options={}){
  if(!container)return;
  const data=(Array.isArray(raw)?raw:[]).map(d=>({name:String(d.name||'Khác'),value:Math.max(0,count(d.amount))})).filter(d=>d.value>0);
  if(!data.length){placeholder(container,'Chưa có số liệu thực tế trong kỳ đã chọn.');return}
  data.sort((a,b)=>b.value-a.value);
  const total=data.reduce((sum,d)=>sum+d.value,0);
  container.replaceChildren();
  const layout=el('div','tt6-donut-layout'),visual=el('div','tt6-donut-visual');
  const svg=svgEl('svg');svg.setAttribute('viewBox','0 0 220 220');svg.setAttribute('role','img');
  svg.setAttribute('aria-label',options.title||'Biểu đồ tròn phân bổ theo danh mục');
  const background=svgEl('circle');background.setAttribute('cx',110);background.setAttribute('cy',110);background.setAttribute('r',78);
  background.setAttribute('fill','none');background.setAttribute('stroke','#e7f0f0');background.setAttribute('stroke-width',29);svg.append(background);
  const perimeter=2*Math.PI*78;let used=0;
  for(let i=0;i<data.length;i++){
   const item=data[i],distance=perimeter*item.value/total;
   const arc=svgEl('circle');arc.setAttribute('cx',110);arc.setAttribute('cy',110);arc.setAttribute('r',78);
   arc.setAttribute('fill','none');arc.setAttribute('stroke',palette[i%palette.length]);
   arc.setAttribute('stroke-width',29);arc.setAttribute('stroke-dasharray',String(Math.max(0,distance-.9))+' '+String(perimeter));
   arc.setAttribute('stroke-dashoffset',String(-used));
   arc.setAttribute('transform','rotate(-90 110 110)');svg.append(arc);used+=distance;
  }
  const totalLabel=el('div','tt6-donut-center');
  totalLabel.append(el('small',null,options.totalLabel||'TỔNG'),el('strong',null,format(total)));
  visual.append(svg,totalLabel);
  const legend=el('div','tt6-chart-legend');
  const transactions=Array.isArray(options.transactions)?options.transactions:[];
  const detail=options.drilldown?el('div','tt6-expense-detail'):null;
  const showRecords=category=>{
   if(!detail)return;
   detail.replaceChildren(el('strong',null,'Chi tiết: '+category));
   const subset=transactions.filter(d=>d.category===category).slice(0,8);
   if(!subset.length){detail.append(el('p',null,'Không có giao dịch gần đây trong danh mục này.'));return}
   for(const tx of subset){
    const row=el('div','tt6-expense-detail-row');
    const stamp=tx.created_at?new Date(tx.created_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'';
    const left=el('span',null,stamp+(tx.note?' · '+String(tx.note):''));
    row.append(left,el('b',null,format(tx.amount)));detail.append(row);
   }
   if(transactions.filter(d=>d.category===category).length>8)detail.append(el('small',null,'Hiển thị 8 giao dịch mới nhất; xem sổ thu–chi để biết thêm.'));
  };
  data.forEach((d,i)=>{
   const row=legendRow(d.name,d.value,total,palette[i%palette.length],!!detail);
   if(detail)row.addEventListener('click',()=>{
    legend.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
    row.setAttribute('aria-pressed','true');
    showRecords(d.name);
   });
   legend.append(row);
  });
  layout.append(visual,legend);container.append(layout);
  if(detail){container.append(detail);const first=legend.querySelector('button');if(first){first.setAttribute('aria-pressed','true');showRecords(data[0].name)}}
 }
 function trend(container,series,granularity){
  if(!container)return;
  container.replaceChildren();
  const rows=Array.isArray(series)?series:[];
  if(!rows.length||rows.every(d=>!count(d.inflow)&&!count(d.outflow))){placeholder(container,'Chưa phát sinh khoản tiền vào hoặc tiền ra trong kỳ đã chọn.');return}
  const highest=Math.max(1,...rows.flatMap(d=>[count(d.inflow),count(d.outflow)]));
  const scroll=el('div','tt6-trend-scroll'),chart=el('div','tt6-trend-bars');
  chart.style.setProperty('--tt6-period-count',String(rows.length));
  const details=el('div','tt6-trend-inspect','Chạm vào một cặp cột để xem chi tiết.');
  const dateLabel=period=>{
   const p=String(period||'');
   return granularity==='month'?p.slice(5,7)+'/'+p.slice(0,4):p.slice(8,10)+'/'+p.slice(5,7);
  };
  rows.forEach((r,index)=>{
   const a=count(r.inflow),b=count(r.outflow),difference=a-b;
   const slot=el('button','tt6-trend-period');
   slot.type='button';
   slot.setAttribute('aria-label',dateLabel(r.period)+': thu '+format(a)+', chi '+format(b)+', chênh lệch '+format(difference));
   const bars=el('span','tt6-trend-pair');
   const bi=el('i','tt6-trend-bar is-income'),bo=el('i','tt6-trend-bar is-outgoing');
   bi.style.height=(a?Math.max(3,Math.round(a/highest*145)):0)+'px';
   bo.style.height=(b?Math.max(3,Math.round(b/highest*145)):0)+'px';
   bars.append(bi,bo);slot.append(bars,el('small',null,dateLabel(r.period)));
   slot.addEventListener('click',()=>{
    chart.querySelectorAll('button').forEach(x=>x.classList.remove('is-selected'));
    slot.classList.add('is-selected');
    details.textContent=dateLabel(r.period)+' · Thu '+format(a)+' · Chi '+format(b)+' · Dòng tiền '+format(difference);
   });
   if(index===rows.length-1){slot.classList.add('is-selected');details.textContent=dateLabel(r.period)+' · Thu '+format(a)+' · Chi '+format(b)+' · Dòng tiền '+format(difference)}
   chart.append(slot);
  });
  scroll.append(chart);
  container.append(scroll,details);
 }
 window.TT6FinanceCharts={donut,trend,format};
})();
