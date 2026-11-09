// What the treaty researcher should work on next.
//   node scripts/research/treaty-queue.mjs [count=10] [--nation Sioux] [--skip 20] [--from 1850 --to 1870]
// Prints treaties with no findings file yet, the ones touching the most present-day nations first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const count = Number(args.find((a) => /^\d+$/.test(a)) || 10);
const treaties = JSON.parse(fs.readFileSync(path.join(root, 'data/research/treaties.json'), 'utf8'));
const dir = path.join(root, 'data/research/treaty-findings');
const done = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
const nation = opt('nation');
const from = Number(opt('from') || 0), to = Number(opt('to') || 9999);
const list = treaties
  .filter((t) => !done.has(t.id))
  .filter((t) => !nation || [...t.presentDayTribes, ...t.scheduleTribes].some((n) => n.toLowerCase().includes(nation.toLowerCase())))
  .filter((t) => { const y = Number(String(t.date).slice(0, 4)); return y >= from && y <= to; })
  .sort((a, b) => b.presentDayTribes.length + b.cessions.length - (a.presentDayTribes.length + a.cessions.length));
const skip = Number(opt('skip') || 0);
const doneInList = treaties.filter((t) => done.has(t.id)).length;
console.log(`${doneInList} of ${treaties.length} researched, ${treaties.length - doneInList} to go${nation ? ` (filter: ${nation})` : ''}\n`);
for (const t of list.slice(skip, skip + count)) {
  console.log(JSON.stringify({ id: t.id, name: t.name, date: t.date, kappler: t.kappler, royce: t.royce, statute: t.statute, scheduleTribes: t.scheduleTribes, presentDayTribes: t.presentDayTribes, states: t.states, cessions: t.cessions }));
}
