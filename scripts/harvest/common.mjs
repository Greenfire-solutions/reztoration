// Shared pieces for every harvester. PROTOCOLS.md rules apply:
// public sources only, about one request a second per site, links not copies,
// sacred and community-only material left out, rights recorded as given.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Library } from '../../lib/library.mjs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'data/research/harvest');
const CACHE = path.join(ROOT, 'data/cache');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const UA = 'Reztoration-research/1.0 (private non-commercial cultural map; links only)';
const lastHit = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One request per `gap` ms per host. Responses cached on disk so a stopped run resumes free.
export async function get(url, { gap = 1100, json = true, tries = 4, ua = UA } = {}) {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE, key.slice(0, 2), key);
  if (fs.existsSync(file)) {
    const body = fs.readFileSync(file, 'utf8');
    return json ? JSON.parse(body) : body;
  }
  const host = new URL(url).host;
  for (let i = 0; i < tries; i++) {
    const wait = (lastHit.get(host) || 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(45000) });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!res.ok) return null;
      const body = await res.text();
      const val = json ? JSON.parse(body) : body;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return val;
    } catch {
      await sleep(3000 * (i + 1));
    }
  }
  return null;
}

export { isSacred, tkClosed } from '../../lib/protocols.mjs';
import { isSacred, tkClosed } from '../../lib/protocols.mjs';

// Search names for each territory: the English name in brackets and the name outside,
// in Latin letters only, each mapped to every territory that uses it.
export const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'");

