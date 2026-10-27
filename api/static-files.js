'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {gzipSync} = require('node:zlib');

// Only explicit pages and public CSS/JS/images are routable; server source is never exposed.
const pages = new Map([
  ['/staff/lockers', 'lockers.html'], ['/', 'staff.html'], ['/staff', 'staff.html'], ['/admin', 'admin.html'],
  ['/admin/operations', 'operations.html'], ['/admin/core', 'core.html'],
  ['/admin/orders', 'orders.html'], ['/admin/users', 'users.html'], ['/admin/payment', 'payment.html']
]);
const mime = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml; charset=utf-8'};

module.exports = function staticFiles(publicDir) {
  const assets = new Map(fs.readdirSync(publicDir)
    .filter(name => ['.css', '.js', '.svg'].includes(path.extname(name)))
    .map(name => ['/' + name, name]));
  const cache = new Map();
  function load(name) {
    if (!cache.has(name)) {
      const pending = fs.promises.readFile(path.join(publicDir, name)).then(data => ({
        data, gzip: gzipSync(data),
        etag: 'W/"' + crypto.createHash('sha256').update(data).digest('hex') + '"'
      })).catch(error => { cache.delete(name); throw error; });
      cache.set(name, pending);
    }
    return cache.get(name);
  }
  return async function serve(req, res, pathname) {
    if (req.method !== 'GET') return false;
    const name = pages.get(pathname) || (pathname.startsWith('/t/') ? 'guest.html' : assets.get(pathname));
    if (!name) return false;
    let file;
    try { file = await load(name); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const html = name.endsWith('.html');
    const headers = {'Content-Type': mime[path.extname(name)],
      'Cache-Control': html ? 'no-store' : 'public, no-cache', 'Vary': 'Accept-Encoding'};
    if (!html) {
      headers.ETag = file.etag;
      const tags = (req.headers['if-none-match'] || '').split(',').map(value => value.trim());
      if (tags.includes(file.etag) || tags.includes('*')) {
        res.writeHead(304, headers); res.end(); return true;
      }
    }
    const gzip = (req.headers['accept-encoding'] || '').split(',').some(value => {
      const [encoding, ...params] = value.trim().toLowerCase().split(';');
      const q = params.find(param => param.trim().startsWith('q='));
      return encoding === 'gzip' && (!q || Number(q.trim().slice(2)) > 0);
    });
    const body = gzip ? file.gzip : file.data;
    if (gzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers); res.end(body); return true;
  };
};
