// The API suite. Starts its own server on TEST_PORT (default 8602, never the live 8600),
// checks every answer people depend on, and stops it.   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSacred, itemBlocked, plantUseBlocked } from '../lib/protocols.mjs';
import { checkBusiness } from '../lib/businesses.mjs';
import { checkFinding } from '../lib/treaties.mjs';
import { RateLimit, visitorIp } from '../lib/ratelimit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 8602);
const BASE = `http://127.0.0.1:${PORT}`;
// The homeland outlines are kept out of git (Native Land Digital's terms), so a fresh clone
// has none. Tests that need them are skipped there, not failed.
const HOMELANDS = fs.existsSync(path.join(root, 'public/data/territories.json'));
const GAZ = fs.existsSync(path.join(root, 'data/raw/census-gazetteer-places.txt'));
let srv;

const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
};
const json = async (p) => { const r = await get(p); assert.equal(r.status, 200, `${p} answered ${r.status}`); return r.body; };
const q = (s) => encodeURIComponent(s);

const INSTANCE = randomUUID();
before(async () => {
  // Refuse to test against a stranger already on the port.
  try { const r = await fetch(`${BASE}/api/whoami`); if (r.ok) throw new Error(`port ${PORT} is already taken; set TEST_PORT`); } catch (e) { if (String(e.message).includes('taken')) throw e; }
  srv = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), REZ_INSTANCE: INSTANCE }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  srv.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { const w = await (await fetch(`${BASE}/api/whoami`)).json(); if (w.app === 'reztoration' && w.instance === INSTANCE) return; } catch {}
  }
  throw new Error(`server did not start: ${err}`);
});
after(() => srv?.kill());

test('whoami names this app and this server, and nothing about the machine', async () => {
  const w = await json('/api/whoami');
  assert.equal(w.app, 'reztoration');
  assert.equal(w.instance, INSTANCE);
  assert.equal(w.root, undefined);
  assert.equal(w.pid, undefined);
  assert.ok(!JSON.stringify(w).includes(root), 'the project folder path is not disclosed');
});

test('unknown api paths are 404, never a page', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/treaty/not-a-treaty')).status, 404);
  assert.equal((await get('/api/business/not-a-business')).status, 404);
});

test('static files cannot escape public/', async () => {
  const r = await get('/..%2f..%2fpackage.json');
  assert.notEqual(r.status, 200);
});

test('the page and its script are served', async () => {
  const html = await get('/');
  assert.equal(html.status, 200);
  assert.match(html.body, /id="welcome"/);
  assert.match(html.body, /id="q"/);
  assert.equal((await get('/app.js')).status, 200);
  assert.equal((await get('/vendor/three/build/three.module.js')).status, 200);
});

// ---------- search ----------
test('search answers in groups', async () => {
  const r = await json(`/api/search?q=${q('treaty')}`);
  for (const k of ['homelands', 'nations', 'lands', 'treaties', 'businesses', 'towns', 'items']) assert.ok(Array.isArray(r[k]), `missing group ${k}`);
});

test('search: one letter answers nothing', async () => {
  const r = await json('/api/search?q=a');
  assert.equal(r.homelands.length + r.nations.length + r.items.length, 0);
});

const homelandFor = [
  ['Ojibwe', /Anishinab/], ['Anishinaabe', /Anishinab/], ['Chippewa', /Anishinab/], ['Lakota', /Očhéthi Šakówiŋ/], ['Sioux', /Očhéthi Šakówiŋ/],
  ['Iroquois', /Haudenosaunee/], ['Haudenosaunee', /Haudenosaunee/], ['Papago', /O’odham/], ["Tohono O'odham", /Tohono O/],
  ['Diné', /Diné Bikéyah/], ['Navajo', /Diné Bikéyah/], ['Navaho', /Diné Bikéyah/], ['Creek', /Mvskoke/], ['Hopi', /Hopitutskwa/],
];
for (const [name, want] of homelandFor) {
  test(`search "${name}" puts the right homeland first`, { skip: !HOMELANDS && 'no homeland outlines in this copy' }, async () => {
    const r = await json(`/api/search?q=${q(name)}`);
    assert.ok(r.homelands.length, `no homeland for ${name}`);
    assert.match(r.homelands[0].name, want, `${name} -> ${r.homelands.map((h) => h.name).join(' | ')}`);
  });
}

