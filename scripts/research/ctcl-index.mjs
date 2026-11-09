// Every Court of Claims case name, from the Caselaw Access Project (static.case.law, public).
//   node scripts/research/ctcl-index.mjs build            fetch all volumes once into data/cache/ctcl-index.json
//   node scripts/research/ctcl-index.mjs find sioux        cases whose name has all these words, with their JSON url
// Pre-1946 claims under special acts of Congress went straight to this court and never reached the
// Indian Claims Commission, so search here before writing no-breach-found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'data/cache/ctcl-index.json');
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'build') {
  const all = [];
  for (let v = 1; v <= 231; v++) {
    try {
      const r = await fetch(`https://static.case.law/us-ct-cl/${v}/CasesMetadata.json`, { headers: { 'user-agent': 'Reztoration/1.0' } });
      if (!r.ok) { console.error(`vol ${v}: ${r.status}`); continue; }
      for (const c of await r.json()) all.push({ name: c.name_abbreviation || c.name, date: c.decision_date, cite: c.citations?.[0]?.cite, url: `https://static.case.law/us-ct-cl/${v}/cases/${c.file_name}.json` });
    } catch (e) { console.error(`vol ${v}: ${e.message}`); }
    await new Promise((res) => setTimeout(res, 250));
  }
  fs.writeFileSync(file, JSON.stringify(all));
  console.log(`${all.length} cases`);
} else if (cmd === 'find' && rest.length) {
  const words = rest.map((w) => w.toLowerCase());
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hits = all.filter((c) => words.every((w) => String(c.name).toLowerCase().includes(w)));
  for (const c of hits) console.log(`${c.cite} | ${c.date} | ${c.name} | ${c.url}`);
  console.log(`${hits.length} cases`);
} else console.log('usage: node scripts/research/ctcl-index.mjs build | find <words>');
