// Native business listings: check them, place them, and show what is covered.
//   node scripts/research/businesses.mjs check      problems in every file (exit 1 if any)
//   node scripts/research/businesses.mjs geocode    fill missing lonlat (Census geocoder for a street
//                                                    address, town centre otherwise; never a home street)
//   node scripts/research/businesses.mjs coverage   counts by category and state, and the gaps
//   node scripts/research/businesses.mjs has "<name>"  is this business already listed?
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBusiness, CATEGORIES } from '../../lib/businesses.mjs';
import { get } from '../harvest/common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data/research/businesses');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return { error: e.message }; } };
const [cmd = 'coverage', arg] = process.argv.slice(2);

if (cmd === 'check') {
  let bad = 0; const seen = new Map();
  for (const f of files) {
    const list = load(f);
    if (!Array.isArray(list)) { console.log(`${f}: NOT A JSON ARRAY ${list.error || ''}`); bad++; continue; }
    for (const b of list) {
      const r = checkBusiness(b);
      if (seen.has(b.id)) r.problems.push(`duplicate id, also in ${seen.get(b.id)}`);
      seen.set(b.id, f);
      if (r.problems.length) { bad++; console.log(`${f} / ${b.id || b.name}:\n  - ${r.problems.join('\n  - ')}`); }
    }
  }
  console.log(`${seen.size} listings in ${files.length} files; ${bad} with problems`);
  process.exit(bad ? 1 : 0);
}

if (cmd === 'geocode') {
  let placed = 0, missed = 0;
  for (const f of files) {
    const list = load(f);
    if (!Array.isArray(list)) continue;
    let changed = false;
    for (const b of list) {
      if (b.lonlat || !b.state) continue;
      let ll = null, precision = null;
      if (b.address && !b.homeBased) {
        const q = `${b.address}, ${b.city || ''}, ${b.state}${b.zip ? ` ${b.zip}` : ''}`;
        const d = await get(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { gap: 1000, ua: 'Reztoration/1.0' });
        const m = d?.result?.addressMatches?.[0]?.coordinates;
        if (m) { ll = [m.x, m.y]; precision = 'address'; }
      }
      if (!ll && b.city) {
        const d = await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&city=${encodeURIComponent(b.city)}&state=${encodeURIComponent(b.state)}`, { gap: 1100, ua: 'Reztoration/1.0 (local research map)' });
        const m = Array.isArray(d) ? d[0] : null;
        if (m) { ll = [Number(m.lon), Number(m.lat)]; precision = 'town'; }
      }
      if (ll) { b.lonlat = ll.map((v) => Math.round(v * 10000) / 10000); b.lonlatPrecision = precision; placed++; changed = true; }
      else missed++;
    }
    if (changed) fs.writeFileSync(path.join(dir, f), JSON.stringify(list, null, 1));
  }
  console.log(`placed ${placed}, could not place ${missed}`);
}

if (cmd === 'coverage' || cmd === 'has') {
  const all = files.flatMap((f) => { const l = load(f); return Array.isArray(l) ? l : []; });
  if (cmd === 'has') {
    const k = String(arg || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hits = all.filter((b) => b.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(k));
    console.log(hits.length ? hits.map((b) => `${b.id} | ${b.name} | ${b.city}, ${b.state}`).join('\n') : 'not listed');
  } else {
    const by = (k) => all.reduce((m, b) => ((m[b[k]] = (m[b[k]] || 0) + 1), m), {});
    console.log(`${all.length} listings`);
    console.log('by category:', Object.keys(CATEGORIES).map((c) => `${c} ${by('category')[c] || 0}`).join(', '));
    console.log('by state:', Object.entries(by('state')).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', '));
    const states = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
    console.log('no listings yet:', states.filter((s) => !by('state')[s]).join(' ') || 'none');
  }
}
