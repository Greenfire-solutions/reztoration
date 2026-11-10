// The library joins everything the research agents gather onto the map.
// It re-reads a research file whenever that file changes, so new findings
// appear without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { itemBlocked, plantUseBlocked } from './protocols.mjs';

const STOP = new Set(['the', 'of', 'tribe', 'tribes', 'nation', 'nations', 'indian', 'indians', 'band', 'bands', 'people', 'peoples',
  'confederated', 'community', 'communities', 'reservation', 'rancheria', 'and', 'in', 'state', 'federally', 'recognized', 'native', 'village']);

const PLACES = new Set(['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','east','west','north','south','upper','lower']);

export function norm(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ');
}

// Every reasonable key a name could be looked up by: the whole, the part in
// brackets, the part outside, and each name in a list like "Cayuse, Umatilla and Walla Walla".
export function keysOf(name) {
  const keys = new Set();
  const s = String(name || '');
  const add = (x) => { const k = norm(x); if (k.length >= 3 && !PLACES.has(k)) keys.add(k); };
  add(s);
  const inner = [...s.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  inner.forEach(add);
  const outer = s.replace(/\([^)]*\)/g, ' ');
  add(outer);
  for (const part of [s, ...inner, outer]) part.split(/,|\band\b|\//).forEach(add);
  return [...keys];
}

// How the page groups what was found. Every kind lands in exactly one group.
export const GROUPS = {
  art: { label: 'Art', kinds: ['art'] },
  films: { label: 'Films', kinds: ['film', 'video'] },
  photos: { label: 'Photos', kinds: ['photo', 'map', 'image'] },
  recordings: { label: 'Recordings', kinds: ['audio'] },
  writings: { label: 'Writings', kinds: ['book', 'document', 'journal', 'newspaper', 'story', 'text'] },
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, v]) => v.kinds.map((k) => [k, g])));
export const groupOf = (kind) => GROUP_OF[kind] || 'writings';
const richness = (i) => (i.media ? 4 : 0) + (i.image || i.thumb ? 2 : 0) + (i.summary ? 1 : 0);

