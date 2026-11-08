// Smithsonian Open Access: National Museum of the American Indian, the National
// Anthropological Archives, Natural History anthropology, American Art and more.
// A record counts only when the people's name is in its Culture/People field.
// Key: SMITHSONIAN_API_KEY in .env (api.data.gov, 1,000 requests an hour, so one every 4 s).
import fs from 'node:fs';
import path from 'node:path';
import { get, run, mentions, clean, ROOT } from './common.mjs';

for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.SMITHSONIAN_API_KEY;
if (!KEY) { console.error('smithsonian: no SMITHSONIAN_API_KEY in .env'); process.exit(1); }

const UNIT = { NMAI: 'National Museum of the American Indian', NAA: 'National Anthropological Archives', NMNHANTHRO: 'National Museum of Natural History', SAAM: 'Smithsonian American Art Museum', NPG: 'National Portrait Gallery', NMAH: 'National Museum of American History', CFCHFOLKLIFE: 'Ralph Rinzler Folklife Archives', NMAAHC: 'National Museum of African American History and Culture', SIA: 'Smithsonian Institution Archives', FSG: 'National Museum of Asian Art', CHNDM: 'Cooper Hewitt' };

function kindOf(types, unit) {
  const t = types.join(' ').toLowerCase();
  if (/sound|audio/.test(t)) return 'audio';
  if (/video|film|motion picture/.test(t)) return 'film';
  if (/photograph|negative|lantern slide|stereograph|tintype|daguerreotype|cabinet card/.test(t)) return 'photo';
  if (/manuscript|letter|document|book|journal|field notes|vocabular|archival|records|ledger/.test(t)) return unit === 'NAA' && /ledger/.test(t) ? 'art' : 'document';
  return 'art';
}

await run('smithsonian', async (t, sink) => {
  const n = t.name.replace(/"/g, '');
  for (let start = 0; start < 200; start += 100) {
    const q = `"${n}" AND (unit_code:NMAI OR unit_code:NAA OR unit_code:NMNHANTHRO OR unit_code:SAAM OR unit_code:NPG OR unit_code:NMAH OR unit_code:CFCHFOLKLIFE)`;
    const d = await get(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(q)}&rows=100&start=${start}&api_key=${KEY}`, { gap: 4000, ua: 'Reztoration/1.0' });
    const rows = d?.response?.rows || [];
    for (const r of rows) {
      const c = r.content || {}, ft = c.freetext || {}, ix = c.indexedStructured || {}, dn = c.descriptiveNonRepeating || {};
      const people = (ft.name || []).filter((x) => /culture|people|tribe/i.test(x.label)).map((x) => x.content);
      const cultures = [...people, ...(ix.culture || []), ...Object.entries(ix).filter(([k]) => k.startsWith('nmaiculture')).flatMap(([, v]) => v)];
      if (!mentions(n, cultures)) continue;
      const types = [...(ix.object_type || []), ...(ft.objectType || []).map((x) => x.content)];
      const media = dn.online_media?.media?.find((m) => m.type === 'Images') || dn.online_media?.media?.[0];
      const usage = media?.usage?.access || dn.metadata_usage?.access;
      const maker = (ft.name || []).find((x) => /artist|maker|photographer|creator|author|collector/i.test(x.label))?.content;
      const desc = (ft.notes || []).find((x) => /summary|description|general|scope/i.test(x.label))?.content;
      const phys = (ft.physicalDescription || []).filter((x) => /object name|media|materials/i.test(x.label)).map((x) => x.content).join(', ');
      sink.add({
        kind: kindOf(types, r.unitCode),
        title: clean(r.title, 200),
        date: clean((ft.date || [])[0]?.content, 40),
        creator: clean(maker || people[0], 160),
        url: `https://collections.si.edu/search/detail/${r.url}`,
        thumb: media?.thumbnail || null,
        image: media?.content && media.type === 'Images' ? media.content : null,
        media: media && /Sound|Video/i.test(media.type || '') ? media.content : null,
        medium: clean(phys, 160),
        rights: usage === 'CC0' ? 'CC0, Smithsonian Open Access' : 'Smithsonian: see the record for rights and image use',
        summary: clean(desc, 300),
        institution: UNIT[r.unitCode] || `Smithsonian (${r.unitCode})`,
        subjects: [...types, ...(ix.topic || [])],
      }, t);
    }
    if (rows.length < 100) break;
  }
});