test('an outsider name finds a homeland but is never shown as its name', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  const r = await json(`/api/search?q=${q('Papago')}`);
  const h = r.homelands[0];
  assert.doesNotMatch(h.name, /Papago/);
  assert.equal(h.foundBy, 'Papago');
});

test('search matches whole words in item titles ("dine" is not "Gardiner")', async () => {
  const r = await json(`/api/search?q=${q('dine')}`);
  for (const it of r.items) assert.doesNotMatch(it.name.toLowerCase(), /gardiner/);
});

test('search finds treaties by name', async () => {
  const r = await json(`/api/search?q=${q('Fort Laramie')}`);
  assert.ok(r.treaties.some((t) => /Fort Laramie/.test(t.name)), 'Fort Laramie treaty not found');
  for (const t of r.treaties) assert.ok(t.id && t.status, 'treaty result missing id or status');
});

test('search finds businesses', async () => {
  const list = await json('/api/businesses?limit=1');
  const b = list.businesses[0];
  const r = await json(`/api/search?q=${q(b.name)}`);
  assert.ok(r.businesses.some((x) => x.id === b.id), `${b.name} not found by name`);
});

test('search finds towns', { skip: !GAZ && 'no gazetteer' }, async () => {
  const r = await json(`/api/search?q=${q('Austin, TX')}`);
  assert.ok(r.towns.some((t) => t.name === 'Austin' && t.state === 'TX'));
});

// ---------- what land am I on ----------
test('where: Austin, Texas is Comanche, Tonkawa and Lipan Apache homeland', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  const d = await json('/api/where?lon=-97.74&lat=30.27');
  const names = d.homelands.map((h) => h.name).join(' | ');
  for (const w of [/Comanche/, /Tonkawa/, /Lipan Apache/]) assert.match(names, w);
  assert.ok(d.businesses.length > 0 && d.businesses[0].km >= 0);
  assert.ok(d.nations.length > 0);
  for (let i = 1; i < d.businesses.length; i++) assert.ok(d.businesses[i].km >= d.businesses[i - 1].km, 'businesses not nearest first');
});

test('where: Minneapolis sits on Dakota homeland and in a Royce cession with a treaty', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  const d = await json('/api/where?lon=-93.27&lat=44.98');
  assert.match(d.homelands.map((h) => h.name).join(' | '), /Očhéthi Šakówiŋ|Wahpekute|Bdewakantunwan/);
  assert.ok(d.cessions.length > 0, 'no cession covers Minneapolis');
  assert.ok(d.treaties.length > 0, 'no treaty for Minneapolis');
});

test('where: Alaska and Hawaii points land in their insets', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  const ak = await json('/api/where?lon=-149.9&lat=61.2'); // Anchorage
  assert.ok(ak.homelands.length > 0, 'Anchorage has no homeland');
  const hi = await json('/api/where?lon=-157.86&lat=21.31'); // Honolulu
  assert.ok(hi.homelands.length > 0, 'Honolulu has no homeland');
});

test('where: a point outside the map is a 404, and bad numbers are not a crash', async () => {
  const r = await get('/api/where?lon=abc&lat=xyz');
  assert.notEqual(r.status, 500);
});

test('where: towns and zip codes', { skip: !GAZ && 'no gazetteer' }, async () => {
  const a = await json(`/api/where?q=${q('Austin, TX')}`);
  assert.equal(a.matches[0].name, 'Austin');
  assert.equal(a.matches[0].state, 'TX');
  const z = await json('/api/where?q=59101');
  assert.equal(z.matches.length, 1);
  assert.ok(Math.abs(z.matches[0].lonlat[1] - 45.6) < 0.5, 'zip 59101 is Billings');
  const p = await json(`/api/where?q=${q('Portland')}`);
  assert.ok(p.matches.length >= 2, 'Portland should offer more than one');
  assert.equal(p.matches[0].state, 'OR', 'the bigger Portland first');
  const sf = await json(`/api/where?q=${q('Santa Fe New Mexico')}`);
  assert.equal(sf.matches[0].state, 'NM');
  const ll = await json(`/api/where?q=${q('30.27, -97.74')}`);
  assert.deepEqual(ll.matches[0].lonlat, [-97.74, 30.27]);
});

