'use strict';
const areas={equipment:{name:'Phao bơi & tủ đồ',services:{float:'Thuê phao bơi',locker:'Thuê tủ đồ'}},restroom:{name:'Nhà vệ sinh',services:{restroom:'Dịch vụ nhà vệ sinh'}}};
const canAccess=(actor,area)=>Boolean(actor&&Object.hasOwn(areas,area)&&(actor.role==='admin'||(actor.userId&&actor.workArea===area)));
const canUseDining=actor=>Boolean(actor&&!actor.workArea&&['admin','staff','manager','cashier','waiter','kitchen','bar'].includes(actor.role));
module.exports={areas,canAccess,canUseDining};
