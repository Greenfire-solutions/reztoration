// The "Today" map: every nation at its present-day seat of government, and the Native
// businesses and organisations people can support (PROTOCOLS 12-14). Business files are
// re-read when they change; a listing that fails checkBusiness never reaches the map.
import fs from 'node:fs';
import path from 'node:path';
import { project } from './projection.mjs';
import { checkBusiness, CATEGORIES, OWNERSHIP } from './businesses.mjs';
import { keysOf } from './library.mjs';

export class Today {
  constructor(root, library) {
    this.root = root;
    this.lib = library;
    this.dir = path.join(root, 'data/research/businesses');
    this.nationsSig = null;
    this.bizSig = null;
    this.at = 0;
  }

  #read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  #stat(file) { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }

  #nations() {
    const file = path.join(this.root, 'data/research/nations.json');
    const sig = this.#stat(file);
    if (sig === this.nationsSig && this.nationsVal) return this.nationsVal;
    const all = this.#read(file) || [];
    // Which homelands name each nation: one pass over the territories, kept until nations.json changes.
    const homes = new Map();
    for (const t of this.lib.territories) {
      const r = this.lib.nationsOf(t.id);
      for (const n of r?.nations || []) {
        if (!homes.has(n.id)) homes.set(n.id, []);
        homes.get(n.id).push({ id: t.id, name: t.name });
      }
    }
    const list = all.filter((n) => Array.isArray(n.hq) && n.hq.length === 2).map((n) => ({
      id: n.id, name: n.name, recognition: n.recognition, states: n.states || [], hq: n.hq, xz: project(n.hq),
      website: n.official?.website || null, homelands: homes.get(n.id) || [],
    })).filter((n) => n.xz);
    this.nationsSig = sig;
    this.nationsVal = { all, list, byId: new Map(all.map((n) => [n.id, n])), homes };
    return this.nationsVal;
  }

  #businesses() {
    if (this.bizVal && Date.now() - this.at < 4000) return this.bizVal;
    this.at = Date.now();
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch {}
    const sig = files.map((f) => f + this.#stat(path.join(this.dir, f))).join('|');
    if (sig === this.bizSig && this.bizVal) return this.bizVal;
    const seen = new Set(), list = [];
    let held = 0;
    for (const f of files) {
      const arr = this.#read(path.join(this.dir, f));
      if (!Array.isArray(arr)) continue;
      for (const b of arr) {
        if (!checkBusiness(b).ok || seen.has(b.id) || !b.lonlat) { held++; continue; }
        seen.add(b.id);
        const xz = project(b.lonlat);
        if (!xz) { held++; continue; }
        list.push({ ...b, xz, categoryLabel: CATEGORIES[b.category], ownershipLabel: OWNERSHIP[b.ownership] });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.bizSig = sig;
    this.bizVal = { list, byId: new Map(list.map((b) => [b.id, b])), held };
    return this.bizVal;
  }

  // Everything the Today map draws, in one response.
  map() {
    const n = this.#nations(), b = this.#businesses();
    const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]));
    for (const x of b.list) counts[x.category]++;
    return {
      nations: n.list.map(({ id, name, recognition, xz, states }) => ({ id, name, recognition, xz, states })),
      businesses: b.list.map(({ id, name, category, xz, city, state, nation }) => ({ id, name, category, xz, city, state, nation })),
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, { label: v, count: counts[k] }])),
      notYetPlaced: b.held,
    };
  }

  business(id) {
    const b = this.#businesses().byId.get(id);
    if (!b) return null;
    // A listing sits at its town when it is home based: say so rather than imply a street.
    return { ...b, placedAt: b.lonlatPrecision === 'address' ? 'address' : 'town' };
  }

  list({ category = '', q = '', state = '', offset = 0, limit = 60 } = {}) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    const all = this.#businesses().list.filter((b) => (!category || b.category === category) && (!state || b.state === state)
      && (!words.length || words.every((w) => `${b.name} ${b.nation || ''} ${b.city} ${b.state} ${b.subcategory || ''} ${b.description || ''}`.toLowerCase().includes(w))));
    return { total: all.length, offset, businesses: all.slice(offset, offset + limit) };
  }

  nation(id, treaties) {
    const n = this.#nations();
    const rec = n.byId.get(id);
    if (!rec) return null;
    const keys = new Set([rec.name, ...(rec.officialNames || []), ...(rec.aliases || []), rec.endonym].filter(Boolean).flatMap(keysOf));
    const businesses = this.#businesses().list.filter((b) => b.nation && keysOf(b.nation).some((k) => keys.has(k)));
    return {
      id: rec.id, name: rec.name, endonym: rec.endonym || null, recognition: rec.recognition, states: rec.states || [],
      official: rec.official || {}, wikipedia: rec.wikipedia || null, languages: (rec.languages || []).map((l) => l.name),
      hq: rec.hq || null, xz: rec.hq ? project(rec.hq) : null,
      homelands: n.homes.get(id) || [],
      businesses: businesses.map(({ id: bid, name, category, categoryLabel, city, state }) => ({ id: bid, name, category, categoryLabel, city, state })),
      treaties: treaties ? treaties.forNationNames([rec.name, ...(rec.officialNames || [])], rec.id) : [],
    };
  }
}
