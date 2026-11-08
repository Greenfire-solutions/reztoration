// Art: Art Institute of Chicago and Cleveland Museum of Art open access APIs.
// A work counts only when the people's name is in the artist line or culture,
// so "Crow" finds Apsáalooke beadwork, not paintings of crows.
import { get, run, mentions, clean } from './common.mjs';

const AIC_FIELDS = 'id,title,artist_display,place_of_origin,date_display,image_id,is_public_domain,department_title,medium_display,classification_title,style_titles,description';

await run('art', async (t, sink) => {
  const n = t.name;
  const aic = await get(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(n)}&limit=80&fields=${AIC_FIELDS}`, { gap: 1000 });
  for (const a of aic?.data || []) {
    const native = /arts of the americas|native american|indigenous/i.test([a.department_title, (a.style_titles || []).join(' '), a.artist_display].join(' '));
    if (!native || !mentions(n, a.artist_display, a.place_of_origin, a.style_titles)) continue;
    sink.add({
      kind: 'art',
      title: clean(a.title, 200),
      date: a.date_display || null,
      creator: clean(a.artist_display, 160),
      url: `https://www.artic.edu/artworks/${a.id}`,
      thumb: a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg` : null,
      image: a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/1200,/0/default.jpg` : null,
      medium: clean([a.classification_title, a.medium_display].filter(Boolean).join(', '), 160),
      rights: a.is_public_domain ? 'Public domain (CC0), Art Institute of Chicago' : 'In copyright or rights reserved; see the museum page',
      summary: clean(a.description, 300),
      institution: 'Art Institute of Chicago',
    }, t);
  }

  const cma = await get(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(n)}&limit=80`, { gap: 1000 });
  for (const a of cma?.data || []) {
    const creators = (a.creators || []).map((c) => c.description).join('; ');
    if (!/native american|indigenous|first nations|alaska native/i.test([...(a.culture || []), creators].join(' ')) || !mentions(n, a.culture, creators)) continue;
    sink.add({
      kind: 'art',
      title: clean(a.title, 200),
      date: a.creation_date || null,
      creator: clean(creators || (a.culture || []).join('; '), 160),
      url: a.url,
      thumb: a.images?.web?.url || null,
      image: a.images?.print?.url || a.images?.web?.url || null,
      medium: clean([a.type, a.technique].filter(Boolean).join(', '), 160),
      rights: a.share_license_status === 'CC0' ? 'Public domain (CC0), Cleveland Museum of Art' : `${a.share_license_status || 'Rights unknown'}; see the museum page`,
      summary: clean(a.description || a.tombstone, 300),
      institution: 'Cleveland Museum of Art',
    }, t);
  }
});
