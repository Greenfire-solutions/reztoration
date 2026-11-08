// Journals: open access scholarly works from OpenAlex, the largest open catalogue.
// Name must sit beside a people word in the title or abstract (strict()).
// Key: OPENALEX_API_KEY in .env. It only works after the activation email is clicked.
import fs from 'node:fs';
import path from 'node:path';
import { get, run, strict, clean, ROOT } from './common.mjs';

for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.OPENALEX_API_KEY;
if (!KEY) { console.error('openalex: no OPENALEX_API_KEY in .env'); process.exit(1); }
const probe = await fetch(`https://api.openalex.org/works?search=Navajo&per-page=1&api_key=${KEY}`).catch(() => null);
if (!probe?.ok) { console.error(`openalex: the key is not active yet (HTTP ${probe?.status}). Click "Activate your OpenAlex API key" in the email, then run this again.`); process.exit(2); }

// The abstract arrives as a word index; put the words back in order.
function abstract(inv) {
  if (!inv) return null;
  const words = [];
  for (const [w, at] of Object.entries(inv)) for (const i of at) words[i] = w;
  return words.join(' ');
}

await run('openalex', async (t, sink) => {
  const n = t.name.replace(/"/g, '');
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(`"${n}"`)}&filter=open_access.is_oa:true&per-page=60&select=id,title,publication_year,authorships,primary_location,best_oa_location,abstract_inverted_index,open_access,type&api_key=${KEY}`;
  const d = await get(url, { gap: 300 });
  for (const w of d?.results || []) {
    const abs = abstract(w.abstract_inverted_index);
    if (!strict(n, w.title, clean(abs, 1500))) continue;
    const loc = w.best_oa_location || w.primary_location || {};
    sink.add({
      kind: /book/.test(w.type || '') ? 'book' : 'journal',
      title: clean(w.title, 220),
      date: w.publication_year || null,
      creator: clean((w.authorships || []).slice(0, 4).map((a) => a.author?.display_name).filter(Boolean).join(', '), 160),
      url: loc.landing_page_url || loc.pdf_url || w.open_access?.oa_url || w.id,
      thumb: null,
      journal: clean(loc.source?.display_name, 120),
      rights: loc.license ? `Open access (${loc.license})` : 'Open access; license on the publisher page',
      summary: clean(abs, 360),
    }, t);
  }
});
