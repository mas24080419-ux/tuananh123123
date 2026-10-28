(() => {
 'use strict';
 // Visual playback of OBSERVED backend steps, never synthesized activity.
 // Stage dwell is presentation time, not execution time.
 const $=id=>document.getElementById(id);
 const ns='http://www.w3.org/2000/svg';
 const seen=new Map(),known=new Map(),queue=[];
 let started=false,running=false,timeout=null,linger=null,lastTrace=null,skipped=0;
 const stage=$('deepStage');
 if(!stage)return;
 const svg=$('deepWires'),nodes=$('deepNodes');
 const bar=$('pathRuntimeTitle'),description=$('pathRuntimeDescription'),progress=$('pathRuntimeProgress'),
  pending=$('pathRuntimeQueue'),dot=$('pathRuntimeDot'),replay=$('pathReplay'),workbench=document.querySelector('.deep-workbench');
 const layer=document.createElementNS(ns,'g');layer.setAttribute('id','deepRuntimeLinks');
 layer.setAttribute('aria-hidden','true');svg.appendChild(layer);
 const text=(id,value)=>{const n=$(id);if(n)n.textContent=String(value)};
 const originFor=module=>module==='orders'?'guest':module==='kds'||module==='rental'?'staff':'owner';
 const titles={orders:'Đơn QR',kds:'Bếp / Bar',inventory:'Kho',finance:'Thu–chi',rental:'Phao & Tủ',admin:'Quản trị'};
 const activeColor=(state,step)=>state==='failed'||state==='aborted'||/ROLLBACK|lỗi/i.test(step?.label||'')?'#fa8691':state==='success'?'#77e4bd':'#f8ca5d';
 const nodeDom=id=>[...nodes.querySelectorAll('[data-id]')].find(el=>el.dataset.id===id);
 const makeSvg=(tag,attrs)=>{
  const el=document.createElementNS(ns,tag);
  for(const [key,val] of Object.entries(attrs))el.setAttribute(key,String(val));
  return el;
 };
 function route(a,b){
  const src=nodeDom(a),dst=nodeDom(b);
  if(!src||!dst||a===b)return null;
  const x1=src.offsetLeft,y1=src.offsetTop,x2=dst.offsetLeft,y2=dst.offsetTop;
  const w1=src.offsetWidth,h1=src.offsetHeight,w2=dst.offsetWidth,h2=dst.offsetHeight;
  if(x2>=x1+w1-8){
   const sx=x1+w1,sy=y1+h1/2,ex=x2,ey=y2+h2/2;
   const span=Math.max(35,(ex-sx)*.46);
   return 'M'+sx+' '+sy+' C'+(sx+span)+' '+sy+' '+(ex-span)+' '+ey+' '+ex+' '+ey;
  }
  // A reverse link is an observed transition between trace stages, not an architectural edge.
  const sx=x1+w1/2,sy=y1+h1,ex=x2+w2/2,ey=y2;
  const bend=Math.max(32,Math.abs(ey-sy)*.38);
  return 'M'+sx+' '+sy+' C'+sx+' '+(sy+bend)+' '+ex+' '+(ey-bend)+' '+ex+' '+ey;
 }
 function clearVisuals(){
  nodes.querySelectorAll('.path-current,.path-visited,.path-source').forEach(el=>el.classList.remove('path-current','path-visited','path-source'));
  svg.querySelectorAll('.route-visited,.route-current').forEach(el=>el.classList.remove('route-visited','route-current'));
  layer.replaceChildren();workbench?.classList.remove('path-running');
 }
 function segment(from,to,current,color){
  const d=route(from,to);if(!d)return;
  layer.appendChild(makeSvg('path',{d,class:current?'runtime-link current':'runtime-link travelled',stroke:current?color:'#60b8a3'}));
  if(current&&(!window.matchMedia||!window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
   const packet=makeSvg('circle',{r:6,fill:color,class:'runtime-packet'});
   packet.appendChild(makeSvg('animateMotion',{dur:'0.42s',begin:'0s',fill:'freeze',path:d,calcMode:'paced'}));
   layer.appendChild(packet);
  }
  if(current)svg.querySelectorAll('.deep-edge').forEach(e=>{
   if(e.dataset.src===from&&e.dataset.dst===to)e.classList.add('route-current');
  });
 }
 function followEnabled(){return $('deepFollow')?.getAttribute('aria-pressed')!=='false'}
 function show(frame){
  clearVisuals();
  const trace=known.get(frame.id);if(!trace)return;
  const steps=trace.steps||[],upto=Math.min(frame.index,steps.length-1);
  if(upto<0)return;
  const start=originFor(trace.module),path=[start,...steps.slice(0,upto+1).map(e=>e.node)];
  for(let i=0;i<path.length;i++){
   const node=nodeDom(path[i]);if(!node)continue;
   node.classList.add(i===path.length-1?'path-current':'path-visited');
   if(i===0)node.classList.add('path-source');
  }
  for(let i=1;i<path.length;i++){
   if(path[i]===path[i-1])continue;
   segment(path[i-1],path[i],i===path.length-1,activeColor(trace.state,steps[upto]));
  }
  const step=steps[upto],n=upto+1;
  workbench?.classList.add('path-running');
  dot.className='path-runtime-dot '+(trace.state==='failed'?'error':'active');
  bar.textContent=(frame.replay?'PHÁT LẠI':'MỐC BACKEND THỰC')+' · '+(titles[trace.module]||trace.module)+' · #'+trace.id.slice(0,8).toUpperCase();
  description.textContent=step.label+' · ghi nhận +'+step.elapsedMs+' ms'+(trace.count!=null?' · '+trace.count+' món':'');
  progress.textContent=n+' / '+steps.length+' mốc';
  pending.textContent=queue.length+' mốc còn chờ hiển thị';
  text('deepLivePath','Đang trình bày '+(frame.replay?'lại':'mốc vừa nhận')+': '+step.node.toUpperCase()+' → '+step.label+' · thời gian server +'+step.elapsedMs+' ms');
  const viewport=$('deepViewport'),el=nodeDom(step.node);
  if(viewport&&el&&viewport.clientWidth<730&&followEnabled()){
   const size=parseFloat(($('deepScale')?.textContent||'70').replace('%',''))/100||.7;
   const pos=Math.max(0,el.offsetLeft*size-viewport.clientWidth/2+el.offsetWidth*size/2);
   if(Math.abs(viewport.scrollLeft-pos)>90)viewport.scrollTo({left:pos,behavior:'smooth'});
  }
 }
 function stopPlayback(){
  if(timeout){clearTimeout(timeout);timeout=null}
  if(linger){clearTimeout(linger);linger=null}
  queue.length=0;running=false;clearVisuals();
 }
 function advance(){
  if(!followEnabled()){stopPlayback();return}
  if(!queue.length){
   running=false;pending.textContent=(skipped?skipped+' mốc bỏ qua khi quá tải · ':'')+'0 mốc chờ';
   linger=setTimeout(()=>{
    clearVisuals();dot.className='path-runtime-dot';
    if(lastTrace){
     const t=known.get(lastTrace);
     bar.textContent=t?.state==='failed'?'Yêu cầu đã kết thúc với lỗi':t?.state==='success'?'Đã trình bày xong request thành công':'Sẵn sàng nhận mốc backend mới';
     description.textContent='Đường xử lý sẽ không chuyển động khi backend không phát sinh sự kiện.';
    }
   },1600);
   return;
  }
  const frame=queue.shift();
  if(!known.has(frame.id)){advance();return}
  if(linger){clearTimeout(linger);linger=null}
  lastTrace=frame.id;running=true;show(frame);
  timeout=setTimeout(advance,460);
 }
 function addFrames(trace,begin,replayMode=false){
  for(let i=begin;i<(trace.steps||[]).length;i++){
   if(queue.length>=160){queue.shift();skipped++}
   queue.push({id:trace.id,index:i,replay:replayMode});
  }
  if(!running)advance();
 }
 function store(trace){
  if(!trace?.id||!Array.isArray(trace.steps))return;
  known.delete(trace.id);known.set(trace.id,trace);
  if(known.size>100)known.delete(known.keys().next().value);
 }
 function onTrace(message){
  const t=message?.trace;
  if(!t?.id||!Array.isArray(t.steps))return;
  const previous=seen.get(t.id)||0;
  const existing=known.get(t.id);
  const from=existing&&t.steps.length<previous?0:previous;
  store(t);seen.set(t.id,t.steps.length);
  if(seen.size>100)seen.delete(seen.keys().next().value);
  if(followEnabled()&&t.steps.length>from)addFrames(t,from);
 }
 function onSnapshot(data){
  // Replay recovery only for an already observed trace. Historic traces stay historic.
  for(const trace of [...(data?.active||[]),...(data?.traces||[])]){
   if(!trace?.id||!Array.isArray(trace.steps))continue;
   const old=seen.get(trace.id);store(trace);
   if(old!==undefined&&trace.steps.length>old&&followEnabled())addFrames(trace,old);
   seen.set(trace.id,trace.steps.length);
  }
  if(!started){
   started=true;bar.textContent='Đã kết nối nguồn trace thực';
   description.textContent='Mỗi request mới được phát qua từng mốc đã ghi, không tự chạy khi không có hoạt động. Nhấn Xem lại trace để phát lại một yêu cầu cũ.';
  }
 }
 replay.addEventListener('click',()=>{
  const selected=document.querySelector('#deepTraceList [data-trace-id].is-focused')?.dataset.traceId;
  const trace=known.get(selected)||known.get(lastTrace)||[...known.values()].at(-1);
  if(!trace?.steps?.length){bar.textContent='Chưa có trace để phát lại';return}
  if(!followEnabled())$('deepFollow')?.click();
  stopPlayback();store(trace);addFrames(trace,0,true);
 });
 $('deepFollow')?.addEventListener('click',()=>{if(!followEnabled())stopPlayback()});
 document.addEventListener('saleshub:trace',ev=>onTrace(ev.detail));
 document.addEventListener('saleshub:snapshot',ev=>onSnapshot(ev.detail));
 window.addEventListener('pagehide',stopPlayback);
})();
