'use strict';
const areas={equipment:{name:'Phao bơi & tủ đồ',services:{float:'Thuê phao bơi',locker:'Thuê tủ đồ'}},restroom:{name:'Nhà vệ sinh',services:{restroom:'Dịch vụ nhà vệ sinh'}}};
const floatTypes={child_vest:{name:'Áo phao trẻ em',price:20000},black_adult:{name:'Phao bơi đen (người lớn)',price:30000},child_float:{name:'Phao bơi trẻ em',price:20000}};
const canAccess=(actor,area)=>Boolean(actor&&Object.hasOwn(areas,area)&&(actor.role==='admin'||(actor.userId&&actor.workArea===area)));
const canUseDining=actor=>Boolean(actor&&!actor.workArea&&['admin','staff','manager','cashier','waiter','kitchen','bar'].includes(actor.role));
module.exports={areas,floatTypes,canAccess,canUseDining};