// Names from the nations matched to a territory and its Wikipedia title, so a territory
// named only in its own script (Diné Bikéyah, Očhéthi Šakówiŋ) is still searched for.
function nationNames(lib, profiles, t) {
  const out = new Set();
  const d = lib.nationsOf(t.id);
  const short = (x) => fold(x)
    .replace(/,.*$/, '')
    .replace(/\b(of|in) (the )?(state of )?[A-Z][\w ]*$/, '')
    .replace(/\b(Indian|Indians|Tribe|Tribes|Nation|Nations|Community|Band|Bands|Reservation|Rancheria|Confederated|Federated|Tribal|Council|Village|Native|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const p = /^list of/i.test(profiles[t.id]?.title || '') ? null : profiles[t.id]?.title;
  const first = p ? [fold(p).replace(/\s*\(.*\)$/, '').replace(/ (people|peoples|tribe|nation)$/i, '')] : [];
  for (const n of d.nations) for (const x of [n.name, n.endonym, ...(n.aliases || [])].filter(Boolean)) {
    for (const part of short(x).split(/\s+and\s+|\s*&\s*|\s*\/\s*/)) {
      const v = part.trim();
      if (v && v.split(' ').length <= 3 && !/^[A-Z]{2,8}$/.test(v) && !/^(people|peoples|keepers|members|sault|list|the|united|first|council|indian|native)$/i.test(v)) out.add(v);
    }
  }
  return [...new Set([...first, ...[...out].sort((a, b) => a.length - b.length)])].slice(0, 14);
}

export function territoryTargets() {
  const territories = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/territories.json'), 'utf8'));
  let profiles = {};
  try { profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/research/profiles.json'), 'utf8')); } catch {}
  const lib = new Library(ROOT);
  let curated = {};
  try { curated = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/research/search-names.json'), 'utf8')); } catch {}
  const byName = new Map();
  const NOT = /^(east|west|north|south|upper|lower|central|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|territory)$/i;
  const latin = (s) => /^[A-Z][A-Za-z .'-]{2,}$/.test(s) && !NOT.test(s);
  for (const t of territories) {
    const raw = t.name.replace(/\(territory\)/i, '').trim();
    const inner = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    const outer = raw.replace(/\([^)]*\)/g, '').trim();
    const names = new Set();
    for (const s of [...inner, outer].map(fold)) for (const part of s.split(/\s*[/,]\s*|\s+and\s+/)) {
      const p = part.replace(/’/g, "'").trim();
      if (latin(p)) names.add(p);
    }
    for (const p of (curated[t.id] || []).map(fold)) names.add(p);
    for (const p of nationNames(lib, profiles, t)) if (latin(p)) names.add(p);
    for (const n of names) {
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n).add(t.id);
    }
  }
  return [...byName].map(([name, ids]) => ({ name, territories: [...ids] }));
}

// Words that show a hit is about a people, not a place, river or bird.
export const CONTEXT = /\b(indian|indians|native|indigenous|tribe|tribal|tribes|nation|first nations?|reservation|rancheria|pueblo|band of|people|peoples|ethnolog\w*|language)\b/i;
export function mentions(name, ...texts) {
  name = fold(name);
  texts = texts.flat().filter(Boolean).map((t) => fold(Array.isArray(t) ? t.join(' ') : t));
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?")}\\b`, 'i');
  return texts.flat().filter(Boolean).some((t) => re.test(String(t)));
}

export function clean(s, max = 400) {
  if (s == null) return null;
  const t = (Array.isArray(s) ? s.join(' ') : String(s)).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : null;
}

// Writes one source's harvest. Items merge by url; each keeps every territory it was found for.
export class Sink {
  constructor(source) {
    this.file = path.join(OUT, `${process.env.NAMES ? 'trial-' : ''}${source}.json`);
    this.byUrl = new Map();
    this.left = 0;
    this.source = source;
  }
  add(item, target) {
    if (!item.url) return;
    if (isSacred(item.title, item.summary, item.subjects) || tkClosed(item.tkLabels)) { this.left++; return; }
    const hit = this.byUrl.get(item.url);
    if (hit) {
      for (const id of target.territories) if (!hit.territories.includes(id)) hit.territories.push(id);
      return;
    }
    const { subjects, ...rest } = item;
    this.byUrl.set(item.url, { ...rest, nation: target.name, territories: [...target.territories], sourceId: this.source, rights: item.rights || 'unknown' });
  }
  save() {
    const items = [...this.byUrl.values()];
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(items));
    fs.renameSync(this.file + '.tmp', this.file);
    fs.writeFileSync(this.file.replace(/\.json$/, '.meta.json'), JSON.stringify({ source: this.source, items: items.length, leftOutUnderProtocol2: this.left, at: new Date().toISOString() }, null, 1));
    return items.length;
  }
}

export async function run(source, worker) {
  let targets = territoryTargets();
  if (process.env.NAMES) { const want = process.env.NAMES.split(','); targets = targets.filter((t) => want.includes(t.name)); }
  const sink = new Sink(source);
  let i = 0;
  for (const t of targets) {
    try { await worker(t, sink); } catch (e) { console.error(source, t.name, e.message); }
    if (++i % 25 === 0) { sink.save(); console.log(`${source}: ${i}/${targets.length} names, ${sink.byUrl.size} items, ${sink.left} left out`); }
  }
  const n = sink.save();
  console.log(`${source}: done, ${n} items, ${sink.left} left out under protocol 2`);
}

// Strict: the name must sit beside a people word ("Crow Indians", "Chinook texts",
// "Tribe of the Fox"), or be a library subject heading. Keeps out crows, Fox TV and salmon.
const PEOPLE_AFTER = "Eskimos?|Indians?|Nations?|Tribes?|Tribal|people|peoples|language|languages|reservation|reserve|Agency|chiefs?|texts|country|Pueblo|Band|Bands|Confederacy|homeland|elders?|women|men|artists?|beadwork|basketry|baskets|pottery|potters|weavers?|weaving|ethnography|ethnology|myths|legends|tales|songs|dances?|music|culture|treaty|treaties|history|dictionary|grammar|vocabulary|place names|Village|Indigenous";
const PEOPLE_BEFORE = "Indians?|Tribes?|Nations?|Pueblo|people|Band|Bands|chiefs?|Confederated Tribes";
const NOISE = /\b(fox (nation|news|business|sports|broadcasting|video|searchlight|kids)|20th century fox|chinook salmon|oncorhynchus|tucker carlson|cnn|msnbc|wwe|crow search|care cascades?)\b/i;
export function strict(name, ...texts) {
  texts = texts.flat().filter(Boolean).map((t) => fold(t));
  const n = fold(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?").replace(/ /g, '[ -]');
  const after = new RegExp(`\\b${n}[ -](?:${PEOPLE_AFTER})\\b`, 'i');
  const before = new RegExp(`\\b(?:${PEOPLE_BEFORE}) (?:of |of the |and |, )?(?:\\w+ (?:and |& ))?${n}\\b`, 'i');
  if (texts.flat().filter(Boolean).some((t) => NOISE.test(String(t)))) return false;
  return texts.flat().filter(Boolean).some((t) => after.test(String(t)) || before.test(String(t)));
}
