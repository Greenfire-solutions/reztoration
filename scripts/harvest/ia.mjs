// Internet Archive: films, sound recordings and books/journals, by Library of
// Congress subject heading ("Navajo Indians") or by title with a people word.
import { get, run, strict, clean } from './common.mjs';

const KIND = { movies: 'film', audio: 'audio', texts: 'book' };
const ROWS = { movies: 60, audio: 60, texts: 100 };
const FL = ['identifier', 'title', 'description', 'date', 'year', 'creator', 'mediatype', 'subject', 'licenseurl', 'rights', 'collection'];

await run('ia', async (t, sink) => {
  const n = t.name.replace(/"/g, '');
  for (const mt of Object.keys(KIND)) {
    const q = `(subject:"${n} Indians" OR subject:"${n} Indian" OR subject:"${n} people" OR subject:"${n} language" OR (title:"${n}" AND (title:(Indian OR Indians OR Native OR tribe OR Nation OR Pueblo OR reservation) OR subject:(Indians OR Indigenous OR Native)))) AND mediatype:${mt} AND NOT collection:(tvarchive OR tvnews OR TV-*)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&${FL.map((f) => `fl[]=${f}`).join('&')}&sort[]=downloads+desc&rows=${ROWS[mt]}&output=json`;
    const d = await get(url, { gap: 1000 });
    for (const doc of d?.response?.docs || []) {
      const subj = [].concat(doc.subject || []);
      const text = [doc.title, subj, doc.description];
      if (!strict(n, doc.title, subj, clean(doc.description, 800))) continue;
      const id = doc.identifier;
      sink.add({
        kind: KIND[mt],
        title: clean(doc.title, 200),
        date: String(doc.year || doc.date || '').slice(0, 10) || null,
        creator: clean(doc.creator, 120),
        url: `https://archive.org/details/${id}`,
        thumb: `https://archive.org/services/img/${id}`,
        media: mt === 'texts' ? null : `https://archive.org/embed/${id}`,
        embed: mt !== 'texts',
        rights: doc.licenseurl || clean(doc.rights, 200) || 'unknown',
        summary: clean(doc.description, 300),
        subjects: subj,
      }, t);
    }
  }
});
