(() => {
 'use strict';
 // Number of currently OPEN QR menu tabs. This does not count scanning the
 // QR in the camera before opening the link, and does not identify people.
 const token=location.pathname.match(/^\/t\/([0-9a-f]{48})$/)?.[1];
 if(!token||!crypto?.randomUUID)return;
 const sessionId=crypto.randomUUID();
 let timer=null,generation=0,joined=false,inFlight=false;
 const payload=()=>JSON.stringify({token,sessionId});
 async function heartbeat(){
  if(document.hidden||inFlight)return;
  inFlight=true;const version=generation;
  try{
   const r=await fetch('/api/qr/presence',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:payload()
   });
   if(r.ok&&version===generation){
    joined=true;
   }else if(!r.ok){
    joined=false;
   }
  }catch{joined=false}
  finally{inFlight=false}
 }
 function leave(){
  generation++;
  if(timer){clearInterval(timer);timer=null}
  if(!joined)return;
  joined=false;
  const body=JSON.stringify({sessionId});
  // Best-effort immediate removal; TTL (55s) recovers if this request is lost.
  if(navigator.sendBeacon){
   try{
    if(navigator.sendBeacon('/api/qr/leave',new Blob([body],{type:'text/plain;charset=UTF-8'})))return;
   }catch{}
  }
  try{void fetch('/api/qr/leave',{method:'POST',body,keepalive:true,credentials:'same-origin',headers:{'Content-Type':'text/plain'}})}catch{}
 }
 function begin(){
  if(document.hidden||timer)return;
  void heartbeat();
  timer=setInterval(()=>void heartbeat(),20000);
 }
 document.addEventListener('visibilitychange',()=>document.hidden?leave():begin());
 window.addEventListener('pagehide',leave);
 begin();
})();