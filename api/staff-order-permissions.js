'use strict';
const hasRole=(a,roles)=>Boolean(a&&!a.workArea&&(a.role==='admin'||(a.userId&&roles.includes(a.role))));
const canManageOrders=a=>hasRole(a,['waiter','cashier','manager']);
const canConfirmOrderPayment=a=>hasRole(a,['cashier','manager']);
const canChangeOrderItem=(a,from,to,station)=>{
 if(!a||a.workArea)return false;
 if(a.role==='admin'||(a.userId&&a.role==='manager'))return true;
 if(a.userId&&['waiter','cashier'].includes(a.role))
  return (from==='new'&&to==='cancelled')||(from==='ready'&&to==='served');
 if(a.userId&&['kitchen','bar'].includes(a.role))return a.role===station;
 return false;
};
module.exports={canManageOrders,canConfirmOrderPayment,canChangeOrderItem};
