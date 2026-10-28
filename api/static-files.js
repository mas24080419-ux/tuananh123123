'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {gzipSync, brotliCompressSync, constants} = require('node:zlib');

// Only explicit pages and public CSS/JS/images are routable; server source is never exposed.
const pages = new Map([
  ['/staff/lockers', 'lockers.html'], ['/staff/orders', 'staff-orders.html'], ['/', 'login.html'], ['/login', 'login.html'], ['/staff', 'staff.html'], ['/admin', 'admin.html'],
  ['/admin/operations', 'operations.html'], ['/admin/inventory', 'inventory.html'], ['/admin/core', 'core.html'],
  ['/admin/orders', 'orders.html'], ['/admin/architecture', 'architecture.html'], ['/admin/users', 'users.html'], ['/admin/payment', 'payment.html']
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
        data,
        variants: Object.create(null),
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
    // Compress each variant only if requested. Browser assets are cached per process.
    const accepted = new Map();
    for (const part of (req.headers['accept-encoding'] || '').toLowerCase().split(',')) {
      const [name, ...params] = part.split(';').map(s => s.trim());
      if (!name) continue;
      const q = params.find(p => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      accepted.set(name, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
    }
    const allows = encoding => (accepted.get(encoding) ?? accepted.get('*') ?? 0) > 0;
    const encoding = allows('br') ? 'br' : allows('gzip') ? 'gzip' : null;
    let body = file.data;
    if (encoding === 'br') {
      body = file.variants.br ||= brotliCompressSync(file.data, {
        params: {[constants.BROTLI_PARAM_QUALITY]: 5}
      });
    } else if (encoding === 'gzip') {
      body = file.variants.gzip ||= gzipSync(file.data);
    }
    if (encoding) headers['Content-Encoding'] = encoding;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers); res.end(body); return true;
  };
};
