// Art: Minneapolis Institute of Art. Its records name the culture ("Diné (Navajo)"),
// so a piece counts only when the people's name is in the culture or artist line.
import { get, run, mentions, clean } from './common.mjs';

await run('mia', async (t, sink) => {
  const n = t.name;
  const d = await get(`https://search.artsmia.org/${encodeURIComponent(n)}?size=100`, { gap: 1100 });
  for (const h of d?.hits?.hits || []) {
    const a = h._source || {};
    if (a.public_access === '0') continue;
    if (!/americas/i.test(a.department || '') || !mentions(n, a.culture, a.artist, a.artist_alt_names)) continue;
    const pd = /public domain/i.test(a.rights_type || '');
    const img = a.image === 'valid' && pd;
    sink.add({
      kind: 'art',
      title: clean(a.title, 200),
      date: a.dated || null,
      creator: clean([a.artist, a.culture].filter((v, i, s) => v && s.indexOf(v) === i).join(', '), 160),
      url: `https://collections.artsmia.org/art/${a.id}`,
      thumb: img ? `https://1.api.artsmia.org/800/${a.id}.jpg` : null,
      image: img ? `https://1.api.artsmia.org/${a.id}.jpg` : null,
      medium: clean([a.classification, a.medium].filter(Boolean).join(', '), 160),
      rights: pd ? 'Public domain, Minneapolis Institute of Art' : `${a.rights_type || 'Rights unknown'}; see the museum page`,
      summary: clean(a.description || a.text, 300),
      institution: 'Minneapolis Institute of Art',
      subjects: [a.object_name, a.classification],
    }, t);
  }
});
