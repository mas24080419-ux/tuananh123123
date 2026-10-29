'use strict';
// Redacted legacy-route visibility for safe removal decisions.
// Do not log UUID, QR token, amount, payload, IP address or bank account.
// External webhook URLs must NOT be deprecated because SePay may call them.
const rules=[
 [/^\/api\/admin\//,'/api/admin/*'],
 [/^\/api\/auth\/login$/,'/api/auth/login'],
 [/^\/api\/me$/,'/api/me'],
 [/^\/api\/logout$/,'/api/logout'],
 [/^\/api\/menu\/[0-9a-f]{48}$/i,'/api/menu/:token'],
 [/^\/api\/order-status\/[0-9a-f-]{36}$/i,'/api/order-status/:id'],
 [/^\/api\/payment\/recipient$/,'/api/payment/recipient'],
 [/^\/api\/kds$/,'/api/kds'],
 [/^\/api\/items\/[0-9a-f-]{36}$/i,'/api/items/:id'],
 [/^\/api\/area\/receipts$/,'/api/area/receipts'],
 [/^\/api\/lockers\/[AB](?:[1-9]|[12][0-9]|30)\/(?:rent|release|collect)$/i,'/api/lockers/:code/{action}'],
 [/^\/api\/staff\/orders\/[0-9a-f-]{36}\/confirm-payment$/i,'/api/staff/orders/:id/confirm-payment'],
 [/^\/api\/staff\/order-presence(?:\/leave)?$/,'/api/staff/order-presence'],
 [/^\/api\/users\/login$/,'/api/users/login']
];
function legacyLabel(path){
 if(typeof path!=='string'||path.startsWith('/api/webhooks/'))return null;
 for(const [regex,label] of rules)if(regex.test(path))return label;
 return null;
}
module.exports={legacyLabel};
