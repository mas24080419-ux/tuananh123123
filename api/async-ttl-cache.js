'use strict';
// Share identical read-only queries for a short time, without caching errors.
module.exports=function createAsyncTtlCache(load,{ttlMs=900,now=()=>Date.now()}={}){
 if(typeof load!=='function'||!Number.isFinite(ttlMs)||ttlMs<0)throw TypeError('Invalid cache options');
 let value,ready=false,expiry=0,version=0,inFlight=null;
 async function get(){
  if(ready&&now()<expiry)return value;
  if(inFlight&&inFlight.version===version)return inFlight.promise;
  const epoch=version;
  const pending=Promise.resolve().then(load).then(result=>{
   if(epoch===version){value=result;ready=true;expiry=now()+ttlMs}
   return result;
  }).finally(()=>{if(inFlight?.promise===pending)inFlight=null});
  inFlight={version:epoch,promise:pending};
  return pending;
 }
 function invalidate(){version++;value=undefined;ready=false;expiry=0;inFlight=null}
 return {get,invalidate};
};
