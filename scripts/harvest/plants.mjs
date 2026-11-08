// Plants: the BRIT Native American Ethnobotany Database (Moerman), every
// documented use with its note and published citation. Protocol 6: shown as a
// historical record with the citation, never advice. Protocol 2: ceremonial,
// witchcraft and other restricted categories are left out.
import fs from 'node:fs';
import path from 'node:path';
import { get, isSacred, clean, ROOT } from './common.mjs';

const BASE = 'http://naeb.brit.org';
const GAP = 1100;
const RESTRICTED = /ceremon|witchcraft|sacred|love medicine|hunting medicine|gambling|protection|magic|orthopedic aid.*ceremon|sweat/i;

async function tribes() {
  const out = [];
  for (let p = 1; p < 20; p++) {
    const html = await get(`${BASE}/uses/tribes/?page=${p}`, { gap: GAP, json: false });
    const found = [...(html || '').matchAll(/href="\/uses\/tribes\/(\d+)\/">([^<]+)</g)].map((m) => ({ id: m[1], name: m[2].trim() }));
    const fresh = found.filter((f) => !out.some((o) => o.id === f.id));
    if (!fresh.length) break;
    out.push(...fresh);
  }
  return out;
}

function parse(html, tribe) {
  const rows = [];
  for (const tr of html.split(/<tr>/).slice(1)) {
    const sp = tr.match(/href="\/uses\/species\/(\d+)\/">([^<]+)<\/a><br \/>\s*([^<]*)</);
    const use = tr.match(/href="\/uses\/(\d+)\/">([^<]+)<\/a><\/strong><br \/>\s*([\s\S]*?)<br >\s*([\s\S]*?)<\/td>/);
    const usda = tr.match(/symbol=([A-Z0-9]+)/);
    if (!sp || !use) continue;
    const label = use[2].trim();
    const m = label.match(/^(.*) (Drug|Food|Fiber|Dye|Other)(?:, (.*))?$/);
    if (!m || m[1] !== tribe) continue;
    const cat = m[2], sub = m[3];
    rows.push({ id: use[1], speciesId: sp[1], plant: sp[2].trim(), commonName: clean(sp[3], 80), usda: usda?.[1] || null, use: cat, subUse: sub || null, note: clean(use[3], 500), citation: clean(use[4], 300) });
  }
  return rows;
}

const all = await tribes();
console.log(`plants: ${all.length} tribes`);
const uses = [], plants = new Map();
let left = 0, done = 0;

function keep(r, tribe) {
  if (RESTRICTED.test(`${r.use} ${r.subUse}`) || isSacred(r.note)) { left++; return; }
  uses.push({ nation: tribe, plant: r.plant, commonName: r.commonName, use: r.use, subUse: r.subUse, note: r.note, citation: r.citation, url: `${BASE}/uses/${r.id}/` });
  if (!plants.has(r.plant)) plants.set(r.plant, { plant: r.plant, commonName: r.commonName, usda: r.usda, url: `${BASE}/uses/species/${r.speciesId}/`, usdaUrl: r.usda ? `https://plants.usda.gov/home/plantProfile?symbol=${r.usda}` : null });
}

async function search(str, tribe, got) {
  for (let p = 1; p <= 20; p++) {
    const html = await get(`${BASE}/uses/search/?string=${encodeURIComponent(str)}&page=${p}`, { gap: GAP, json: false });
    if (!html) return 0;
    const total = Number((html.match(/([\d,]+) uses matching query/) || [])[1]?.replace(/,/g, '') || 0);
    for (const r of parse(html, tribe)) got.set(r.id, r);
    if (!html.includes(`page=${p + 1}`)) return total;
  }
  return 0;
}

for (const t of all) {
  const page = await get(`${BASE}/uses/tribes/${t.id}/`, { gap: GAP, json: false });
  const ids = [...(page || '').matchAll(/href="\/uses\/(\d+)\/">detail/g)].map((m) => m[1]);
  const got = new Map();
  const total = await search(t.name, t.name, got);
  if (total >= 1000 || got.size < ids.length) for (const c of ['Drug', 'Food', 'Fiber', 'Dye', 'Other']) await search(`${t.name} AND ${c}`, t.name, got);
  // Whatever the search still could not reach: one detail page each.
  for (const id of ids) {
    if (got.has(id)) continue;
    const html = await get(`${BASE}/uses/${id}/`, { gap: GAP, json: false });
    if (!html) continue;
    const txt = html.replace(/<[^>]+>/g, '\n').replace(/&#39;/g, "'");
    const f = (k) => (txt.match(new RegExp(`${k}:\\s*([^\\n]*)`)) || [])[1]?.trim() || null;
    const cite = (txt.match(/Use documented by:\s*\n+\s*([^\n]+)/) || [])[1];
    got.set(id, { id, speciesId: (html.match(/\/uses\/species\/(\d+)\//) || [])[1], plant: f('Scientific name'), commonName: f('Common names'), usda: f('USDA symbol')?.split(/\s/)[0] || null, use: f('Use category'), subUse: f('Use sub-category'), note: clean(f('Notes'), 500), citation: clean(cite, 300) });
  }
  for (const r of got.values()) keep(r, t.name);
  if (++done % 10 === 0) { save(); console.log(`plants: ${done}/${all.length} tribes, ${uses.length} uses, ${left} left out`); }
}
save();
console.log(`plants: done, ${uses.length} uses, ${plants.size} plants, ${left} left out under protocol 2`);

function dedupe() {
  const seen = new Set();
  return uses.filter((u) => { if (seen.has(u.url)) return false; seen.add(u.url); return true; });
}
function save() {
  const dir = path.join(ROOT, 'data/research');
  const write = (f, v) => { fs.writeFileSync(path.join(dir, f + '.tmp'), JSON.stringify(v)); fs.renameSync(path.join(dir, f + '.tmp'), path.join(dir, f)); };
  write('plant-uses.json', dedupe());
  write('plants.json', [...plants.values()]);
  write('harvest/plants.meta.json', { source: 'naeb', uses: uses.length, leftOutUnderProtocol2: left, at: new Date().toISOString(), note: 'BRIT Native American Ethnobotany Database, Moerman. Historical record, not advice.' });
}