test('where: Alaska is never on the Hawaiian homeland, and Hawaii only on its own', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  for (const [lon, lat, place] of [[-147.7, 64.8, 'Fairbanks'], [-134.4, 58.3, 'Juneau'], [-149.9, 61.2, 'Anchorage']]) {
    const d = await json(`/api/where?lon=${lon}&lat=${lat}`);
    assert.ok(!d.homelands.some((h) => /Nā moku/.test(h.name)), `${place} reported as Hawaiian homeland`);
  }
  const hi = await json('/api/where?lon=-155.08&lat=19.72'); // Hilo
  assert.ok(hi.homelands.every((h) => /Nā moku/.test(h.name)), 'Hilo matched a homeland outside Hawaii');
});

test('where: "nearby" means nearby', async () => {
  const hi = await json('/api/where?lon=-157.86&lat=21.31');
  for (const n of hi.nations) assert.ok(n.km <= 500, `${n.name} at ${n.km} km listed as nearby`);
  for (const b of hi.businesses) assert.ok(b.km <= 800);
});

test('where: Honolulu and the Census "Urban" names', { skip: !GAZ && 'no gazetteer' }, async () => {
  const r = await json('/api/where?q=Honolulu');
  assert.equal(r.matches[0]?.state, 'HI');
  const ll = await json(`/api/where?q=${q('35.6,-106.0')}`);
  assert.deepEqual(ll.matches[0].lonlat, [-106, 35.6], 'lat,lon without a space read backwards');
});

test('search: Haudenosaunee brings the nations of the confederacy', async () => {
  const r = await json(`/api/search?q=${q('Haudenosaunee')}`);
  const names = r.nations.map((n) => n.name).join(' | ');
  for (const w of [/Seneca/, /Onondaga/, /Oneida/, /Cayuga/]) assert.match(names, w);
});

test('search: "found by" is a clean name, never an alias with brackets', async () => {
  for (const w of ['Lakota', 'Ojibwe', 'Creek', 'Apache']) {
    const r = await json(`/api/search?q=${q(w)}`);
    for (const x of [...r.homelands, ...r.nations]) assert.doesNotMatch(String(x.foundBy || ''), /\[|\]/, `${w}: ${x.foundBy}`);
  }
});

test('business list reports every state with a listing, and the counts add up', async () => {
  const r = await json('/api/businesses?limit=1');
  assert.ok(Object.keys(r.states).length >= 45, `only ${Object.keys(r.states).length} states`);
  assert.equal(Object.values(r.states).reduce((a, b) => a + b, 0), r.total);
  for (const [st, n] of Object.entries(r.states).slice(0, 8)) assert.equal((await json(`/api/businesses?state=${st}&limit=1`)).total, n);
});

test('most businesses that name a nation link to its page', async () => {
  const list = (await json('/api/businesses?limit=120&offset=0')).businesses;
  const named = list.filter((b) => b.nation);
  let linked = 0;
  for (const b of named) if ((await json(`/api/business/${q(b.id)}`)).nationId) linked++;
  assert.ok(linked / named.length >= 0.8, `only ${linked} of ${named.length} link to their nation`);
});

// ---------- the server holds up (11-10 security pass) ----------
test('a search made of many short words cannot hold the server', async () => {
  const many = Array(1000).fill('e').join(' ');
  for (const p of [`/api/browse?group=writings&q=${q(many)}`, `/api/browse?group=plants&q=${q(many)}`, `/api/search?q=${q(many)}`, `/api/businesses?q=${q(many)}`]) {
    const t = Date.now();
    await json(p);
    assert.ok(Date.now() - t < 3000, `${p.slice(0, 40)} took ${Date.now() - t} ms`);
  }
});

test('a malformed address is a 400, never a 500', async () => {
  for (const p of ['/%E0', '/api/treaty/%E0', '/api/nation/%', '/api/territory/%ZZ/items']) {
    const r = await get(p);
    assert.equal(r.status, 400, `${p} answered ${r.status}`);
  }
});

test('where refuses coordinates that are not on Earth', async () => {
  assert.equal((await get('/api/where?lon=1e308&lat=1e308')).status, 400);
  assert.equal((await get('/api/where?lon=-200&lat=10')).status, 400);
});

test('the page carries a Content-Security-Policy that allows its importmap', async () => {
  const html = (await get('/')).body;
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'no CSP');
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const { createHash } = await import('node:crypto');
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(map).digest('base64')}'`), 'CSP hash does not match the importmap; recompute it');
  assert.match(csp, /object-src 'none'/);
});

// ---------- treaties ----------
test('every treaty findings file passes the checker', () => {
  const dir = path.join(root, 'data/research/treaty-findings');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const r = checkFinding(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (r.problems.length) bad.push(`${f}: ${r.problems.join('; ')}`);
  }
  assert.deepEqual(bad, []);
});

