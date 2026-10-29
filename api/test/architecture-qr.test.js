'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const page=fs.readFileSync(path.join(root,'public','architecture.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','architecture-qr.js'),'utf8');
const api=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('Architecture shows the QR launcher prominently, not inside collapsed legacy detail',()=>{
 assert.match(page,/<button[^>]+id="archQrLaunch"[^>]*>[\s\S]*?Hiện QR để điện thoại quét<\/button>/);
 assert(page.indexOf('id="archQrLaunch"')<page.indexOf('<details class="arch-legacy-details"'));
 assert(page.includes('id="archQrDialog"'));
 assert(page.includes('id="archQrTable"'));
 assert(page.includes('id="archQrImage"'));
 assert(page.includes('/architecture-qr.css'));
 assert(page.includes('/architecture-qr.js'));
});
test('QR preview uses real admin-readable table data and authenticated QR SVG, not demo codes',()=>{
 assert(js.includes("fetch('/api/tables',{credentials:'same-origin'"));
 assert(js.includes("t.active===true"));
 assert(js.includes("/^[0-9a-f]{48}$/i.test(t.token)"));
 assert(js.includes("const src='/qr/'+token+'.svg'"));
 assert(js.includes("const publicLink='/t/'+token"));
 assert(js.includes("image.onload"));
 assert(js.includes("image.onerror"));
 assert(!/sampleQr|qrserver|api\.qrserver|fakeQr/.test(js));
});
test('Backend continues to gate and render QR from active table',()=>{
 const start=api.indexOf("if(req.method==='GET'&&/^\\/qr\\/");
 assert(start>0);
 const qr=api.slice(start,start+800);
 assert(qr.includes('requireAuth(req,res)'));
 assert(qr.includes('canUseDining'));
 assert(qr.includes('getTable(t)'));
 assert(qr.includes("QRCode.toString(origin+'/t/'+t"));
});
