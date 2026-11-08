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

  search(q) {
    const k = norm(q);
    if (k.length < 2) return [];
    const out = [];
    for (const t of this.territories) if (norm(t.name).includes(k)) out.push({ type: 'territory', id: t.id, name: t.name });
    for (const l of this.lands) if (norm(l.name).includes(k)) out.push({ type: 'land', id: l.id, name: l.name, kind: l.kind });
    const ix = this.#index();
    for (const n of ix.nations) {
      if (![n.name, ...(n.aliases || [])].some((x) => norm(x).includes(k))) continue;
      const tName = Object.entries(ix.crosswalk).find(([, v]) => v === n.id)?.[0];
      const t = tName && this.territories.find((x) => x.name === tName);
      if (t && !out.some((o) => o.id === t.id)) out.push({ type: 'territory', id: t.id, name: `${n.name} (${t.name})` });
    }
    const words = k.split(' ');
    const hits = [];
    if (k.length >= 3) for (const it of ix.allItems) {
      if (hits.length >= 12) break;
      if (words.every((w) => norm(it.title).includes(w))) {
        const tid = (it.territories || [])[0];
        if (tid) hits.push({ type: 'item', id: tid, name: it.title, kind: it.kind, url: it.url, where: this.tById.get(tid)?.name, item: it });
      }
    }
    return [...out.slice(0, 24), ...hits];
  }

  stats() {
    const ix = this.#index();
    return { territories: this.territories.length, lands: this.lands.length, ...ix.counts };
  }
}