export class Library {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
    this.territories = this.#json('public/data/territories.json') || [];
    this.lands = this.#json('public/data/reservations.json') || [];
    this.tById = new Map(this.territories.map((t) => [t.id, t]));
    this.lById = new Map(this.lands.map((l) => [l.id, l]));
  }

  #json(rel) {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, rel), 'utf8')); } catch { return null; }
  }

  // Research file, re-read when it changes on disk.
  #research(name) {
    const file = path.join(this.root, 'data/research', name);
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
    const hit = this.cache.get(name);
    if (hit && hit.mtime === mtime) return hit.value;
    let value = null;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { value = hit?.value ?? null; }
    this.cache.set(name, { mtime, value });
    this.#indexes = null;
    return value;
  }

  // Every file a harvester wrote into data/research/harvest, re-read when any of them changes.
  #harvestSig = '';
  #harvestVal = null;
  #harvestAt = 0;
  #harvest() {
    if (this.#harvestVal && Date.now() - this.#harvestAt < 20000) return this.#harvestVal;
    this.#harvestAt = Date.now();
    const dir = path.join(this.root, 'data/research/harvest');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && !f.startsWith('trial-')); } catch { return { items: [], left: 0 }; }
    const sig = files.map((f) => { try { return f + fs.statSync(path.join(dir, f)).mtimeMs; } catch { return f; } }).join('|');
    if (sig === this.#harvestSig && this.#harvestVal) return this.#harvestVal;
    const items = [];
    let left = 0;
    for (const f of files) {
      try { for (const it of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        if (itemBlocked(it)) { left++; continue; }
        if (it.thumb?.startsWith('https://www.artic.edu/iiif/')) it.thumb = it.thumb.replace('/full/600,/', '/full/843,/');
        items.push(it);
      } } catch { /* half-written file: next change re-reads it */ }
      try { left += JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.json$/, '.meta.json')), 'utf8')).leftOutUnderProtocol2 || 0; } catch {}
    }
    this.#harvestSig = sig;
    this.#harvestVal = { items, left };
    this.#indexes = null;
    return this.#harvestVal;
  }

  #indexes = null;
  #index() {
    const harvest = this.#harvest();
    const profiles = this.#research('profiles.json') || {};
    const nations = this.#research('nations.json') || [];
    const crosswalk = this.#research('nativeland-crosswalk.json') || {};
    const rawItems = this.#research('archive-items.json') || [];
    const rawUses = this.#research('plant-uses.json') || [];
    const plants = this.#research('plants.json') || [];
    const plantCrosswalk = this.#research('plant-crosswalk.json') || {};
    if (this.#indexes) return this.#indexes;
    // Filtering happens only when something changed, not on every lookup.
    const items = rawItems.filter((it) => !itemBlocked(it));
    const ent = (x) => String(x || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const uses = rawUses.filter((u) => !plantUseBlocked(u)).map((u) => (/&#?\w+;/.test(u.nation) ? { ...u, nation: ent(u.nation) } : u));
    // Plant-database nation names spelled differently from the map, linked to homelands.
    const plantNamesByTerritory = new Map();
    for (const [name, ids] of Object.entries(plantCrosswalk)) {
      if (name.startsWith('_')) continue;
      for (const id of ids) { if (!plantNamesByTerritory.has(id)) plantNamesByTerritory.set(id, []); plantNamesByTerritory.get(id).push(name); }
    }

    const byKey = (rows, namesOf) => {
      const m = new Map();
      for (const r of rows) for (const n of namesOf(r)) for (const k of keysOf(n)) {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
      return m;
    };
    this.#indexes = {
      nations,
      nationById: new Map(nations.map((n) => [n.id, n])),
      nationsByKey: byKey(nations, (n) => [n.name, n.endonym, ...(n.aliases || []), ...(n.officialNames || []), ...(n.nativeLandNames || [])]),
      crosswalk,
      itemsByKey: byKey(items, (i) => [i.nation, ...(i.nationAliases || [])]),
      usesByKey: byKey(uses, (u) => [u.nation, String(u.nation || '').split(',')[0]]),
      plantNamesByTerritory,
      usesByNation: (() => { const m = new Map(); for (const u of uses) { if (!m.has(u.nation)) m.set(u.nation, []); m.get(u.nation).push(u); } return m; })(),
      plantByName: new Map(plants.map((p) => [p.plant, p])),
      harvestByTerritory: (() => {
        const m = new Map();
        for (const it of harvest.items) for (const id of it.territories || []) {
          if (!m.has(id)) m.set(id, []);
          m.get(id).push(it);
        }
        return m;
      })(),
      allItems: [...harvest.items, ...items],
      allUses: uses,
      profiles,
      leftOut: harvest.left,
      counts: { nations: nations.length, items: items.length + harvest.items.length, plantUses: uses.length, plants: plants.length, leftOutUnderProtocol2: harvest.left },
    };
    return this.#indexes;
  }

  // A homeland's plant uses: by its names, plus the plant-database names linked to it.
  #usesOf(id, keys, ix) {
    // Linked names match whole, so "Eskimo, Alaska" never pulls in every "Eskimo" record.
    const out = this.#gather(keys, ix.usesByKey);
    const seen = new Set(out);
    for (const name of ix.plantNamesByTerritory.get(id) || []) for (const u of ix.usesByNation.get(name) || []) if (!seen.has(u)) { seen.add(u); out.push(u); }
    return out;
  }

  #gather(keys, map) {
    const seen = new Set(), out = [];
    for (const k of keys) for (const r of map.get(k) || []) if (!seen.has(r)) { seen.add(r); out.push(r); }
    return out;
  }

  // The nations and lookup keys for a territory, without gathering its items. Cheap.
  // The nation a present-day tribe name refers to. Treaty lists spell federal names many ways
  // ("Cherokee Nation, Oklahoma", "White Earth Band of the Minnesota Chippewa Tribe, Minnesota").
  // Exact name first, then without a trailing state, then the nation whose distinctive words
  // all appear in the name (the longest such nation; a tie between nations matches nothing).
  nationIdOf(name) {
    const ix = this.#index();
    if (!ix.exactName) {
      // Two keys: the plain lowercase name, then the name with generic words removed. A key two
      // nations share ("delaware" for the Delaware Nation and the Delaware Tribe) matches neither.
      const raw = (x) => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const put = (m, k, id) => { if (!k) return; if (m.has(k) && m.get(k) !== id) m.set(k, null); else m.set(k, id); };
      ix.rawName = new Map(); ix.exactName = new Map();
      for (const n of ix.nations) for (const x of [n.name, ...(n.officialNames || []), ...(n.aliases || [])]) { put(ix.rawName, raw(x), n.id); put(ix.exactName, norm(x), n.id); }
      ix.raw = raw;
      const GENERIC = new Set(['river', 'valley', 'lake', 'lakes', 'creek', 'mountain', 'mountains', 'springs', 'island', 'islands', 'point', 'bay', 'colony', 'mission', 'pueblo', 'county', 'united', 'st', 'san', 'santa']);
      ix.tokenNames = ix.nations.map((n) => ({ id: n.id, sets: [n.name, ...(n.officialNames || [])].map((x) => [...new Set(norm(x).split(' ').filter((w) => w && !PLACES.has(w)))]).filter((w) => w.some((x) => !GENERIC.has(x) && x.length >= 4) && (w.length >= 2 || !GENERIC.has(w[0]))) }));
      ix.nameCache = new Map();
    }
    const s = String(name || '');
    if (ix.nameCache.has(s)) return ix.nameCache.get(s);
    const strip = s.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/,\s*[A-Z][A-Za-z .,&]*$/, '').replace(/\s+of\s+(the\s+State\s+of\s+)?[A-Z][a-z]+(\s[A-Z][a-z]+)?$/, (m) => (PLACES.has(norm(m.replace(/^\s+of\s+(the\s+State\s+of\s+)?/, ''))) ? '' : m));
    const first = (...v) => { for (const x of v) if (x !== undefined) return x; return undefined; };
    let id = first(ix.rawName.get(ix.raw(s)), ix.rawName.get(ix.raw(strip)), ix.exactName.get(norm(s)), ix.exactName.get(norm(strip)));
    if (id === undefined) {
      const words = new Set(norm(s).split(' '));
      let best = 0, hit = null, tie = false;
      for (const t of ix.tokenNames) for (const set of t.sets) {
        if (!set.every((w) => words.has(w))) continue;
        if (set.length > best) { best = set.length; hit = t.id; tie = false; } else if (set.length === best && hit !== t.id) tie = true;
      }
      id = hit && !tie ? hit : null;
    }
    id = id || null;
    ix.nameCache.set(s, id);
    return id;
  }

  nationsOf(id) {
    const t = this.tById.get(id);
    if (!t) return null;
    const ix = this.#index();
    let keys = keysOf(t.name);
    const curated = (this.#research('search-names.json') || {})[t.id] || [];
    keys = [...new Set([...keys, ...curated.flatMap(keysOf)])];
    // Exact links first: the crosswalk, then nations that name this territory.
    // Fuzzy name matching only when nothing exact exists.
    const nations = [];
    const cw = ix.crosswalk[t.name] ?? ix.crosswalk[t.name.trim()];
    if (cw && ix.nationById.get(cw)) nations.push(ix.nationById.get(cw));
    for (const n of ix.nations) if ((n.nativeLandNames || []).some((x) => x.trim() === t.name.trim()) && !nations.includes(n)) nations.push(n);
    if (!nations.length) for (const n of this.#gather(keys, ix.nationsByKey)) if (!nations.includes(n)) nations.push(n);
    for (const n of nations) keys = [...new Set([...keys, ...keysOf(n.name), ...(n.aliases || []).flatMap(keysOf), ...keysOf(n.endonym)])];
    return { t, ix, keys, nations };
  }

  territory(id) {
    const base = this.nationsOf(id);
    if (!base) return null;
    const { t, ix, keys, nations } = base;

    const items = this.#itemsOf(t.id, keys, ix);
    const uses = this.#usesOf(t.id, keys, ix);
    const plantList = this.#plantsFrom(uses, ix);
    const lands = (t.reservations || []).map((rid) => this.lById.get(rid)).filter(Boolean)
      .map(({ id, name, kind, lonlat }) => ({ id, name, kind, lonlat }));
    const groups = {};
    for (const g of Object.keys(GROUPS)) groups[g] = { label: GROUPS[g].label, count: 0, items: [] };
    for (const it of items) {
      const g = groups[groupOf(it.kind)];
      g.count++;
      if (g.items.length < 24) g.items.push(it);
    }
    const useCounts = {};
    for (const u of uses) useCounts[u.use] = (useCounts[u.use] || 0) + 1;
    const { polys, ...meta } = t;
    return {
      ...meta,
      keys,
      nations,
      profile: /^list of/i.test(ix.profiles[t.id]?.title || '') ? null : ix.profiles[t.id] || null,
      lands,
      groups,
      featured: items.filter((i) => i.image || (i.thumb && i.kind !== 'book')).slice(0, 14),
      itemCount: items.length,
      plants: plantList.slice(0, 60),
      plantCount: plantList.length,
      plantUseCount: uses.length,
      useCounts,
    };
  }

  // Exact (harvested for this territory) first, then the older name-matched archive items. One copy per url.
  #itemsOf(id, keys, ix) {
    const seen = new Set(), out = [];
    for (const it of [...(ix.harvestByTerritory.get(id) || []), ...this.#gather(keys, ix.itemsByKey)]) {
      if (!it.url || seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
    }
    return out.sort((a, b) => richness(b) - richness(a));
  }

  #plantsFrom(uses, ix) {
    const plants = new Map();
    for (const u of uses) {
      const p = plants.get(u.plant) || { plant: u.plant, commonName: u.commonName, info: ix.plantByName.get(u.plant) || null, uses: [] };
      p.uses.push({ use: u.use, subUse: u.subUse, note: u.note, citation: u.citation, url: u.url, nation: u.nation });
      plants.set(u.plant, p);
    }
    return [...plants.values()].sort((a, b) => b.uses.length - a.uses.length);
  }

  // One page of a group, optionally narrowed by words in the title.
  items(id, group, { offset = 0, limit = 48, q = '' } = {}) {
    const t = this.tById.get(id);
    if (!t) return null;
    const d = this.#keysAndIndex(t);
    const words = norm(q).split(' ').filter(Boolean);
    const all = this.#itemsOf(id, d.keys, d.ix).filter((i) => (!group || groupOf(i.kind) === group)
      && (!words.length || words.every((w) => norm(`${i.title} ${i.creator || ''} ${i.summary || ''}`).includes(w))));
    return { total: all.length, offset, items: all.slice(offset, offset + limit) };
  }

  plants(id, { use = '', q = '', offset = 0, limit = 60 } = {}) {
    const t = this.tById.get(id);
    if (!t) return null;
    const d = this.#keysAndIndex(t);
    const words = norm(q).split(' ').filter(Boolean);
    let uses = this.#usesOf(t.id, d.keys, d.ix);
    if (use) uses = uses.filter((u) => u.use === use);
    if (words.length) uses = uses.filter((u) => words.every((w) => norm(`${u.plant} ${u.commonName} ${u.subUse} ${u.note}`).includes(w)));
    const list = this.#plantsFrom(uses, d.ix);
    return { total: list.length, offset, plants: list.slice(offset, offset + limit) };
  }

  // Everything, across every nation: one group, narrowed by words, newest harvest first.
  browse(group, { q = '', offset = 0, limit = 48 } = {}) {
    const ix = this.#index();
    const words = norm(q).split(' ').filter(Boolean);
    if (!this.#browseCache || this.#browseCache.ix !== ix) {
      const seen = new Set(), all = [];
      for (const it of ix.allItems) { if (!it.url || seen.has(it.url)) continue; seen.add(it.url); all.push(it); }
      all.sort((a, b) => richness(b) - richness(a));
      this.#browseCache = { ix, all };
    }
    const where = (it) => {
      const tid = (it.territories || [])[0];
      return tid ? { id: tid, name: this.tById.get(tid)?.name } : null;
    };
    const list = this.#browseCache.all.filter((i) => (!group || groupOf(i.kind) === group)
      && (!words.length || words.every((w) => norm(`${i.title} ${i.creator || ''} ${i.nation || ''} ${i.summary || ''}`).includes(w))));
    return { total: list.length, offset, items: list.slice(offset, offset + limit).map((i) => ({ ...i, where: where(i) })) };
  }

  browsePlants({ q = '', use = '', offset = 0, limit = 40 } = {}) {
    const ix = this.#index();
    const words = norm(q).split(' ').filter(Boolean);
    let uses = ix.allUses;
    if (use) uses = uses.filter((u) => u.use === use);
    if (words.length) uses = uses.filter((u) => words.every((w) => norm(`${u.plant} ${u.commonName} ${u.subUse} ${u.note} ${u.nation}`).includes(w)));
    const list = this.#plantsFrom(uses, ix);
    return { total: list.length, offset, plants: list.slice(offset, offset + limit) };
  }
  #browseCache = null;

  #keysAndIndex(t) {
    const r = this.nationsOf(t.id);
    return { keys: r.keys, ix: r.ix };
  }

  land(id) {
    const l = this.lById.get(id);
    if (!l) return null;
    const { polys, ...meta } = l;
    return { ...meta, territories: (l.territories || []).map((tid) => ({ id: tid, name: this.tById.get(tid)?.name })) };
  }

  // How well a name answers the query: exact 100, starts with 80, a whole word starts with 60,
  // anywhere 30 (only for queries of 4+ letters, so "dine" does not find "Gardiner").
  static score(name, k) {
    const n = norm(name);
    if (!n || !k) return 0;
    if (n === k) return 100;
    if (n.startsWith(k)) return 80;
    if ((' ' + n).includes(' ' + k)) return 60;
    if (k.length >= 4 && n.includes(k)) return 30;
    return 0;
  }

  // Homelands and lands today, found by any name people use. Curated names (search-names.json)
  // and nation aliases find a homeland, but the homeland is always shown by its own name; the
  // name that found it travels separately as "foundBy" (PROTOCOLS: outsider names only find).
  searchPlaces(q) {
    const k = norm(q);
    if (k.length < 2) return [];
    const best = new Map();
    const put = (type, id, name, s, foundBy, extra = {}) => {
      if (!s) return;
      const key = `${type}/${id}`;
      const prev = best.get(key);
      if (!prev || s > prev.score) best.set(key, { type, id, name, score: s, foundBy: foundBy && norm(foundBy) !== norm(name) ? foundBy : null, ...extra });
    };
    for (const t of this.territories) { const v = Library.score(t.name, k); if (v) put('territory', t.id, t.name, v + 5); }
    const curated = this.#research('search-names.json') || {};
    for (const [tid, names] of Object.entries(curated)) {
      const t = this.tById.get(tid);
      if (!t || !Array.isArray(names)) continue;
      for (const nm of names) put('territory', tid, t.name, Library.score(nm, k), nm);
    }
    const ix = this.#index();
    const homesOf = new Map();
    for (const [tName, nid] of Object.entries(ix.crosswalk)) {
      const t = this.territories.find((x) => x.name === tName || x.name.trim() === String(tName).trim());
      if (t) { if (!homesOf.has(nid)) homesOf.set(nid, []); homesOf.get(nid).push(t); }
    }
    for (const n of ix.nations) {
      const names = [n.name, n.endonym, ...(n.aliases || []), ...(n.officialNames || [])].filter(Boolean);
      let s = 0, by = null;
      for (const nm of names) { const v = Library.score(nm, k); if (v > s) { s = v; by = nm; } }
      if (!s) continue;
      const homes = [...(homesOf.get(n.id) || [])];
      for (const t of this.territories) if ((n.nativeLandNames || []).some((x) => x.trim() === t.name.trim()) && !homes.includes(t)) homes.push(t);
      for (const t of homes) put('territory', t.id, t.name, s - 2, by);
      if (s > 4) put('nation', n.id, n.name, s - 4, by === n.name ? null : by, { states: n.states || [], recognition: n.recognition || null });
    }
    for (const l of this.lands) { const v = Library.score(l.name, k); if (v) put('land', l.id, l.name, v - 6, null, { kind: l.kind }); }
    return [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  // Library items whose title holds every word of the query as a whole word.
  searchItems(q, limit = 8) {
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length || words.join(' ').length < 3) return [];
    const ix = this.#index();
    const hits = [];
    for (const it of ix.allItems) {
      if (hits.length >= limit) break;
      const t = ' ' + norm(it.title) + ' ';
      if (!words.every((w) => t.includes(' ' + w + ' ') || (w.length >= 5 && t.includes(' ' + w)))) continue;
      const tid = (it.territories || [])[0];
      if (tid) hits.push({ type: 'item', id: tid, name: it.title, kind: it.kind, url: it.url, where: this.tById.get(tid)?.name, item: it });
    }
    return hits;
  }

  search(q) {
    const places = this.searchPlaces(q);
    return [...places.filter((p) => p.type !== 'nation').slice(0, 24), ...this.searchItems(q, 12)];
  }

  stats() {
    const ix = this.#index();
    return { territories: this.territories.length, lands: this.lands.length, ...ix.counts };
  }
}
