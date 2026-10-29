'use strict';
// Temporary, opt-in REST v1 router. Legacy behavior remains a single source of
// truth while clients migrate, then canonical /api routes can be promoted.
const mapping=[
 ['GET','/api/v1/health','/api/health'],
 ['GET','/api/v1/session','/api/me'],
 ['POST','/api/v1/sessions','/api/auth/login'],
 ['DELETE','/api/v1/session','/api/logout'],
 ['POST','/api/v1/sessions/logout','/api/logout'],
 ['POST','/api/v1/qr/presences','/api/qr/presence'],
 ['POST','/api/v1/qr/presences/leave','/api/qr/leave'],
 ['POST','/api/v1/staff/presences','/api/staff/order-presence'],
 ['POST','/api/v1/staff/presences/leave','/api/staff/order-presence/leave'],
 ['GET','/api/v1/tables','/api/tables'],
 ['GET','/api/v1/lockers','/api/lockers'],
 ['GET','/api/v1/staff/menu','/api/staff/menu'],
 ['GET','/api/v1/staff/orders','/api/staff/orders'],
 ['POST','/api/v1/staff/orders','/api/staff/orders'],
 ['POST','/api/v1/orders','/api/orders'],
 ['GET','/api/v1/kitchen/orders','/api/kds'],
 ['GET','/api/v1/service-receipts','/api/area/receipts'],
 ['POST','/api/v1/service-receipts','/api/area/receipts'],
 ['GET','/api/v1/finance/reports/profitability','/api/admin/financial-model'],
 ['GET','/api/v1/finance/reports/analytics','/api/admin/analytics'],
 ['GET','/api/v1/finance/overview','/api/admin/operations'],
 ['POST','/api/v1/finance/entries','/api/admin/finance/entries'],
 ['GET','/api/v1/inventory/overview','/api/admin/inventory'],
 ['POST','/api/v1/inventory/items','/api/admin/inventory/items'],
 ['POST','/api/v1/inventory/movements','/api/admin/inventory/movements'],
 ['PUT','/api/v1/inventory/recipes','/api/admin/inventory/recipes'],
 ['GET','/api/v1/inventory/ingredient-costs','/api/admin/ingredient-costs'],
 ['PUT','/api/v1/inventory/ingredient-costs','/api/admin/ingredient-costs'],
 ['GET','/api/v1/services/cost-rates','/api/admin/service-cost-rates'],
 ['PUT','/api/v1/services/cost-rates','/api/admin/service-cost-rates'],
 ['GET','/api/v1/payments/receiving-banks','/api/admin/receiving-banks'],
 ['PUT','/api/v1/payments/receiving-banks','/api/admin/receiving-banks'],
 ['GET','/api/v1/payments/bank-transactions','/api/admin/bank-transactions'],
 ['GET','/api/v1/payments/config','/api/admin/payment-settings'],
 ['PUT','/api/v1/payments/config','/api/admin/payment-settings'],
 ['GET','/api/v1/payments/bank-directory','/api/admin/payment-banks'],
 ['GET','/api/v1/payments/sepay-sandbox','/api/admin/sepay-sandbox'],
 ['GET','/api/v1/admin/summary','/api/admin/summary'],
 ['GET','/api/v1/admin/users','/api/admin/users'],
 ['POST','/api/v1/admin/users','/api/admin/users'],
 ['GET','/api/v1/admin/qr-presences','/api/admin/qr/presence'],
 ['GET','/api/v1/monitoring/architecture','/api/admin/architecture'],
 ['GET','/api/v1/monitoring/blueprint','/api/admin/architecture/blueprint'],
 ['GET','/api/v1/monitoring/architecture/recent','/api/admin/architecture/recent'],
 ['GET','/api/v1/monitoring/architecture/live','/api/admin/architecture/live'],
 ['GET','/api/v1/monitoring/system/recent','/api/admin/architecture/system/recent'],
 ['GET','/api/v1/monitoring/system/live','/api/admin/architecture/system/live'],
 ['GET','/api/v1/history/orders','/api/history']
];
const exact=new Map(mapping.map(([method,src,dst])=>[method+' '+src,dst]));
const uuid='[0-9a-f-]{36}';
const dynamic=[
 ['GET',new RegExp('^/api/v1/orders/('+uuid+')$'),'/api/order-status/'],
 ['GET',new RegExp('^/api/v1/qr/tables/([0-9a-f]{48})/menu$'),'/api/menu/'],
 ['PATCH',new RegExp('^/api/v1/order-items/('+uuid+')$'),'/api/items/'],
 ['POST',new RegExp('^/api/v1/staff/orders/('+uuid+')/payment-confirmations$'),'/api/staff/orders/','$1/confirm-payment'],
 ['POST',new RegExp('^/api/v1/admin/orders/('+uuid+')/payment-confirmations$'),'/api/admin/orders/','$1/confirm-payment'],
 ['POST',/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/rentals$/,'/api/lockers/','$1/rent'],
 ['POST',/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/returns$/,'/api/lockers/','$1/release'],
 ['POST',/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/payments$/,'/api/lockers/','$1/collect'],
 ['PUT',new RegExp('^/api/v1/inventory/items/('+uuid+')/reorder-level$'),'/api/admin/inventory/items/','$1/reorder']
];
function resolveRestV1(path,method){
 if(!path.startsWith('/api/v1/'))return path;
 const key=method.toUpperCase()+' '+path;
 if(exact.has(key))return exact.get(key);
 const core=path.match(/^\/api\/v1\/admin\/core\/(.*)$/);
 if(core)return '/api/admin/core/'+core[1]; // current CRUD uses resource names internally
 const menu=path.match(/^\/api\/v1\/qr\/tables\/([0-9a-f]{48})\/payment-recipient$/);
 if(method==='GET'&&menu)return '/api/payment/recipient'; // token is separately supplied as query
 for(const [m,pattern,base,suffix] of dynamic){
  if(method!==m)continue;
  const hit=path.match(pattern);
  if(hit)return base+hit[1]+(suffix?suffix.replace('$1',''):'');
 }
 return '/api/__unknown-rest-v1-route';
}
module.exports={resolveRestV1,mapping};
