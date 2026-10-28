'use strict';
// Server-authoritative landing pages; the UI may navigate, but API permissions stay enforced.
module.exports=function homeFor(actor){
 if(!actor)return '/login';
 if(actor.role==='admin')return '/admin';
 if(actor.workArea==='equipment')return '/staff/lockers';
 if(actor.workArea==='restroom')return '/staff';
 if(['waiter','cashier','manager'].includes(actor.role))return '/staff/orders';
 if(['kitchen','bar'].includes(actor.role))return '/staff?kds=1';
 return '/login';
};
