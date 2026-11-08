// Profiles: a short introduction and a lead picture for every territory, from
// Wikipedia (CC BY-SA, credited and linked). Used as the outside introduction
// only; the nation's own sites still come first on the page.
import fs from 'node:fs';
import path from 'node:path';
import { get, ROOT, clean, CONTEXT, fold } from './common.mjs';
import { Library } from '../../lib/library.mjs';

const lib = new Library(ROOT);
const out = {};
const file = path.join(ROOT, 'data/research/profiles.json');
const W = 'https://en.wikipedia.org';

async function summary(title) {
  const s = await get(`${W}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { gap: 1100 });
  if (!s || s.type === 'disambiguation' || !s.extract || /^list of|^outline of|^index of/i.test(s.title)) return null;
  return s;
}

const curated = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/research/search-names.json'), 'utf8'));

async function find(name, id, extra = []) {
  const core = name.replace(/\([^)]*\)/g, ' ').trim();
  const inner = (name.match(/\(([^)]+)\)/) || [])[1];
  const known = (curated[id] || []).slice(0, 3);
  const tries = [...new Set([inner && `${inner} people`, inner, `${core} people`, `${core} tribe`, core, ...known.flatMap((k) => [`${k} people`, k])].filter(Boolean))];
  // A search hit counts only if it names the people, so "Dene" can never come back as the Wabanaki
  // and "Salmon River" never as Chinook salmon. Any distinctive word of the name will do.
  const flat = (x) => fold(x).toLowerCase().replace(/[’‘ʼ'`:•]/g, '');
  const GENERIC = new Set(['nation', 'nations', 'people', 'peoples', 'tribe', 'tribes', 'band', 'river', 'island', 'islands', 'lake', 'creek', 'eastern', 'western', 'northern', 'southern', 'central', 'upper', 'lower', 'confederated', 'indian', 'indians', 'native', 'salmon', 'valley', 'mountain', 'great', 'little', 'treaty', 'group', 'community', 'village', 'reservation', 'oklahoma']);
  const words = [...new Set([inner, core, ...known, ...extra].filter(Boolean).flatMap((n) => flat(n).split(/[^a-z0-9]+/)))]
    .filter((w) => w.length >= 4 && !GENERIC.has(w)).map((w) => w.replace(/s$/, ''));
  if (flat(core).length === 3) words.push(flat(core));
  const names_it = (s) => { const f = flat(`${s.title} ${s.extract}`); return words.some((w) => new RegExp(`\\b${w}`).test(f)); };
  // Describes a people, not a town, a skeleton, a treaty or a fish.
  const peoplish = (s) => /\b(is|are|was|were)\b[^.]{0,120}\b(people|peoples|tribe|tribes|band|bands|nation|nations|group|groups|confederacy|indians|community|communities|chiefdom)\b/i.test(s.extract.slice(0, 320));
  for (const q of tries) {
    const s = await summary(q);
    if (s && CONTEXT.test(s.extract) && (names_it(s) || peoplish(s))) return s;
  }
  const hits = await get(`${W}/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(`${inner || core} Native American people`)}`, { gap: 1100 });
  for (const h of hits?.query?.search || []) {
    const s = await summary(h.title);
    if (s && CONTEXT.test(s.extract) && names_it(s) && peoplish(s)) return s;
  }
  return null;
}

let i = 0;
for (const t of lib.territories) {
  const d = lib.territory(t.id);
  let s = null;
  const wp = d.nations.map((n) => n.wikipedia).find(Boolean);
  // A people article reads better than a tribal-government article, so try the people first.
  s = await find(t.name, t.id, d.nations.map((n) => n.name));
  if (!s && wp) s = await summary(decodeURIComponent(wp.split('/wiki/')[1] || ''));
  if (s) out[t.id] = {
    title: s.title,
    extract: clean(s.extract, 1400),
    image: s.originalimage?.source || s.thumbnail?.source || null,
    thumb: s.thumbnail?.source || null,
    url: s.content_urls?.desktop?.page || `${W}/wiki/${encodeURIComponent(s.title)}`,
    rights: 'Text from Wikipedia, CC BY-SA 4.0; image rights on its Wikimedia Commons page',
  };
  if (++i % 25 === 0) { fs.writeFileSync(file, JSON.stringify(out)); console.log(`profiles: ${i}/${lib.territories.length}, ${Object.keys(out).length} found`); }
}
fs.writeFileSync(file, JSON.stringify(out));
console.log(`profiles: done, ${Object.keys(out).length} of ${lib.territories.length}`);
