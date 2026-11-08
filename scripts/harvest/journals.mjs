// Journals: open access articles from the Directory of Open Access Journals.
// Name must be in the title or keywords, with a people word somewhere.
import { get, run, strict, clean } from './common.mjs';

await run('journals', async (t, sink) => {
  const n = t.name.replace(/"/g, '');
  const q = `(bibjson.title:"${n}" OR bibjson.keywords:"${n}")`;
  const d = await get(`https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=60`, { gap: 1100 });
  for (const r of d?.results || []) {
    const b = r.bibjson || {};
    const kw = b.keywords || [];
    if (!strict(n, b.title, kw, clean(b.abstract, 1200))) continue;
    const link = (b.link || []).find((l) => l.type === 'fulltext')?.url;
    const doi = (b.identifier || []).find((i) => i.type === 'doi')?.id;
    const url = link || (doi ? `https://doi.org/${doi}` : null);
    sink.add({
      kind: 'journal',
      title: clean(b.title, 220),
      date: b.year || null,
      creator: clean((b.author || []).map((a) => a.name).filter((v, i, s) => s.indexOf(v) === i).slice(0, 4).join(', '), 160),
      url,
      thumb: null,
      journal: clean(b.journal?.title, 120),
      rights: 'Open access journal article; license on the publisher page',
      summary: clean(b.abstract, 360),
      subjects: kw,
    }, t);
  }
});
