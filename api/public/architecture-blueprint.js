(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const domains={all:'Tất cả',orders:'QR / Đơn hàng',stafforder:'Nhân viên',kds:'Bếp / Bar',stock:'Kho',finance:'Thanh toán',rental:'Phao / Tủ',access:'Quyền',admin:'Quản trị',audit:'Audit',observe:'Giám sát',database:'PostgreSQL'};
 const lanes=['THIẾT BỊ / NGƯỜI DÙNG','HTTP / XÁC THỰC','MODULE NGHIỆP VỤ','GIAO DỊCH / ACID','LƯU TRỮ POSTGRESQL','AUDIT / SSE'];
 const state={model:null,tab:'topology',filter:'all',selected:null,zoom:.78,nodes:[],edges:[],width:1700,height:1310,snapshot:null};
 const shownNode=new Map(),actualCounts=new Map();
 const svgNS='http://www.w3.org/2000/svg';
 const iconType={client:'THIẾT BỊ',gateway:'API',runtime:'RAM',module:'NGHIỆP VỤ',tx:'TRANSACTION',storage:'DB',observe:'LIVE'};
 const colors={client:'#58c6e2',gateway:'#58ddae',runtime:'#74b6ff',module:'#f7c56a',tx:'#dbb3ff',storage:'#aa99ff',observe:'#ffb486'};
 const tabNames={topology:'Kiến trúc 6 lớp',order:'24 bước tạo đơn',schema:'Quan hệ CSDL'};
 const cleanup=()=>{};
 const projectNode=(b)=>({...b,x:28+b.col*279,y:86+b.row*151,w:232,h:105});
 function dataFor(tab){
  const source=state.model;
  if(tab==='topology')return {nodes:source.architecture.blocks.map(projectNode),edges:source.architecture.connects,
   width:1710,height:1370};
  if(tab==='order'){
   const nodes=source.architecture.orderSteps.map((x,i)=>{
    const row=Math.floor(i/6),position=i%6,col=row%2===0?position:5-position;
    return {...x,id:'step-'+x.number,domain:x.node,x:30+col*279,y:92+row*215,w:233,h:147};
   });
   // Steps 1–23 describe the successful lifecycle; 24 is a conditional error branch.
   // Branches to rollback are real alternatives, never a final post-payment stage.
   const success=nodes.slice(1,-1).map((x,i)=>({from:nodes[i].id,to:x.id}));
   const errors=['step-4','step-5','step-12','step-15'].map(from=>({from,to:'step-24',kind:'rollback',label:'Từ chối trước BEGIN hoặc ROLLBACK sau BEGIN'}));
   return {nodes,edges:[...success,...errors],width:1720,height:1000};
  }
  const priority=['dining','stock','finance','rental','access','audit','legacy'];
  const tables=source.schema.tables.slice().sort((a,b)=>priority.indexOf(a.domain)-priority.indexOf(b.domain)||a.name.localeCompare(b.name));
  const nodes=tables.map((t,i)=>({...t,id:t.name,label:t.name,x:26+i%4*414,y:85+Math.floor(i/4)*256,w:348,h:214}));
  return {nodes,edges:source.schema.relations.map(r=>({from:r.from,to:r.to,label:r.column+' → '+r.targetColumn})),
   width:1690,height:Math.ceil(tables.length/4)*256+130};
 }
 function renderTop(){
  $('bpTabLabel').textContent=tabNames[state.tab];
  $('bpStatus').textContent=state.tab==='schema'?state.model.schema.tableCount+' bảng · '+state.model.schema.relationCount+' khóa ngoại':
   state.tab==='order'?state.model.architecture.orderSteps.length+' mốc nghiệp vụ · 4 nhánh bị từ chối / ROLLBACK bằng đường đỏ':
   state.model.architecture.blocks.length+' khối · '+state.model.architecture.connects.length+' quan hệ logic';
  $('bpFilters').hidden=state.tab!=='topology';
  $('bpTabs').querySelectorAll('[data-bp-tab]').forEach(b=>{
   const active=b.dataset.bpTab===state.tab;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));
  });
  $('bpSearch').value='';
  $('bpHint').textContent=state.tab==='schema'?'Bảng và khóa ngoại được trích từ schema.sql. Các bảng legacy chỉ còn trong schema, không đồng nghĩa còn dùng trên UI.':
   state.tab==='order'?'Đường đỏ: lỗi trước BEGIN → HTTP từ chối; lỗi sau BEGIN → ROLLBACK. Bếp/Bar và xác nhận thanh toán là những request riêng sau COMMIT.':
   'Sơ đồ cấu trúc mã nguồn, không phải các microservice độc lập. Các khối sáng LIVE chỉ khi nhận được trạng thái quan sát thực.';
 }
 function renderNodes(){
  const graph=dataFor(state.tab);
  state.nodes=graph.nodes;state.edges=graph.edges;state.width=graph.width;state.height=graph.height;
  shownNode.clear();for(const n of state.nodes)shownNode.set(n.id,n);
  const isSchema=state.tab==='schema',isOrder=state.tab==='order';
  const stage=$('bpStage'),wire=$('bpWires'),nodes=$('bpNodes');
  stage.style.width=graph.width+'px';stage.style.height=graph.height+'px';
  wire.setAttribute('viewBox','0 0 '+graph.width+' '+graph.height);
  wire.style.width=graph.width+'px';wire.style.height=graph.height+'px';
  $('bpLanes').innerHTML=state.tab!=='topology'?'':lanes.map((l,i)=>
   '<div class="bp-lane" style="left:'+(17+i*279)+'px;width:264px"><span>'+esc(l)+'</span></div>').join('');
  nodes.innerHTML=state.nodes.map(n=>{
   const schemaRows=isSchema?n.columns.slice(0,5).map(c=>'<span class="bp-column"><em>'+esc(c.pk?'PK':c.references?'FK':'')+'</em>'+esc(c.name)+'<small>'+esc(c.type)+'</small></span>').join(''):'';
   const content=isSchema?'<span class="bp-db-columns">'+schemaRows+'</span><span class="bp-more">'+(n.columns.length>5?'+'+(n.columns.length-5)+' cột khác · ':'')+(n.legacy?'BẢNG LỊCH SỬ':'BẢNG NGHIỆP VỤ')+'</span>':
    '<span class="bp-node-description">'+esc(isOrder?n.description:n.description)+'</span><span class="bp-node-source">'+esc(isOrder?'Mốc '+n.number:n.source)+'</span>';
   const group=isSchema?n.domain:isOrder?'orders':n.domain;
   return '<button type="button" data-bp-node="'+esc(n.id)+'" data-bp-domain="'+esc(group)+'" class="bp-node'+(isSchema?' bp-db-node':'')+(n.legacy?' bp-legacy-node':'')+'" '+
    'style="left:'+n.x+'px;top:'+n.y+'px;width:'+n.w+'px;min-height:'+n.h+'px;--bp-accent:'+
    (isSchema?'#9fb2ff':isOrder?'#89d7bc':colors[n.lane]||'#efbe78')+'">'+
    '<span class="bp-node-head"><strong>'+esc(n.label)+'</strong><span class="bp-live-value" data-live-for="'+esc(n.id)+'" hidden></span></span>'+
    content+'</button>';
  }).join('');
  const curves=state.edges.map((e,i)=>{
   const from=shownNode.get(e.from),to=shownNode.get(e.to);if(!from||!to)return '';
   const d=curve(from,to);
   return '<path class="bp-wire'+(e.kind==='rollback'?' bp-rollback-wire':'')+'" d="'+d+'" data-bp-from="'+esc(e.from)+'" data-bp-to="'+esc(e.to)+'" data-bp-edge="'+i+'" marker-end="url(#bpArrow)"/>';
  }).join('');
  wire.innerHTML='<defs><marker id="bpArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#7191b0" stroke-width="1.6"/></marker></defs>'+curves;
  resize();
  updateFocus();
  updateLive();
 }
 function curve(a,b){
  const forward=b.x>a.x+a.w*.5;
  if(forward){
   const x1=a.x+a.w,y1=a.y+Math.min(50,a.h/2),x2=b.x,y2=b.y+Math.min(50,b.h/2);
   const mid=Math.max(22,(x2-x1)*.45);
   return 'M'+x1+' '+y1+' C'+(x1+mid)+' '+y1+' '+(x2-mid)+' '+y2+' '+x2+' '+y2;
  }
  const x1=a.x+a.w/2,y1=a.y+a.h,x2=b.x+b.w/2,y2=b.y;
  return 'M'+x1+' '+y1+' C'+x1+' '+(y1+39)+' '+x2+' '+(y2-39)+' '+x2+' '+y2;
 }
 function resize(){
  const z=state.zoom,stage=$('bpStage');
  stage.style.transform='scale('+z+')';
  $('bpSizer').style.width=Math.ceil(state.width*z)+'px';
  $('bpSizer').style.height=Math.ceil(state.height*z)+'px';
  $('bpZoomLabel').textContent=Math.round(z*100)+'%';
 }
 function updateFocus(){
  const query=$('bpSearch').value.trim().toLocaleLowerCase('vi-VN');
  const selected=state.selected,found=new Set(selected?[selected]:[]);
  if(selected){
   for(const e of state.edges)if(e.from===selected||e.to===selected){found.add(e.from);found.add(e.to)}
  }
  for(const b of $('bpNodes').querySelectorAll('[data-bp-node]')){
   const id=b.dataset.bpNode,n=shownNode.get(id),matches=!query||[n.label,n.description,n.source,n.name].some(v=>String(v||'').toLocaleLowerCase('vi-VN').includes(query));
   const filtered=state.tab==='topology'&&state.filter!=='all'&&n.domain!==state.filter&&
    !['client','gateway','storage','observe','tx'].includes(n.lane);
   b.classList.toggle('is-faded',!matches||filtered||(selected&&!found.has(id)));
   b.classList.toggle('is-chosen',selected===id);
   b.setAttribute('aria-pressed',String(selected===id));
  }
  for(const e of $('bpWires').querySelectorAll('[data-bp-edge]')){
   const chosen=selected&&(e.dataset.bpFrom===selected||e.dataset.bpTo===selected);
   const related=state.edges[Number(e.dataset.bpEdge)];
   const a=shownNode.get(related?.from),b=shownNode.get(related?.to);
   const filtered=state.tab==='topology'&&state.filter!=='all'&&!([a?.domain,b?.domain].includes(state.filter)||
    ['gateway','storage','observe','tx'].includes(a?.lane)||['gateway','storage','observe','tx'].includes(b?.lane));
   e.classList.toggle('is-faded',Boolean(selected&&!chosen)||filtered);
   e.classList.toggle('is-chosen',Boolean(chosen));
  }
 }
 function selectNode(id){
  const n=shownNode.get(id);
  if(!n)return;
  state.selected=id;updateFocus();
  const edges=state.edges.filter(e=>e.from===id||e.to===id),neighbors=edges.map(e=>e.from===id?e.to:e.from);
  const tag=s=>'<code>'+esc(s)+'</code>';
  let body='';
  if(state.tab==='schema'){
   const columns=n.columns.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.type)+'</td><td>'+
    (c.pk?'PK ': '')+(c.references?'FK → '+esc(c.references.table)+'.'+esc(c.references.column):'')+(c.unique?' UNIQUE':'')+(c.required?' NOT NULL':'')+'</td></tr>').join('');
   body='<p>'+esc(n.columns.length)+' cột · '+esc(n.indexes.length)+' chỉ mục · '+esc(edges.length)+' quan hệ FK.</p>'+
    '<div class="bp-table-scroll"><table><thead><tr><th>Cột</th><th>Kiểu</th><th>Ràng buộc</th></tr></thead><tbody>'+columns+'</tbody></table></div>'+
    (n.constraints.length?'<h4>Ràng buộc bảng</h4><ul>'+n.constraints.map(x=>'<li>'+tag(x)+'</li>').join('')+'</ul>':'')+
    (n.indexes.length?'<h4>Chỉ mục</h4><div class="bp-code-list">'+n.indexes.map(x=>tag(x.name+(x.unique?' · UNIQUE':''))).join('')+'</div>':'')+
    (n.legacy?'<p class="bp-caution">Bảng tồn tại trong schema vì tương thích dữ liệu cũ; không có nghĩa chức năng còn trên giao diện.</p>':'');
  }else if(state.tab==='order'){
   body='<p>'+esc(n.description)+'</p><h4>Module liên quan</h4>'+tag(n.node.toUpperCase())+
    '<h4>Thứ tự / nhánh xử lý</h4><p>Mốc '+esc(n.number)+' / '+state.nodes.length+
    '. Đường nối biểu thị trình tự logic hoặc điều kiện lỗi, không phải thời lượng thực thi. Bước 24 là nhánh thất bại, không thuộc luồng thành công.</p>';
  }else{
   body='<p>'+esc(n.description)+'</p><h4>Mã nguồn / API</h4>'+tag(n.source)+
    '<h4>Loại thành phần</h4><p>'+esc(iconType[n.lane]||n.lane)+' · '+esc(domains[n.domain]||n.domain)+'</p>';
  }
  if(neighbors.length)body+='<h4>Kết nối trực tiếp</h4><div class="bp-relations">'+neighbors.map(x=>'<button type="button" data-bp-related="'+esc(x)+'">'+esc(shownNode.get(x)?.label||x)+'</button>').join('')+'</div>';
  $('bpInspector').innerHTML='<div class="bp-inspector-tag">CHI TIẾT MÃ NGUỒN · '+esc(tabNames[state.tab])+'</div>'+
   '<h3>'+esc(n.label)+'</h3>'+body+
   '<p class="bp-inspector-bottom">Sơ đồ mô tả những quan hệ được xác nhận trong source. Chỉ số LIVE chỉ dựa trên trạng thái và trace thực nhận từ server.</p>';
 }
 function updateLive(){
  actualCounts.clear();
  if(!state.snapshot||state.tab!=='topology')return;
  const active=state.snapshot.active||[];
  for(const t of active){
   const moduleIds={orders:'orderengine',stafforder:'orderengine',kds:'kds',inventory:'recipe',finance:'payment',rental:'rental',admin:'admin'};
   const direct=moduleIds[t.module];if(direct)actualCounts.set(direct,(actualCounts.get(direct)||0)+1);
   for(const step of t.steps||[]){
    const ids={http:'router',auth:'auth',validate:'validate',orders:'orderengine',inventory:'stocklock',kds:'kds',finance:'payment',rental:'rental',tx:'begin',pg:'pool',audit:'auditwrite'};
    const target=ids[step.node];if(target)actualCounts.set(target,(actualCounts.get(target)||0)+1);
   }
  }
  const qr=Number(state.snapshot.qrPresence?.selectingSessions||0),staff=Number(state.snapshot.staffOrderPresence?.selectingSessions||0);
  if(qr){actualCounts.set('guestcart',qr);actualCounts.set('qr',qr)}
  if(staff){actualCounts.set('staffcart',staff);actualCounts.set('staffui',staff)}
  for(const node of $('bpNodes').querySelectorAll('[data-bp-node]')){
   const count=actualCounts.get(node.dataset.bpNode)||0;
   node.classList.toggle('is-live',count>0);
   const value=node.querySelector('[data-live-for]');
   if(value){value.hidden=count===0;value.textContent=count+' LIVE'}
  }
 }
 function initEvents(){
  $('bpTabs').addEventListener('click',e=>{
   const b=e.target.closest('[data-bp-tab]');if(!b||!state.model)return;
   state.tab=b.dataset.bpTab;state.selected=null;state.zoom=state.tab==='schema'?.72:.78;
   renderTop();renderNodes();$('bpInspector').innerHTML='<p>Chạm vào một khối để xem toàn bộ chi tiết. Bạn có thể xem luồng khác mà không làm thay đổi bộ lọc “Tất cả” của sơ đồ giám sát.</p>';
  });
  $('bpFilters').addEventListener('change',()=>{state.filter=$('bpFilters').value;updateFocus()});
  $('bpSearch').addEventListener('input',updateFocus);
  $('bpNodes').addEventListener('click',e=>{const b=e.target.closest('[data-bp-node]');if(b)selectNode(b.dataset.bpNode)});
  $('bpInspector').addEventListener('click',e=>{const b=e.target.closest('[data-bp-related]');if(b)selectNode(b.dataset.bpRelated)});
  $('bpReset').addEventListener('click',()=>{state.selected=null;state.filter='all';$('bpFilters').value='all';$('bpSearch').value='';updateFocus();$('bpInspector').innerHTML='<p>Đang xem toàn bộ khối của sơ đồ. Chạm một khối để xem thông tin chuyên sâu.</p>'});
  $('bpZoomIn').addEventListener('click',()=>{state.zoom=Math.min(1.35,state.zoom+.1);resize()});
  $('bpZoomOut').addEventListener('click',()=>{state.zoom=Math.max(.4,state.zoom-.1);resize()});
  $('bpFit').addEventListener('click',()=>{
   const w=$('bpViewport').clientWidth-30;
   state.zoom=Math.max(.4,Math.min(1.1,w/state.width));resize();
  });
  document.addEventListener('saleshub:snapshot',e=>{state.snapshot=e.detail;updateLive()});
 }
 async function init(){
  if(!$('bpStage'))return;
  initEvents();
  try{
   const res=await fetch('/api/monitoring/blueprint',{credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw Error('HTTP '+res.status);
   const model=await res.json();
   if(!model?.architecture?.blocks?.length||!model?.schema?.tables?.length)throw Error('Dữ liệu sơ đồ không đầy đủ');
   state.model=model;renderTop();renderNodes();
   $('bpLoading').hidden=true;$('bpDiagram').hidden=false;
  }catch(err){
   $('bpLoading').textContent='Không tải được sơ đồ kỹ thuật ('+err.message+'). Hãy tải lại trang bằng tài khoản chủ cửa hàng.';
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
