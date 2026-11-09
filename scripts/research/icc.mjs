// Indian Claims Commission decisions, full text, from Oklahoma State University's digital
// collection (public, no login). Most formal "broken" findings come from here.
//   node scripts/research/icc.mjs search sac and fox        decisions whose title has all these words
//   node scripts/research/icc.mjs full seneca sandusky     decisions whose FULL TEXT has all these words
//   node scripts/research/icc.mjs text <pointer>             full text of one decision, to stdout
// Requests are cached and spaced like every other harvester (scripts/harvest/common.mjs).
import { get } from '../harvest/common.mjs';

const B = 'https://cdm17279.contentdm.oclc.org/digital/bl/dmwebservices/index.php?q=';
const [cmd, ...rest] = process.argv.slice(2);
const opts = { gap: 1200, ua: 'Reztoration/1.0' };

if ((cmd === 'search' || cmd === 'full') && rest.length) {
  const words = rest.join(' ').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).join(' ');
  const field = cmd === 'full' ? 'CISOSEARCHALL' : 'title';
  const d = await get(`${B}dmQuery/p17279coll10/${field}^${encodeURIComponent(words)}^all^and/title!date!descri!identi!scope!refere/date/200/1/0/0/0/0/json`, opts);
  console.log(`${d?.pager?.total ?? 0} decisions`);
  for (const r of d?.records || []) console.log([r.pointer, r.date, r.descri, String(r.identi || '').slice(0, 60), String(r.scope || '').slice(0, 200), String(r.title || '').slice(0, 100)].join(' | '));
  console.log('\nOpen one: node scripts/research/icc.mjs text <pointer>. Cite it as https://cdm17279.contentdm.oclc.org/digital/collection/p17279coll10/id/<pointer>');
} else if (cmd === 'text' && /^\d+$/.test(rest[0] || '')) {
  const j = await get(`${B}dmGetItemInfo/p17279coll10/${rest[0]}/json`, opts);
  const t = typeof j?.transc === 'string' ? j.transc : JSON.stringify(j?.transc ?? '');
  console.log(`TITLE: ${j?.title}\nDATE: ${j?.date}\nDOCKET: ${j?.identi}\nREF: ${j?.refere}\nDESC: ${j?.descri}\nURL: https://cdm17279.contentdm.oclc.org/digital/collection/p17279coll10/id/${rest[0]}\n`);
  console.log(t);
} else {
  console.log('usage: node scripts/research/icc.mjs search <title words> | full <full-text words> | text <pointer>');
}
