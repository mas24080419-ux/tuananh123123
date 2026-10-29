'use strict';
// Bounded process-local protection. A full map rejects new keys, never evicts
// an active counter (which would let clients reset their own limit).
module.exports=function createRateLimit({now=Date.now,windowMs=60000,maxKeys=10000}={}){
 const counters=new Map();
 let nextSweep=0;
 return {
  allow(key,limit){
   const time=now();
   if(time>=nextSweep){
    for(const [k,v] of counters)if(v.expires<=time)counters.delete(k);
    nextSweep=time+10000;
   }
   let entry=counters.get(key);
   if(entry&&entry.expires<=time){counters.delete(key);entry=null}
   if(!entry){
    if(counters.size>=maxKeys)return false;
    entry={count:0,expires:time+windowMs};counters.set(key,entry);
   }
   if(entry.count>=limit)return false;
   entry.count++;return true;
  },
  size:()=>counters.size
 };
};
