// "What land am I on?" A point (from the browser's location, typed coordinates, or a town or
// zip looked up in the Census gazetteer kept on this machine) answered from the map's own data:
// the homelands whose outlines cover it, the land cessions that took it, the nearest tribal
// lands, nation seats and Native businesses. Nothing leaves the machine.
import fs from 'node:fs';
import path from 'node:path';
import { project, regionOf } from './projection.mjs';
import { norm } from './library.mjs';

// Ray casting on a flat [x0, z0, x1, z1, ...] ring.
function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (x, z, polys) => polys.some(([outer, ...holes]) => inRing(x, z, outer) && !holes.some((h) => inRing(x, z, h)));

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };
export { STATES };

export class Places {
  constructor(root, lib, treaties, today) {
    this.root = root; this.lib = lib; this.treaties = treaties; this.today = today;
    this.cessions = null; this.gaz = undefined;
  }

  #cessions() {
    if (!this.cessions) { try { this.cessions = JSON.parse(fs.readFileSync(path.join(this.root, 'public/data/cessions.json'), 'utf8')); } catch { this.cessions = []; } }
    return this.cessions;
  }

  // Census gazetteer files (public domain), if present in data/raw: places and zip code areas.
  #gazetteer() {
    if (this.gaz !== undefined) return this.gaz;
    const rows = [];
    const read = (file, kind) => {
      let txt;
      try { txt = fs.readFileSync(path.join(this.root, 'data/raw', file), 'utf8'); } catch { return; }
      const lines = txt.split(/\r?\n/);
      const head = lines[0].split('\t').map((h) => h.trim());
      const at = (k) => head.indexOf(k);
      const iName = at('NAME'), iState = at('USPS'), iLat = at('INTPTLAT'), iLon = at('INTPTLONG'), iGeo = at('GEOID'), iPop = at('ALAND');
      for (const line of lines.slice(1)) {
        const c = line.split('\t');
        if (c.length < 3) continue;
        const lat = Number(c[iLat]), lon = Number(c[iLon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (kind === 'zip') rows.push({ kind, name: c[iGeo].trim(), key: c[iGeo].trim(), state: '', lonlat: [lon, lat], size: 0 });
        else {
          const name = c[iName].replace(/^Urban\s+/, '').replace(/\s+(city|town|village|CDP|borough|municipality|city and borough|consolidated government.*|metropolitan government.*|unified government.*|urban county)$/i, '').trim();
          rows.push({ kind, name, key: norm(name), state: c[iState].trim(), lonlat: [lon, lat], size: Number(c[iPop]) || 0 });
        }
      }
    };
    read('census-gazetteer-places.txt', 'place');
    read('census-gazetteer-zcta.txt', 'zip');
    this.gaz = rows.length ? rows : null;
    return this.gaz;
  }

  hasGazetteer() { return !!this.#gazetteer(); }

  // "Austin, TX", "Austin Texas", "78701", "30.27, -97.74". Returns candidates, best first.
  find(q) {
    const s = String(q || '').trim();
    const ll = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (ll) {
      const lat = Number(ll[1]), lon = Number(ll[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [{ kind: 'point', name: `${lat}, ${lon}`, state: '', lonlat: [lon, lat] }];
    }
    const gaz = this.#gazetteer();
    if (!gaz) return [];
    if (/^\d{5}$/.test(s)) return gaz.filter((r) => r.kind === 'zip' && r.key === s).map((r) => ({ ...r, name: `Zip ${r.name}` }));
    let state = '';
    let rest = s.replace(/,/g, ' ').trim();
    const words = rest.split(/\s+/);
    const last = words[words.length - 1].toUpperCase();
    if (words.length > 1 && STATES[last]) { state = last; rest = words.slice(0, -1).join(' '); } else {
      for (const [ab, full] of Object.entries(STATES)) if (norm(rest).endsWith(' ' + norm(full))) { state = ab; rest = rest.slice(0, rest.length - full.length).trim(); break; }
    }
    const k = norm(rest);
    if (k.length < 2) return [];
    return gaz.filter((r) => r.kind === 'place' && (!state || r.state === state) && (r.key === k || r.key.startsWith(k)))
      .sort((a, b) => (b.key === k) - (a.key === k) || b.size - a.size).slice(0, 8)
      .map(({ name, state: st, lonlat }) => ({ kind: 'place', name, state: st, lonlat }));
  }

  // Everything the map knows about one point on the ground.
  at(lonlat) {
    const xz = project(lonlat);
    if (!xz) return null;
    const [x, z] = xz;
    const region = regionOf(lonlat);
    // Each inset is its own drawing: a point in Alaska is only ever tested against Alaska's shapes.
    const homelands = this.lib.territories.filter((t) => (t.region || 'lower48') === region && inPolys(x, z, t.polys)).sort((a, b) => a.area - b.area)
      .map((t) => ({ id: t.id, name: t.name, color: t.color }));
    const onLand = this.lib.lands.filter((l) => (l.region || 'lower48') === region && inPolys(x, z, l.polys)).map((l) => ({ id: l.id, name: l.name, kind: l.kind }));
    const km = (p) => { const R = 6371, r = Math.PI / 180; const a = Math.sin((p[1] - lonlat[1]) * r / 2) ** 2 + Math.cos(lonlat[1] * r) * Math.cos(p[1] * r) * Math.sin((p[0] - lonlat[0]) * r / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(a))); };
    const nearLands = this.lib.lands.filter((l) => l.lonlat && !onLand.some((o) => o.id === l.id))
      .map((l) => ({ id: l.id, name: l.name, kind: l.kind, km: km(l.lonlat) })).filter((l) => l.km <= 600).sort((a, b) => a.km - b.km).slice(0, 5);
    const cessionIds = this.#cessions().filter((c) => (c.region || 'lower48') === region && inPolys(x, z, c.polys)).map((c) => c.id);
    const seen = new Set();
    const treaties = cessionIds.flatMap((id) => this.treaties.cession(id)?.treaties || []).filter((t) => !seen.has(t.id) && seen.add(t.id))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { lonlat, xz, homelands, onLand, nearLands, cessions: cessionIds, treaties, ...this.today.near(lonlat) };
  }
}