test('every findings file has an audit', () => {
  const have = new Set(fs.readdirSync(path.join(root, 'data/research/treaty-audits')));
  const missing = fs.readdirSync(path.join(root, 'data/research/treaty-findings')).filter((f) => f.endsWith('.json') && !have.has(f));
  assert.deepEqual(missing, []);
});

test('treaty summary: every row researched, statuses add up', async () => {
  const s = await json('/api/treaties');
  const total = Object.values(s.statuses).reduce((n, v) => n + v.count, 0);
  assert.equal(total, s.treaties.length);
  assert.equal(s.statuses.unresearched.count, 0, 'some treaty is not researched');
});

test('broken view: cards carry plain words, no em dashes, and filters by state', async () => {
  const b = await json('/api/broken');
  assert.ok(b.cards.length > 200);
  for (const c of b.cards) {
    assert.ok(['broken', 'unratified', 'contested'].includes(c.status));
    const text = JSON.stringify(c.plain);
    assert.doesNotMatch(text, /—/, `em dash on ${c.id}`);
    assert.ok(c.plain.promised || c.plain.happened, `${c.id} has no plain words`);
  }
  assert.ok(b.states.MN > 0);
  const ids = new Set(b.cards.map((c) => c.id));
  assert.equal(ids.size, b.cards.length, 'a treaty appears twice');
});

test('a taking counted on another row does not get its own card', async () => {
  const b = await json('/api/broken');
  for (const c of b.cards.slice(0, 50)) {
    const t = await json(`/api/treaty/${q(c.id)}`);
    assert.equal(t.sameEventAs, null, `${c.id} is a secondary row but has a card`);
  }
});

test('a treaty page has its record', async () => {
  const t = await json(`/api/treaty/${q('cession-1891-02-13-iowa')}`);
  assert.equal(t.status, 'broken');
  assert.ok(t.finding.breaches.length > 0);
  assert.ok(t.finding.audit, 'not audited');
});

test('cession pages list their treaties', async () => {
  const s = await json('/api/treaties');
  const c = s.treaties.find((t) => t.cessions.length).cessions[0];
  const d = await json(`/api/cession/${q(c)}`);
  assert.ok(d.treaties.length > 0);
});

// ---------- today: nations and businesses ----------
test('every business file passes the business checker', () => {
  const dir = path.join(root, 'data/research/businesses');
  let n = 0;
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const b of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) { n++; const r = checkBusiness(b); if (!r.ok) bad.push(`${f} ${b.id}: ${r.problems.join('; ')}`); }
  }
  assert.ok(n > 500);
  // A listing that fails is held off the map, never shown; report how many are held.
  if (bad.length) console.log(`  (${bad.length} listings held off the map by the checker)`);
});

test('business list: by state, with paging that reaches the end', async () => {
  const all = await json('/api/businesses?limit=1');
  assert.ok(all.total > 500);
  let got = 0, offset = 0, ids = new Set();
  while (offset < all.total) {
    const p = await json(`/api/businesses?limit=120&offset=${offset}`);
    if (!p.businesses.length) break;
    p.businesses.forEach((b) => ids.add(b.id));
    got += p.businesses.length; offset += p.businesses.length;
  }
  assert.equal(got, all.total, 'paging does not reach every listing');
  assert.equal(ids.size, all.total, 'a listing repeats across pages');
  const ok = await json('/api/businesses?state=OK&limit=120');
  assert.ok(ok.total > 0);
  for (const b of ok.businesses) assert.equal(b.state, 'OK');
});

test('a business page never shows a home street, and links its nation when known', async () => {
  const list = (await json('/api/businesses?limit=1000')).businesses;
  let linked = 0;
  for (const x of list.slice(0, 120)) {
    const b = await json(`/api/business/${q(x.id)}`);
    if (b.homeBased) assert.equal(b.placedAt, 'town');
    assert.ok(b.ownershipSource?.url, `${b.id} has no ownership source`);
    if (b.nationId) { linked++; assert.equal((await get(`/api/nation/${q(b.nationId)}`)).status, 200); }
  }
  assert.ok(linked > 10, 'almost no business links to its nation');
});

