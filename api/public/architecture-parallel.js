(() => {
 'use strict';
 // Concurrent, independent playback of actual SSE request milestones.
 // No simulated traffic: every displayed step is an observed backend mark.
 // Unlike the single-trace replay, parallel mode never changes the selected module.
 function init(){
  const stage=document.getElementById('deepStage');
  const svg=document.getElementById('deepWires'),nodes=document.getElementById('deepNodes');
  if(!stage||!svg||!nodes)return;
  const ns='http://www.w3.org/2000/svg',maxTraces=12,stepDelay=300,lingerMs=3800;
  const colors={orders:'#60d6de',stafforder:'#76ddaf',kds:'#f2c65a',inventory:'#f0a969',finance:'#bd9aff',rental:'#8bbaff',admin:'#c0b8ff'};
  const titles={orders:'QR khách',stafforder:'Nhân viên',kds:'Bếp / Bar',inventory:'Kho',finance:'Thanh toán',rental:'Phao / Tủ',admin:'Quản trị'};
  const traces=new Map(),seen=new Map();
  let lastSnapshot=null;
  const layer=document.createElementNS(ns,'g');
  layer.id='deepParallelLinks';layer.setAttribute('aria-hidden','true');svg.appendChild(layer);
  const el=id=>document.getElementById(id);
  const node=id=>nodes.querySelector('[data-id="'+id+'"]');
  const enabled=()=>document.body.dataset.deepFlow==='all'&&el('deepFollow')?.getAttribute('aria-pressed')!=='false';
  const root=t=>t.module==='stafforder'?'stafforder':t.module==='orders'?'guest':
   ['kds','rental'].includes(t.module)?'staff':'owner';
  const shape=(tag,attrs)=>{
   const e=document.createElementNS(ns,tag);
   for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));
   return e;
  };
  function pathBetween(from,to){
   const a=node(from),b=node(to);
   if(!a||!b||from===to)return null;
   const ax=a.offsetLeft,ay=a.offsetTop,bx=b.offsetLeft,by=b.offsetTop;
   const aw=a.offsetWidth,ah=a.offsetHeight,bw=b.offsetWidth,bh=b.offsetHeight;
   if(bx>=ax+aw-8){
    const sx=ax+aw,sy=ay+ah/2,ex=bx,ey=by+bh/2,bend=Math.max(30,(ex-sx)*.44);
    return 'M'+sx+' '+sy+' C'+(sx+bend)+' '+sy+' '+(ex-bend)+' '+ey+' '+ex+' '+ey;
   }
   const sx=ax+aw/2,sy=ay+ah,ex=bx+bw/2,ey=by,dy=Math.max(30,Math.abs(ey-sy)*.38);
   return 'M'+sx+' '+sy+' C'+sx+' '+(sy+dy)+' '+ex+' '+(ey-dy)+' '+ex+' '+ey;
  }
  const overviewMap={
   guest:'guest',staff:'staff',stafforder:'stafforder',staffcart:'staffcart',
   http:'http',auth:'auth',validate:'orders',orders:'orders',
   kds:'kds',inventory:'inventory',finance:'finance',rental:'rental',admin:'backoffice',
   tx:'postgres',pg:'postgres',audit:'audit'
  };
  function paintOverview(){
   const nodes=document.getElementById('archNodes'),wires=document.getElementById('archEdges');
   if(!nodes||!wires)return;
   const show=enabled()&&document.body.dataset.archFlow==='all';
   const counts=new Map(),routes=new Set();
   if(show){
    for(const item of traces.values()){
     if(item.index<0)continue;
     const trail=[root(item.trace),...(item.trace.steps||[]).slice(0,item.index+1).map(s=>s.node)].map(n=>overviewMap[n]).filter(Boolean);
     for(const n of new Set(trail))counts.set(n,(counts.get(n)||0)+1);
     for(let i=1;i<trail.length;i++)if(trail[i]!==trail[i-1])routes.add(trail[i-1]+'-'+trail[i]);
    }
   }
   const qr=show?Number(lastSnapshot?.qrPresence?.selectingSessions||0):0;
   const staff=show?Number(lastSnapshot?.staffOrderPresence?.selectingSessions||0)+Number(lastSnapshot?.staffOrderPresence?.submittingSessions||0):0;
   if(qr)counts.set('guest',(counts.get('guest')||0)+qr);
   if(staff)for(const n of ['stafforder','staffcart'])counts.set(n,(counts.get(n)||0)+staff);
   for(const n of nodes.querySelectorAll('[data-arch-node]')){
    const count=counts.get(n.dataset.archNode)||0;
    n.classList.toggle('arch-concurrent-active',count>0);
    if(count)n.setAttribute('data-arch-concurrent',count+' luồng');
    else n.removeAttribute('data-arch-concurrent');
   }
   for(const e of wires.querySelectorAll('[data-arch-edge]'))
    e.classList.toggle('arch-concurrent-route',show&&routes.has(e.dataset.archEdge));
  }
  function clear(){
   paintOverview();
   for(const item of traces.values())if(item.timer)clearTimeout(item.timer);
   traces.clear();layer.replaceChildren();
   nodes.querySelectorAll('[data-concurrent]').forEach(n=>{n.classList.remove('concurrent-active');n.removeAttribute('data-concurrent')});
   svg.querySelectorAll('.deep-edge.concurrent-active').forEach(e=>e.classList.remove('concurrent-active'));
   paintOverview();
  }
  function render(){
   if(!enabled()){clear();return}
   layer.replaceChildren();
   const counts=new Map(),litEdges=new Set();
   let drawing=0,waiting=0,failed=0;
   for(const item of traces.values()){
    const steps=item.trace.steps||[];
    if(item.index<0||!steps.length)continue;
    drawing++;
    if(item.trace.state==='failed'||item.trace.state==='aborted')failed++;
    waiting+=item.queue.length;
    const trail=[root(item.trace),...steps.slice(0,item.index+1).map(s=>s.node)];
    for(let i=0;i<trail.length;i++)counts.set(trail[i],(counts.get(trail[i])||0)+1);
    const color=item.trace.state==='failed'||item.trace.state==='aborted'?'#f18d91':colors[item.trace.module]||'#82b9e5';
    for(let i=1;i<trail.length;i++){
     if(trail[i]===trail[i-1])continue;
     const d=pathBetween(trail[i-1],trail[i]);if(!d)continue;
     const current=i===trail.length-1;
     layer.appendChild(shape('path',{d,stroke:color,class:'parallel-route '+(current?'latest':'visited'),'data-observed-trace':item.trace.id}));
     if(current)litEdges.add(trail[i-1]+'-'+trail[i]);
    }
   }
   for(const n of nodes.querySelectorAll('[data-id]')){
    const count=counts.get(n.dataset.id)||0;
    n.classList.toggle('concurrent-active',count>0);
    if(count)n.setAttribute('data-concurrent',count+' luồng');
    else n.removeAttribute('data-concurrent');
   }
   for(const e of svg.querySelectorAll('.deep-edge[data-src]'))
    e.classList.toggle('concurrent-active',litEdges.has(e.dataset.src+'-'+e.dataset.dst));
   const prefix=drawing?drawing+' luồng đang được hiển thị đồng thời':'Tất cả · đang chờ sự kiện thực';
   if(el('pathRuntimeTitle'))el('pathRuntimeTitle').textContent=prefix;
   if(el('pathRuntimeDescription'))el('pathRuntimeDescription').textContent=drawing?
    [...traces.values()].filter(x=>x.index>=0).map(x=>titles[x.trace.module]||x.trace.module).slice(-6).join(' · ')+' · Mốc API thật, trình bày chậm để dễ quan sát':
    'Giỏ QR/nhân viên và các yêu cầu đã ghi sẽ cùng xuất hiện khi có hoạt động, không chạy hiệu ứng giả khi rảnh.';
   if(el('pathRuntimeProgress'))el('pathRuntimeProgress').textContent=drawing+' luồng';
   if(el('pathRuntimeQueue'))el('pathRuntimeQueue').textContent=waiting+' mốc chờ · '+(failed?failed+' lỗi':'không lỗi đang hiển thị');
   if(el('pathRuntimeDot'))el('pathRuntimeDot').className='path-runtime-dot '+(failed?'error':drawing?'active':'');
   if(el('deepLivePath')&&drawing)el('deepLivePath').textContent='Tất cả đang hiển thị '+drawing+' luồng mốc backend thực song song · không tự chuyển module';
   paintOverview();
  }
  function advance(id){
   const t=traces.get(id);
   if(!t||!enabled())return;
   t.timer=null;
   if(t.queue.length){
    t.index=t.queue.shift();
    render();
    t.timer=setTimeout(()=>advance(id),stepDelay);
    return;
   }
   // The last observed stage remains visible briefly; an in-flight request
   // stays visible until the server sends a new milestone or times out.
   if(t.trace.state==='running'&&Date.now()-t.lastSeen<20000){
    t.timer=setTimeout(()=>advance(id),750);
   }else if(!t.doneAt){
    t.doneAt=Date.now();
    t.timer=setTimeout(()=>advance(id),lingerMs);
   }else if(Date.now()-t.doneAt>=lingerMs){
    traces.delete(id);render();
   }else t.timer=setTimeout(()=>advance(id),lingerMs-(Date.now()-t.doneAt));
  }
  function add(trace,{fromSnapshot=false,at=Date.now()}={}){
   if(!trace?.id||!Array.isArray(trace.steps)||!trace.steps.length)return;
   if(!enabled())return;
   // Never turn an old completed request into a fake live event on reconnect.
   if(fromSnapshot&&trace.state!=='running'){
    const finished=Date.parse(trace.finishedAt||trace.createdAt);
    if(!Number.isFinite(finished)||at-finished>6000||at-finished< -3000)return;
   }
   const prior=seen.get(trace.id)||0;
   const begin=trace.steps.length<prior?0:prior;
   seen.delete(trace.id);seen.set(trace.id,trace.steps.length);
   if(seen.size>250)seen.delete(seen.keys().next().value);
   if(!traces.has(trace.id)&&begin===trace.steps.length)return;
   let item=traces.get(trace.id);
   if(!item){
    if(traces.size>=maxTraces){
     const oldest=[...traces.entries()][0];
     if(oldest){if(oldest[1].timer)clearTimeout(oldest[1].timer);traces.delete(oldest[0])}
    }
    item={trace,index:-1,queue:[],timer:null,lastSeen:Date.now(),doneAt:0};
    traces.set(trace.id,item);
   }
   item.trace=trace;item.lastSeen=Date.now();
   item.doneAt=0;
   for(let i=begin;i<trace.steps.length;i++)item.queue.push(i);
   if(!item.timer)advance(trace.id);
  }
  function onTrace(e){add(e.detail?.trace)}
  function onSnapshot(e){
   lastSnapshot=e.detail;
   if(!enabled())return;
   const time=Date.parse(lastSnapshot?.checkedAt)||Date.now();
   for(const t of [...(lastSnapshot?.active||[]),...(lastSnapshot?.traces||[])])add(t,{fromSnapshot:true,at:time});
   render();
  }
  function onFilter(){
   if(!enabled()){clear();return}
   // Reconnect to currently observed in-flight work, without replaying old orders.
   if(lastSnapshot)onSnapshot({detail:lastSnapshot});
   else render();
  }
  document.addEventListener('saleshub:trace',onTrace);
  document.addEventListener('saleshub:snapshot',onSnapshot);
  document.addEventListener('saleshub:architecture-filter',onFilter);
  document.addEventListener('saleshub:overview-filter',paintOverview);
  window.addEventListener('pagehide',clear);
  render();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
