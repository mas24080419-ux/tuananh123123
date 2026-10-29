'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {legacyLabel}=require('../api-migration-telemetry');
test('legacy usage detection classifies only deprecated paths, without token or IDs',()=>{
 assert.equal(legacyLabel('/api/admin/summary'),'/api/admin/*');
 assert.equal(legacyLabel('/api/menu/'+'a'.repeat(48)),'/api/menu/:token');
 assert.equal(legacyLabel('/api/order-status/11111111-1111-4111-8111-111111111111'),'/api/order-status/:id');
 assert.equal(legacyLabel('/api/lockers/A1/rent'),'/api/lockers/:code/{action}');
 assert.equal(legacyLabel('/api/items/11111111-1111-4111-8111-111111111111'),'/api/items/:id');
 for(const path of ['/api/orders','/api/staff/orders','/api/tables','/api/finance/reports/profitability','/api/session','/api/v1/menu','/api/webhooks/sepay','/api/webhooks/sepay-sandbox'])
  assert.equal(legacyLabel(path),null,'Do not flag canonical/external: '+path);
});
test('legacy route logger never logs real URLs, QR credentials, or bank payload',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(s.includes("console.info('SALESHUB_LEGACY_API_USED',req.method,legacy)"));
 assert(s.includes("res.setHeader('Deprecation','true')"));
 assert(!s.includes("console.info('SALESHUB_LEGACY_API_USED',req.method,originalPath)"));
});