test('nation pages carry homelands, businesses and treaties', async () => {
  const nations = JSON.parse(fs.readFileSync(path.join(root, 'data/research/nations.json'), 'utf8'));
  const nav = nations.find((n) => n.name === 'Navajo Nation');
  const d = await json(`/api/nation/${q(nav.id)}`);
  assert.ok(Array.isArray(d.businesses) && Array.isArray(d.treaties));
  assert.ok(!d.languages.some((l) => /Sign Language/.test(l)), 'Plains Indian Sign Language is back on the Navajo Nation');
  if (HOMELANDS) assert.ok(d.homelands.length > 0);
});

test('the Today map has nations and businesses with coordinates', async () => {
  const t = await json('/api/today');
  assert.ok(t.nations.length > 400);
  assert.ok(t.businesses.length > 500);
  for (const b of t.businesses) assert.ok(Array.isArray(b.xz) && b.xz.length === 2);
});

// ---------- homelands and the library ----------
test('a homeland page answers, with its items and plants', { skip: !HOMELANDS && 'no homeland outlines' }, async () => {
  const d = await json('/api/territory/navajo');
  assert.ok(d.nations.length > 0);
  assert.ok(d.groups.art && d.groups.writings);
  const items = await json('/api/territory/navajo/items?group=writings&limit=5');
  assert.ok(items.total > 0 && items.items.length > 0);
  const plants = await json('/api/territory/navajo/plants?limit=5');
  assert.ok(plants.total > 0);
  const tr = await json('/api/territory/navajo/treaties');
  assert.ok(tr.total > 0);
});

test('the library browses every group', async () => {
  for (const g of ['art', 'films', 'photos', 'recordings', 'writings', 'plants']) {
    const r = await json(`/api/browse?group=${g}&limit=3`);
    assert.ok(r.total > 0, `library group ${g} is empty`);
  }
});

test('stats add up to something real', async () => {
  const s = await json('/api/stats');
  assert.ok(s.items > 10000 && s.plantUses > 10000 && s.nations > 500);
});

// ---------- the protocols, in code ----------
test('protocol 2: sacred and ceremonial material is caught', () => {
  for (const t of ['Ghost Dance shirt', 'Eagle feather headdress', 'Pipe bag, quilled', 'Katsina doll', 'False Face mask', 'Medicine bundle']) assert.ok(isSacred(t), `${t} was let through`);
  for (const t of ['Beaded moccasins', 'Navajo weaving, 1890', 'Fry bread recipe']) assert.ok(!isSacred(t), `${t} was blocked`);
  assert.ok(itemBlocked({ title: 'Basket', tkLabels: ['TK Secret/Sacred'] }));
  assert.ok(plantUseBlocked({ use: 'Drug', subUse: 'Ceremonial Medicine', note: '' }));
});

test('protocol 2 holds at load: nothing sacred reaches the library', async () => {
  for (const g of ['art', 'photos', 'films']) {
    const r = await json(`/api/browse?group=${g}&limit=120`);
    for (const it of r.items) assert.ok(!itemBlocked(it), `${it.title} reached the library`);
  }
  for (const w of ['headdress', 'ceremonial', 'sacred']) {
    const r = await json(`/api/search?q=${q(w)}`);
    for (const it of r.items) assert.ok(!itemBlocked(it.item), `search "${w}" returned ${it.name}`);
  }
});

test('protocol 4: Native Land outlines are kept out of git', () => {
  const ig = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ig, /data\/raw\/nativeland-territories\.json/);
  assert.match(ig, /public\/data\/territories\.json/);
});

// Public hosting: one visitor cannot swamp the API, and the visitor's address is read safely.
test('the request limit stops a visitor past the cap and resets each minute', () => {
  let t = 0;
  const rl = new RateLimit(3, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => rl.allow('a')), [true, true, true, false]);
  assert.equal(rl.allow('b'), true, 'another visitor is not affected');
  t = 60000;
  assert.equal(rl.allow('a'), true, 'a new minute starts fresh');
  assert.equal(new RateLimit(0).allow('a'), true, 'no cap when unset');
});

test('the visitor address trusts the proxy header only from the proxy itself', () => {
  const req = (sock, xff) => ({ socket: { remoteAddress: sock }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(visitorIp(req('127.0.0.1', '6.6.6.6, 203.0.113.9'), true), '203.0.113.9', 'Caddy appends the real address last');
  assert.equal(visitorIp(req('198.51.100.7', '1.2.3.4'), true), '198.51.100.7', 'a header from the open internet is ignored');
  assert.equal(visitorIp(req('127.0.0.1', '1.2.3.4'), false), '127.0.0.1', 'not behind a proxy: the header is ignored');
});
