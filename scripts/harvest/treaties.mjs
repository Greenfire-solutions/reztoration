// Treaties: every Indian land cession in Royce's "Indian Land Cessions in the United States"
// (1899), as digitised by the US Forest Service (public domain, US government work), with the
// treaty text links (Kappler), the Royce schedule and the present-day tribes for each area.
// Writes data/raw/usfs-cessions.geojson (shapes) and data/research/treaties.json (one record
// per treaty or act, keyed by its Kappler link). The treaty-researcher agent adds findings to
// data/research/treaty-findings/<id>.json; this script never touches those.
import fs from 'node:fs';
import path from 'node:path';
import { get, ROOT } from './common.mjs';

const B = 'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_TribalCessionLands_01/MapServer';
const gap = 1500;

// Shapes, lightly generalised by the server (about 500 m) so the map stays fast.
const shapes = [];
for (let off = 0; ; off += 200) {
  const d = await get(`${B}/1/query?where=1%3D1&outFields=cessnum&returnGeometry=true&outSR=4326&maxAllowableOffset=0.005&geometryPrecision=4&resultOffset=${off}&resultRecordCount=200&orderByFields=objectid&f=geojson`, { gap, tries: 3 });
  const f = d?.features || [];
  shapes.push(...f);
  console.log(`treaties: ${shapes.length} cession shapes`);
  if (f.length < 200) break;
}
fs.writeFileSync(path.join(ROOT, 'data/raw/usfs-cessions.geojson'), JSON.stringify({ type: 'FeatureCollection', features: shapes }));

const rows = [];
for (let off = 0; ; off += 500) {
  const d = await get(`${B}/2/query?where=1%3D1&outFields=*&resultOffset=${off}&resultRecordCount=500&orderByFields=objectid&f=json`, { gap, tries: 3 });
  const f = (d?.features || []).map((x) => x.attributes);
  rows.push(...f);
  if (f.length < 500) break;
}

const day = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
const treaties = new Map();
for (const r of rows) {
  const tribes = String(r.presdaytrb || '').split(';').map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i <= 5; i++) {
    const date = day(r[`cessdate${i}`]);
    const kappler = r[`date${i}link_kappler_treaty`] || null;
    const royce = r[`date${i}link_royce_schedule`] || null;
    if (!date && !kappler) continue;
    // One record per treaty or act. Kappler's page is the treaty itself; without one, the date stands in.
    const id = kappler ? (kappler.match(/seq=(\d+)/) ? `kappler-${kappler.match(/seq=(\d+)/)[1]}` : kappler.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(-60)) : `cession-${date}-${String(r.schdtrb || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
    const t = treaties.get(id) || { id, date, kappler, royce: new Set(), cessions: new Set(), presentDayTribes: new Set(), scheduleTribes: new Set(), statute: new Set(), executiveOrder: new Set(), states: new Set() };
    t.cessions.add(String(r.cessnum));
    if (royce) t.royce.add(royce);
    tribes.forEach((x) => t.presentDayTribes.add(x));
    if (r.schdtrb) t.scheduleTribes.add(String(r.schdtrb).trim());
    if (r.link_federal_statute) t.statute.add(r.link_federal_statute);
    if (r.link_executive_order) t.executiveOrder.add(r.link_executive_order);
    String(r.state || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((s) => t.states.add(s));
    treaties.set(id, t);
  }
}
// Hand corrections where the USFS layer merged different treaties, tribes or Royce areas
// (data/research/treaty-corrections.json, each with its why and source). A correction
// overrides only the fields it names; one with splitFrom adds a record split out of another.
let fixes = {};
try { fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/research/treaty-corrections.json'), 'utf8')); } catch {}
const built = [...treaties.values()].map((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v instanceof Set ? [...v] : v])));
for (const [id, c] of Object.entries(fixes)) {
  if (id.startsWith('_')) continue;
  const { why, source, splitFrom, ...fields } = c;
  let t = built.find((x) => x.id === id);
  if (!t && splitFrom) built.push(t = { id, date: null, kappler: null, royce: [], cessions: [], presentDayTribes: [], scheduleTribes: [], statute: [], executiveOrder: [], states: [] });
  if (!t) { console.log(`treaties: correction for unknown id ${id} skipped`); continue; }
  Object.assign(t, fields, { correction: { fields: Object.keys(fields), why, source, ...(splitFrom ? { splitFrom } : {}) } });
}
const out = built
  .map((t) => ({ ...t, name: t.correction?.fields.includes('name') ? t.name :`${t.kappler ? 'Treaty or agreement with the' : 'Cession of land of the'} ${[...new Set(t.scheduleTribes.flatMap((x) => x.split(/;\s*/)))].slice(0, 4).join(', ') || 'nations named in the record'}, ${t.date || 'date unknown'}` }))
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
fs.writeFileSync(path.join(ROOT, 'data/research/treaties.json'), JSON.stringify(out, null, 1));
fs.mkdirSync(path.join(ROOT, 'data/research/treaty-findings'), { recursive: true });
console.log(`treaties: done, ${shapes.length} shapes, ${rows.length} cession rows, ${out.length} treaties and acts`);
