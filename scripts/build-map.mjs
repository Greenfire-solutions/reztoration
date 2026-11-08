// Builds the map geometry the 3D page draws, from the raw files in data/raw.
// Run: node scripts/build-map.mjs
// Writes public/data/{states,territories,reservations}.json in projected map units
// (Albers for the lower 48, with Alaska and Hawaii insets like a US atlas).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proj, regionOf } from '../lib/projection.mjs';
import polygonClipping from 'polygon-clipping';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data/raw', f), 'utf8'));
const outDir = path.join(root, 'public/data');
fs.mkdirSync(outDir, { recursive: true });

const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}
function ringCentroid(r) {
  let x = 0, y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [x / r.length, y / r.length];
}
function pip([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (pt, polys) => polys.some((poly) => pip(pt, poly[0]) && !poly.slice(1).some((h) => pip(pt, h)));

// Project one ring into flat [x,z,x,z,...] rounded to 0.05 units, dropping near-duplicates.
function projectRing(ring, p, minStep = 0.35) {
  const out = [];
  let lx = Infinity, lz = Infinity;
  for (const c of ring) {
    const q = p(c);
    if (!q) continue;
    const x = Math.round(q[0] * 20) / 20, z = Math.round(q[1] * 20) / 20;
    if (Math.hypot(x - lx, z - lz) < minStep) continue;
    out.push(x, z); lx = x; lz = z;
  }
  return out.length >= 6 ? out : null;
}
function projectFeature(geom, region, minStep) {
  const p = proj[region];
  const polys = [];
  for (const poly of polysOf(geom)) {
    const outer = projectRing(poly[0], p, minStep);
    if (!outer) continue;
    const holes = poly.slice(1).map((h) => projectRing(h, p, minStep)).filter(Boolean);
    polys.push([outer, ...holes]);
  }
  return polys;
}
function mainCentroid(geom) {
  let best = null, bestA = -1;
  for (const poly of polysOf(geom)) {
    const a = Math.abs(ringArea(poly[0]));
    if (a > bestA) { bestA = a; best = poly[0]; }
  }
  return best ? ringCentroid(best) : null;
}

// ---- States (base land + borders) ----
const KEEP_OUT = new Set(['PR', 'VI', 'GU', 'AS', 'MP']);
const states = raw('census-states.json').features.filter((f) => !KEEP_OUT.has(f.properties.STUSAB));
const statePolysLL = states.flatMap((f) => polysOf(f.geometry));
const statesOut = states.map((f) => {
  const region = f.properties.STUSAB === 'AK' ? 'alaska' : f.properties.STUSAB === 'HI' ? 'hawaii' : 'lower48';
  return { id: f.properties.STUSAB, name: f.properties.NAME, polys: projectFeature(f.geometry, region, 0.5) };
});

// ---- Present-day tribal lands (US Census 2020) ----
// Read first: a homeland that holds one of these is a US homeland, even when most of it
// lies across a border or out at sea (Blackfoot, Kumeyaay, Unangax, Dene in Alaska).
const layers = [
  ['census-federal-reservations.json', 'Federal reservation'],
  ['census-state-reservations.json', 'State reservation'],
  ['census-oklahoma-statistical.json', 'Oklahoma tribal statistical area'],
  ['census-alaska-villages.json', 'Alaska Native village statistical area'],
];
const landFeatures = layers.flatMap(([file, kind]) => raw(file).features.map((f) => ({ f, kind, c: mainCentroid(f.geometry) }))).filter((x) => x.c);

// ---- Traditional territories (Native Land Digital) ----
const inUS = (pt) => statePolysLL.some((poly) => pip(pt, poly[0]));
// US land as one shape, to find where a cross-border homeland's US part is (for its label only).
const usLand = statePolysLL.map((p) => [p[0]]);
const islandPoints = statePolysLL.map((p) => ringCentroid(p[0])).filter((pt) => inUS(pt));
const nl = raw('nativeland-territories.json').features;
const territories = [];
let trimmed = 0;
for (const f of nl) {
  let geom = f.geometry;
  let c = mainCentroid(geom);
  if (!c) continue;
  // Keep a territory if its centre or a good share of its outline falls inside the US.
  const ring = polysOf(geom).flatMap((p) => p[0]);
  const step = Math.max(1, Math.floor(ring.length / 40));
  let hits = 0, n = 0;
  for (let i = 0; i < ring.length; i += step) { n++; if (inUS(ring[i])) hits++; }
  const share = hits / Math.max(n, 1);
  if (!inUS(c) && share < 0.5) {
    // Otherwise keep it only when US tribal land or US islands sit inside it. The outline stays exactly
    // as Native Land drew it (their terms forbid re-cutting); only the label point moves to the US part.
    const ll = polysOf(geom);
    const holdsLand = landFeatures.some((x) => inPolys(x.c, ll));
    const holdsIslands = islandPoints.filter((pt) => inPolys(pt, ll)).length >= 3;
    if (!(holdsIslands || (holdsLand && share >= 0.05))) continue;
    let cut;
    try { cut = polygonClipping.intersection(ll.map((p) => [p[0]]), usLand); } catch { continue; }
    if (!cut.length) continue;
    c = mainCentroid({ type: 'MultiPolygon', coordinates: cut });
    trimmed++;
  }
  const region = regionOf(c);
  const polys = projectFeature(geom, region, 0.35);
  if (!polys.length) continue;
  const slug = decodeURIComponent(f.properties.Slug || String(f.properties.id));
  territories.push({
    id: slug,
    name: (f.properties.Name || '').trim(),
    color: f.properties.color || '#c9a26b',
    url: f.properties.description || null,
    region,
    lonlat: c.map((v) => Math.round(v * 1000) / 1000),
    center: proj[region](c).map((v) => Math.round(v * 10) / 10),
    area: Math.round(polysOf(geom).reduce((s, p) => s + Math.abs(ringArea(p[0])), 0) * 1000) / 1000,
    polys,
    _ll: polysOf(geom),
  });
}
console.log(`${trimmed} homelands that cross a border or the sea kept, kept whole, labelled at their US part`);

// ---- Present-day tribal lands: projected ----
const reservations = [];
{
  for (const { f, kind, c } of landFeatures) {
    const region = regionOf(c);
    const polys = projectFeature(f.geometry, region, 0.15);
    if (!polys.length) continue;
    reservations.push({
      id: f.properties.GEOID,
      name: f.properties.NAME,
      base: f.properties.BASENAME,
      kind,
      region,
      lonlat: c.map((v) => Math.round(v * 1000) / 1000),
      center: proj[region](c).map((v) => Math.round(v * 10) / 10),
      polys,
    });
  }
}

// ---- Link present-day lands to the traditional territories that hold them ----
for (const r of reservations) {
  r.territories = territories.filter((t) => inPolys(r.lonlat, t._ll)).map((t) => t.id);
}
// ---- Land cessions (Royce 1899, digitised by the US Forest Service; public domain) ----
const cessions = [];
if (fs.existsSync(path.join(root, 'data/raw/usfs-cessions.geojson'))) {
  for (const f of raw('usfs-cessions.geojson').features) {
    const c = mainCentroid(f.geometry);
    if (!c) continue;
    const region = regionOf(c);
    const polys = projectFeature(f.geometry, region, 0.3);
    if (!polys.length) continue;
    cessions.push({
      id: String(f.properties.cessnum),
      region,
      lonlat: c.map((v) => Math.round(v * 1000) / 1000),
      center: proj[region](c).map((v) => Math.round(v * 10) / 10),
      territories: territories.filter((t) => inPolys(c, t._ll)).map((t) => t.id),
      polys,
    });
  }
}

for (const t of territories) {
  t.reservations = reservations.filter((r) => r.territories.includes(t.id)).map((r) => r.id);
  delete t._ll;
}
// Big territories first so small ones sit on top.
territories.sort((a, b) => b.area - a.area);

const write = (name, data) => {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data));
  console.log(name, Array.isArray(data) ? data.length : '', Math.round(fs.statSync(path.join(outDir, name)).size / 1024) + ' kB');
};
write('states.json', statesOut);
write('territories.json', territories);
write('reservations.json', reservations);
write('cessions.json', cessions);
