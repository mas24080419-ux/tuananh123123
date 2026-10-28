'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('both owner pages initialize with shared authentication logic',async()=>{
  for(const page of ['admin','orders']){
    const elements=new Map(),listeners=new Map();
    function node(selector){
      if(!elements.has(selector)){
        const events=new Map();
        elements.set(selector,{
          value:'',textContent:'',className:'',
          classList:{toggle(){},contains(){return true}},
          addEventListener(type,handler){events.set(type,handler)},
          events,style:{},focus(){},reset(){},
          querySelectorAll(){return []}
        });
      }
      return elements.get(selector);
    }
    const document={querySelector:node,querySelectorAll:()=>[],body:{classList:{toggle(){}}}};
    const window={addEventListener(type,fn){listeners.set(type,fn)}};
    const context=vm.createContext({
      document,window,location:{hash:'',pathname:'/admin',replace(){}},history:{replaceState(){}},
      fetch:async()=>({ok:true,json:async()=>({role:'staff'})}),
      Intl,Date,URLSearchParams,console
    });
    const base=path.join(__dirname,'../public');
    vm.runInContext(fs.readFileSync(path.join(base,'owner-shared.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(base,page+'.js'),'utf8'),context);
    await new Promise(resolve=>setImmediate(resolve));
    assert(!node('#loginForm').events.has('submit'),page+' must not mount a duplicate login form');
    assert(node('#passwordForm').events.has('submit'),page+' must attach change password');
    assert(node('#filterForm').events.has('submit'),page+' must attach date filter');
    assert(node('#logout').events.has('click'),page+' must attach logout');
    assert.equal(node('#to').value.length,10,'default date must be filled');
  }
});
