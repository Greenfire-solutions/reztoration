// Reztoration: the map of the United States drawn by Indigenous nations.
// node server.mjs  (port 8600, tests use 8602)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from './lib/library.mjs';
import { TreatyStore } from './lib/treaty-store.mjs';
import { Today } from './lib/today.mjs';
import { Places, STATES } from './lib/places.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8600);
const started = new Date().toISOString();
const lib = new Library(root);
const treaties = new TreatyStore(root, lib);
const today = new Today(root, lib);
const places = new Places(root, lib, treaties, today);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATIC = [
  ['/vendor/three/', path.join(root, 'node_modules/three/')],
  ['/', path.join(root, 'public/')],
];

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, { error: 'forbidden' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return fs.createReadStream(file).pipe(res);
    }
  }
  send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/whoami') return send(res, 200, { app: 'reztoration', root, pid: process.pid, started });
    if (p === '/api/stats') return send(res, 200, lib.stats());
    if (p === '/api/search') {
      // One box for everything: homelands, nations today, lands, treaties, businesses, towns, then library items.
      const q = url.searchParams.get('q') || '';
      const found = lib.searchPlaces(q);
      return send(res, 200, {
        q,
        homelands: found.filter((x) => x.type === 'territory').slice(0, 8),
        nations: found.filter((x) => x.type === 'nation').slice(0, 6),
        lands: found.filter((x) => x.type === 'land').slice(0, 5),
        treaties: treaties.search(q, 6),
        businesses: today.search(q, 5),
        towns: places.find(q).slice(0, 4),
        items: lib.searchItems(q, 8),
      });
    }
    if (p === '/api/where') {
      const sp = url.searchParams;
      const lon = Number(sp.get('lon')), lat = Number(sp.get('lat'));
      if (sp.has('lon') && Number.isFinite(lon) && Number.isFinite(lat)) {
        const out = places.at([lon, lat]);
        return out ? send(res, 200, out) : send(res, 404, { error: 'outside the map' });
      }
      return send(res, 200, { matches: places.find(sp.get('q') || ''), gazetteer: places.hasGazetteer() });
    }
    if (p === '/api/states') return send(res, 200, STATES);
    if (p === '/api/browse') {
      const sp = url.searchParams;
      const opts = { offset: Math.max(0, Number(sp.get('offset')) || 0), limit: Math.min(120, Number(sp.get('limit')) || 48), q: sp.get('q') || '' };
      return send(res, 200, sp.get('group') === 'plants' ? lib.browsePlants({ ...opts, use: sp.get('use') || '' }) : lib.browse(sp.get('group') || '', opts));
    }
    const one = (out, what) => (out ? send(res, 200, out) : send(res, 404, { error: `unknown ${what}` }));
    if (p === '/api/treaties') return send(res, 200, treaties.summary());
    if (p === '/api/broken') return send(res, 200, treaties.broken());
    if (p.startsWith('/api/treaty/')) return one(treaties.treaty(decodeURIComponent(p.slice(12))), 'treaty');
    if (p.startsWith('/api/cession/')) return one(treaties.cession(decodeURIComponent(p.slice(13))), 'cession');
    if (p === '/api/today') return send(res, 200, today.map());
    if (p === '/api/businesses') {
      const sp = url.searchParams;
      return send(res, 200, today.list({ category: sp.get('category') || '', q: sp.get('q') || '', state: sp.get('state') || '', offset: Math.max(0, Number(sp.get('offset')) || 0), limit: Math.min(120, Number(sp.get('limit')) || 60) }));
    }
    if (p.startsWith('/api/business/')) return one(today.business(decodeURIComponent(p.slice(14))), 'business');
    if (p.startsWith('/api/nation/')) return one(today.nation(decodeURIComponent(p.slice(12)), treaties), 'nation');
    const tr = p.match(/^\/api\/territory\/([^/]+)\/treaties$/);
    if (tr) return one(treaties.forTerritory(decodeURIComponent(tr[1])), 'territory');
    const sub = p.match(/^\/api\/territory\/([^/]+)\/(items|plants)$/);
    if (sub) {
      const id = decodeURIComponent(sub[1]);
      const sp = url.searchParams;
      const opts = { offset: Math.max(0, Number(sp.get('offset')) || 0), limit: Math.min(120, Number(sp.get('limit')) || 48), q: sp.get('q') || '' };
      const out = sub[2] === 'items' ? lib.items(id, sp.get('group') || '', opts) : lib.plants(id, { ...opts, use: sp.get('use') || '' });
      return out ? send(res, 200, out) : send(res, 404, { error: 'unknown territory' });
    }
    if (p.startsWith('/api/territory/')) {
      const out = lib.territory(decodeURIComponent(p.slice('/api/territory/'.length)));
      return out ? send(res, 200, out) : send(res, 404, { error: 'unknown territory' });
    }
    if (p.startsWith('/api/land/')) {
      const out = lib.land(decodeURIComponent(p.slice('/api/land/'.length)));
      return out ? send(res, 200, out) : send(res, 404, { error: 'unknown land' });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown api' });
    serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is taken by something else. Not starting.`); process.exit(3); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(`Reztoration on http://localhost:${PORT}`));
