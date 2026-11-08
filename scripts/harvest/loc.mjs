// Library of Congress: films, recordings, photos, manuscripts and maps.
// loc.gov asks for a slow crawl, so one request every 3 seconds.
import { get, run, strict, clean } from './common.mjs';


function kindOf(r, fallback) {
  const of = (r.original_format || []).join(' ');
  if (/film|video/.test(of)) return 'film';
  if (/sound|audio/.test(of)) return 'audio';
  if (/map/.test(of)) return 'map';
  if (/newspaper/.test(of)) return 'newspaper';
  if (/manuscript|book|periodical|legislation/.test(of)) return 'document';
  if (/photo|print|drawing|image/.test(of)) return 'photo';
  return (r.online_format || []).includes('image') ? 'photo' : 'document';
}

await run('loc', async (t, sink) => {
  const n = t.name;
  // One query per name; loc.gov is slow and throttles, so formats are sorted afterwards.
  {
    const kind = 'photo';
    const url = `https://www.loc.gov/search/?q=${encodeURIComponent(`${n} Indians`)}&fo=json&c=100&at=results`;
    const d = await get(url, { gap: 4000, tries: 2 });
    for (const r of d?.results || []) {
      const text = [r.title, r.subject, r.description];
      if (!(r.online_format || []).length || !strict(n, text)) continue;
      const res = (r.resources || [])[0] || {};
      const k = kindOf(r, kind);
      sink.add({
        kind: k,
        title: clean(r.title, 200),
        date: r.date || null,
        creator: clean((r.contributor || []).slice(0, 2).join('; '), 120),
        url: r.url || r.id,
        thumb: (r.image_url || [])[0] || res.image || null,
        media: k === 'film' ? res.video || null : k === 'audio' ? res.audio || null : null,
        rights: clean(r.rights, 300) || 'Library of Congress: see item page for rights',
        summary: clean(r.description, 300),
        subjects: r.subject,
      }, t);
    }
  }
});
