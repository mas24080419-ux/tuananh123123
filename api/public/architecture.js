(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const iconPaths={
 client:'<circle cx="12" cy="7" r="3"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 gateway:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18m-11 5h4"/>',
 module:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 storage:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>',
 observe:'<path d="M3 20V10m6 10V4m6 16v-8m6 8v-6"/>',
 external:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-6 5h4"/>'
 };
 const icon=group=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(iconPaths[group]||iconPaths.module)+'</svg>';
 const appLinks={owner:'/admin',stafforder:'/staff/orders',orders:'/admin/orders',kds:'/staff',inventory:'/admin/inventory',finance:'/admin/operations',rental:'/staff/lockers',backoffice:'/admin/core'};
 const baseW=1440,baseH=825,modelState={model:null,monitor:null,filter:'all',selected:null,scale:.7,refreshing:false};
 let initialized=false;
 const groupNames={client:'ĐẦU VÀO',gateway:'ỨNG DỤNG / TRUY CẬP',module:'MÔ-ĐUN XỬ LÝ',storage:'POSTGRESQL',observe:'NHẬT KÝ',external:'QUY TRÌNH THANH TOÁN'};
 const formatNumber=value=>value===null||value===undefined?'—':new Intl.NumberFormat('vi-VN').format(Number(value)||0);
 const nodeById=id=>modelState.model?.nodes.find(n=>n.id===id);
 const edgeById=id=>modelState.model?.edges.find(e=>e.id===id);
 const activeGroups=()=>modelState.filter==='all'?null:new Set(
  modelState.filter==='dining'?['dining','ingress']:
   modelState.filter==='stafforder'?['stafforder','access','inventory','dining','finance']:
  modelState.filter==='access'?['access','ingress']:
  modelState.filter==='finance'?['finance','access']:
  modelState.filter==='rental'?['rental','access']:
  modelState.filter==='audit'?['audit']: [modelState.filter]
 );
 const relevantEdges=()=>modelState.model.edges.filter(e=>{
  const groups=activeGroups();
  return !groups||groups.has(e.group);
 });
 const nodeActiveSet=()=>new Set(relevantEdges().flatMap(e=>[e.from,e.to]));
 function flowColor(id){
  return modelState.model.flows.find(f=>f.id===id)?.color||'#9ab4d6';
 }
 function edgePath(edge){
  const a=nodeById(edge.from),b=nodeById(edge.to);
  if(!a||!b)return '';
  if(b.x>=a.x+a.w+16){
   const x1=a.x+a.w,y1=a.y+51,x2=b.x,y2=b.y+51;
   const bend=Math.min(120,Math.max(20,(x2-x1)*.49));
   return 'M '+x1+' '+y1+' C '+(x1+bend)+' '+y1+' '+(x2-bend)+' '+y2+' '+x2+' '+y2;
  }
  const descending=b.y>a.y;
  const x1=a.x+a.w*.5,y1=descending?a.y+102:a.y;
  const x2=b.x+b.w*.5,y2=descending?b.y:b.y+102;
  const delta=(y2-y1)*.42;
  return 'M '+x1+' '+y1+' C '+x1+' '+(y1+delta)+' '+x2+' '+(y2-delta)+' '+x2+' '+y2;
 }
 function drawGraph(){
  if(!modelState.model)return;
  const edges=$('archEdges'),nodes=$('archNodes');
  const edgeMarkup=modelState.model.edges.map(edge=>{
   const d=edgePath(edge);
   return '<g data-arch-edge="'+esc(edge.id)+'">'+
    '<path class="arch-wire" d="'+esc(d)+'" marker-end="url(#archArrow)"></path>'+
    '<path class="arch-wire-hit" d="'+esc(d)+'" role="button" tabindex="0" aria-label="'+esc(edge.label)+': '+esc(nodeById(edge.from).name)+' → '+esc(nodeById(edge.to).name)+'"></path></g>';
  }).join('');
  edges.innerHTML=edgeMarkup;
  nodes.innerHTML=modelState.model.nodes.map(node=>
   '<button type="button" class="arch-node group-'+esc(node.group)+'" data-arch-node="'+esc(node.id)+'" style="left:'+Number(node.x)+'px;top:'+Number(node.y)+'px;width:'+Number(node.w)+'px;min-height:102px" aria-pressed="false">'+
   '<span class="arch-node-head"><span class="arch-node-icon">'+icon(node.group)+'</span><span class="arch-node-name">'+esc(node.name)+'</span></span>'+
   '<span class="arch-node-sub">'+esc(node.sub)+'</span>'+
   '<span class="arch-node-foot"><span>'+esc(groupNames[node.group]||node.group)+'</span><span>'+esc(node.tag)+'</span></span></button>'
  ).join('');
  edges.addEventListener('click',event=>{
   const g=event.target.closest('[data-arch-edge]');if(!g)return;
   select({type:'edge',id:g.dataset.archEdge});
  });
  edges.addEventListener('keydown',event=>{
   if(event.key!=='Enter'&&event.key!==' ')return;
   const g=event.target.closest('[data-arch-edge]');if(!g)return;
   event.preventDefault();select({type:'edge',id:g.dataset.archEdge});
  });
  nodes.addEventListener('click',event=>{
   const button=event.target.closest('[data-arch-node]');if(button)select({type:'node',id:button.dataset.archNode});
  });
  $('archCounts').textContent=modelState.model.nodes.length+' khối · '+modelState.model.edges.length+' kết nối';
  drawFilters();
  updateHighlight();
 }
 function drawFilters(){
  $('archFlowFilters').innerHTML=modelState.model.flows.map(flow=>
   '<button type="button" class="arch-filter '+(modelState.filter===flow.id?'selected':'')+'" data-flow="'+esc(flow.id)+'" aria-pressed="'+String(modelState.filter===flow.id)+'" style="--filter-color:'+esc(flow.color)+'">'+
   '<span class="arch-filter-dot"></span>'+esc(flow.name)+'</button>').join('');
 }
 function updateHighlight(){
  if(!modelState.model)return;
  document.body.dataset.archFlow=modelState.filter;
  const visible=activeGroups(),selected=modelState.selected,connected=selected?.type==='node'?new Set(modelState.model.edges.filter(e=>e.from===selected.id||e.to===selected.id).map(e=>e.id)):null;
  const allowedNodes=nodeActiveSet();
  for(const btn of $('archNodes').querySelectorAll('[data-arch-node]')){
   const id=btn.dataset.archNode;
   const isSelected=selected?.type==='node'&&id===selected.id;
   const partOfEdge=selected?.type==='edge'&&[edgeById(selected.id)?.from,edgeById(selected.id)?.to].includes(id);
   btn.classList.toggle('selected',isSelected||partOfEdge);
   btn.classList.toggle('dim',Boolean(visible&&!allowedNodes.has(id) && !isSelected));
   btn.setAttribute('aria-pressed',String(isSelected));
  }
  for(const line of $('archEdges').querySelectorAll('[data-arch-edge]')){
   const id=line.dataset.archEdge;
   const edge=edgeById(id);
   const onFlow=!visible||visible.has(edge.group);
   const focus=selected ? (selected.type==='edge'?id===selected.id:connected.has(id)):false;
   const wire=line.querySelector('.arch-wire');
   wire.classList.toggle('highlight',focus||(!selected&&Boolean(visible)&&onFlow));
   wire.classList.toggle('dim',selected?!focus:!onFlow);
   wire.style.stroke=(focus||(!selected&&Boolean(visible)&&onFlow))?flowColor(edge.group):'';
   line.style.pointerEvents=onFlow||focus?'auto':'none';
  }
 }
 const valueList=items=>items?.length?'<div class="arch-inspect-values">'+items.map(v=>'<span class="arch-inspect-value">'+esc(v)+'</span>').join('')+'</div>':'<span>Không có dữ liệu</span>';
 function renderInspect(){
  const el=$('archInspector');
  if(!modelState.selected){
   const flow=modelState.model.flows.find(f=>f.id===modelState.filter);
   el.innerHTML='<h2 id="archInspectorTitle">'+esc(flow?.name==='Tất cả'?'Chọn một khối hoặc kết nối':flow?.name||'Kiến trúc')+'</h2>'+
    '<div class="arch-inspector-empty">'+esc(flow?.description||'Chọn một khối trong sơ đồ để xem API, luồng đọc/ghi và vai trò.')+'</div>'+
    '<p style="margin-top:14px">Các khối xử lý cùng chạy trong một dịch vụ Node.js trên Render. PostgreSQL là cơ sở dữ liệu giao dịch dùng chung.</p>';
   return;
  }
  if(modelState.selected.type==='node'){
   const n=nodeById(modelState.selected.id);
   if(!n){modelState.selected=null;return renderInspect()}
   const link=appLinks[n.id];
   el.innerHTML='<span class="arch-inspect-tag">'+esc(n.tag)+'</span>'+
    '<h2 id="archInspectorTitle">'+esc(n.name)+'</h2>'+
    '<p class="arch-inspect-sub">'+esc(n.sub)+'</p>'+
    '<p>'+esc(n.detail)+'</p>'+
    '<div class="arch-inspect-label">API / TỆP NGHIỆP VỤ</div>'+
    (n.routes||[]).map(r=>'<code class="arch-inspect-route">'+esc(r)+'</code>').join('')+
    '<div class="arch-inspect-label">DỮ LIỆU LIÊN QUAN</div>'+valueList(n.data)+
    (link?'<a class="arch-inspect-link" href="'+esc(link)+'">Mở màn hình nghiệp vụ ↗</a>':'');
  }else{
   const e=edgeById(modelState.selected.id);
   if(!e){modelState.selected=null;return renderInspect()}
   const from=nodeById(e.from),to=nodeById(e.to),flow=modelState.model.flows.find(f=>f.id===e.group);
   el.innerHTML='<span class="arch-inspect-tag">KẾT NỐI · '+esc((flow?.name||e.group).toUpperCase())+'</span>'+
    '<h2 id="archInspectorTitle">'+esc(e.label)+'</h2>'+
    '<p>'+esc(e.detail)+'</p>'+
    '<div class="arch-inspect-label">NGUỒN GỬI</div>'+valueList([from?.name||e.from])+
    '<div class="arch-inspect-label">ĐÍCH NHẬN</div>'+valueList([to?.name||e.to])+
    '<div class="arch-inspect-label">LOẠI KẾT NỐI</div><p>Luồng logic trong mã nguồn; không có bằng chứng tracing trực tiếp từng request.</p>';
  }
 }
 function select(selection){
  modelState.selected=selection;
  renderInspect();
  updateHighlight();
 }
 function setScale(raw){
  const next=Math.min(1.35,Math.max(.45,Math.round(raw*100)/100));
  const viewport=$('archViewport');
  const oldWidth=baseW*modelState.scale,oldHeight=baseH*modelState.scale;
  const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/oldWidth;
  const centerY=(viewport.scrollTop+viewport.clientHeight/2)/oldHeight;
  modelState.scale=next;
  $('archStage').style.transform='scale('+next+')';
  $('archStageSizer').style.width=(baseW*next)+'px';
  $('archStageSizer').style.height=(baseH*next)+'px';
  $('archZoomLabel').textContent=Math.round(next*100)+'%';
  viewport.scrollLeft=Math.max(0,centerX*(baseW*next)-viewport.clientWidth/2);
  viewport.scrollTop=Math.max(0,centerY*(baseH*next)-viewport.clientHeight/2);
 }
 function fit(){
  const width=$('archViewport').clientWidth||850;
  setScale(Math.max(.45,Math.min(1,(width-20)/baseW)));
  $('archViewport').scrollLeft=0;$('archViewport').scrollTop=0;
 }
 function monitorView(monitor){
  modelState.monitor=monitor||null;
  const s=monitor?.stats||null,app=monitor?.app,db=monitor?.database;
  $('archAppState').textContent=app==='ready'?'Đang phản hồi':'Chưa xác minh';
  $('archDbState').textContent=db==='ready'?'Đã kết nối':db==='pilot'?'Chế độ pilot':'Không truy vấn được';
  $('archAppLight').className='arch-light '+(app==='ready'?'ready':'bad');
  $('archDbLight').className='arch-light '+(db==='ready'?'ready':'bad');
  $('archLatency').textContent=db==='ready'&&Number.isFinite(monitor.dbLatencyMs)?monitor.dbLatencyMs+' ms':'—';
  const fields=[['statOrders','orders24h'],['statKitchen','pendingKitchen'],['statStock','lowStock'],['statFinance','financeEntries24h'],['statLockers','occupiedLockers'],['statUnpaid','unpaidOrders']];
  for(const [id,key] of fields)$(id).textContent=s?formatNumber(s[key]):'—';
  const date=new Date(monitor?.checkedAt||0);
  const stamp=Number.isFinite(date.getTime())?date.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'—';
  $('archCheckedAt').textContent='Đã kiểm tra: '+stamp+' · Không tự xác nhận toàn bộ luồng';
  if(db!=='ready'){
   $('archError').hidden=false;
   $('archError').textContent=monitor?.note||'Chưa xác minh được trạng thái PostgreSQL.';
  }else $('archError').hidden=true;
 }
 async function refresh(){
  if(modelState.refreshing)return;
  modelState.refreshing=true;$('archRefresh').disabled=true;
  try{
   const response=await fetch('/api/v1/monitoring/architecture',{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
   if(response.status===401||response.status===403){
    $('archContent').hidden=true;$('archAccess').hidden=false;return;
   }
   if(!response.ok)throw Error('Không tải được kiến trúc (HTTP '+response.status+').');
   const data=await response.json();
   if(!data?.model||!Array.isArray(data.model.nodes)||!Array.isArray(data.model.edges)||!Array.isArray(data.model.flows)||!data.monitor)throw Error('Dữ liệu kiến trúc không hợp lệ.');
   modelState.model=data.model;
   // Reveal the graph before measuring its width for the initial fit.
   $('archContent').hidden=false;$('archAccess').hidden=true;
   if(!initialized){drawGraph();initialized=true;fit();}
   else{drawFilters();updateHighlight();}
   monitorView(data.monitor);
   if(!modelState.selected)renderInspect();
   $('archContent').hidden=false;$('archAccess').hidden=true;
  }catch(e){
   $('archError').hidden=false;$('archError').textContent='Không thể kiểm tra dữ liệu mới: '+e.message+' Sơ đồ cũ (nếu có) chỉ mang tính tham khảo.';
  }finally{modelState.refreshing=false;$('archRefresh').disabled=false}
 }
 $('archFlowFilters').addEventListener('click',event=>{
  const target=event.target.closest('[data-flow]');if(!target||!modelState.model)return;
  modelState.filter=target.dataset.flow;
  modelState.selected=null;drawFilters();updateHighlight();renderInspect();
  document.dispatchEvent(new CustomEvent('saleshub:overview-filter',{detail:{filter:modelState.filter}}));
 });
 $('archZoomIn').addEventListener('click',()=>setScale(modelState.scale+.15));
 $('archZoomOut').addEventListener('click',()=>setScale(modelState.scale-.15));
 $('archFit').addEventListener('click',fit);
 $('archRefresh').addEventListener('click',refresh);
 window.addEventListener('resize',()=>{
  if(!initialized)return;
  clearTimeout(window.__archResizeDebounce);
  window.__archResizeDebounce=setTimeout(fit,120);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&initialized)refresh()});
 setInterval(()=>{if(!document.hidden&&initialized)refresh()},60000);
 refresh();
})();

document.addEventListener('saleshub:staff-presence',event=>{
 const state=event.detail,active=Number(state?.selectingSessions||0)+Number(state?.submittingSessions||0)>0;
 for(const id of ['staffcart','stafforder'])document.querySelector('#archNodes [data-arch-node="'+id+'"]')?.classList.toggle('is-staff-cart-live',active);
 for(const id of ['stafforder-staffcart','staffcart-http'])document.querySelector('#archEdges [data-arch-edge="'+id+'"]')?.classList.toggle('is-staff-presence-live',active);
});
