// Checks every treaty findings file against PROTOCOLS 9-11 and prints what the map will show.
//   node scripts/research/check-findings.mjs [id ...]
// Exit code 1 when any file has a problem, so the researcher fixes it before moving on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFinding } from '../../lib/treaties.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data/research/treaty-findings');
const known = new Set(JSON.parse(fs.readFileSync(path.join(root, 'data/research/treaties.json'), 'utf8')).map((t) => t.id));
const only = process.argv.slice(2);
let bad = 0;
const tally = {};
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const id = file.slice(0, -5);
  if (only.length && !only.includes(id)) continue;
  let f;
  try { f = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { console.log(`${id}: NOT VALID JSON (${e.message})`); bad++; continue; }
  const r = checkFinding(f);
  if (f.id !== id) r.problems.push(`id inside the file ("${f.id}") does not match the file name`);
  if (!known.has(id) && !String(id).startsWith('extra-')) r.problems.push('id is not in treaties.json (name an added treaty extra-<slug>)');
  if (f.sameEventAs !== undefined) {
    if (f.sameEventAs === id) r.problems.push('sameEventAs points at itself');
    else if (!known.has(f.sameEventAs) && !String(f.sameEventAs).startsWith('extra-')) r.problems.push(`sameEventAs "${f.sameEventAs}" is not in treaties.json`);
    else { try { const p = JSON.parse(fs.readFileSync(path.join(dir, f.sameEventAs + '.json'), 'utf8')); if (p.sameEventAs) r.problems.push(`sameEventAs "${f.sameEventAs}" itself points elsewhere; point at the primary`); } catch { r.problems.push(`sameEventAs "${f.sameEventAs}" has no findings file`); } }
  }
  tally[r.status] = (tally[r.status] || 0) + 1;
  if (r.problems.length) { bad++; console.log(`${id}: shown as ${r.status}\n  - ${r.problems.join('\n  - ')}`); }
  else if (only.length) console.log(`${id}: OK, shown as ${r.status}`);
}
console.log(`\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'no findings yet'}; ${bad} file(s) with problems`);
process.exit(bad ? 1 : 0);
