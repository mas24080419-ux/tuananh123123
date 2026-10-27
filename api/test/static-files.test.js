'use strict';
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const vm = require('node:vm');
const dir = path.join(__dirname, '../public');
const serve = require('../static-files')(dir);
let server, origin;
before(async () => {
  server = http.createServer((req, res) => {
    serve(req, res, new URL(req.url, 'http://localhost').pathname).then(found => {
      if (!found) { res.writeHead(404); res.end(); }
    }).catch(error => { res.writeHead(500); res.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));
function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(origin + url, {headers}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status:response.statusCode, headers:response.headers, body:Buffer.concat(chunks)}));
    }).on('error', reject);
  });
}
test('all admin pages and every referenced local stylesheet/script are served', async () => {
  const routes = ['/', '/staff/lockers', '/admin', '/admin/orders', '/admin/operations', '/admin/core', '/admin/users', '/admin/payment', '/t/test-table'];
  for (const route of routes) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers['cache-control'], 'no-store');
    const html = response.body.toString();
    assert(!/<style[\s>]/i.test(html), route + ' contains inline stylesheet');
    assert(!/<script(?:\s[^>]*)?>\s*[^<\s]/i.test(html), route + ' contains inline script');
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"?#]+(?:\.css|\.js|\.svg))(?:\?[^"#]*)?"/g)].map(m => m[1]);
    for (const url of new Set(urls)) assert.equal((await request(url)).status, 200, route + ' → ' + url);
  }
});
test('assets support conditional revalidation and gzip without caching HTML', async () => {
  const asset = await request('/style.css');
  assert(asset.headers.etag);
  const cached = await request('/style.css', {'If-None-Match':asset.headers.etag});
  assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
  const zipped = await request('/style.css', {'Accept-Encoding':'gzip'});
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(zipped.body), asset.body);
  const unzipped = await request('/style.css', {'Accept-Encoding':'gzip;q=0'});
  assert.equal(unzipped.headers['content-encoding'], undefined);
});
test('server modules, schema and traversal requests are never public', async () => {
  for (const url of ['/server.js','/owner-auth.js','/schema.sql','/../server.js','/public/../server.js']) {
    assert.equal((await request(url)).status, 404, url);
  }
});
test('all public scripts remain valid classic JavaScript', () => {
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(path.join(dir,file),'utf8'),{filename:file});
  }
});
