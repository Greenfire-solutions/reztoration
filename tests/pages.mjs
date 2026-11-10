// The page suite: every screen loaded in real headless Chrome against a sandbox server, its
// rendered nodes counted, its console watched. An API that answers proves nothing about a page.
//   npm run test:pages        (TEST_PORT, default 8602; SHOTS=dir to keep screenshots)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 8602);
const BASE = `http://127.0.0.1:${PORT}`;
const HOMELANDS = fs.existsSync(path.join(root, 'public/data/territories.json'));
const SHOTS = process.env.SHOTS || '';
const nations = JSON.parse(fs.readFileSync(path.join(root, 'data/research/nations.json'), 'utf8'));
const navajoNation = nations.find((n) => n.name === 'Navajo Nation').id;

const PHONE = ['--width', '390', '--height', '844'];
// [name, hash, extra args]. Every page must render these nodes with no uncaught exception and no console error.
const pages = [
  ['welcome on first visit', '', ['--expect', '#welcome:not([hidden])=1', '--expect', '.doors a=3', '--expect', '.doors button=1']],
  ['welcome door to search', '', ['--click', '#welcome [data-door="find"]', '--expect', '#welcome[hidden]=1']],
  ['broken treaties', '#broken', ['--expect', '.bt-card=20', '--expect', '.bt-state option=30', '--expect', '.bt-map=1']],
  ['broken treaties by state', '#broken/MN', ['--expect', '.bt-card=10', '--expect', '.bt-state option[value="MN"]:checked=1']],
  ['broken treaties on the map', '#broken/MN', ['--click', '.bt-map', '--wait', '2500', '--expect', '#panel:not([hidden]) .backline=1', '--expect', '#panel .trow=10']],
  ['treaty list with show more', '#treaties', ['--expect', '#panel .trow=100', '--expect', '#panel .morebtn=1']],
  ['a treaty', '#treaty/cession-1891-02-13-iowa', ['--expect', '#panel .status=1', '--expect', '#panel .breach=1']],
  ['business list', '#businesses', ['--expect', '.bizlist .trow=50', '--expect', '.bizstate option=30', '--expect', '#panel .morebtn=1']],
  ['business list by state', '#businesses/OK', ['--expect', '.bizlist .trow=10', '--expect', '.bizstate option[value="OK"]:checked=1']],
  ['business list show more', '#businesses', ['--click', '#panel .morebtn', '--wait', '1500', '--expect', '.bizlist .trow=100']],
  ['a nation', `#nation/${navajoNation}`, ['--expect', '#panel .summary=1', '--expect', '#panel h3=2']],
  ['where am I, empty', '#where', ['--expect', '.whereform=1', '--expect', '.locate=1']],
  ['where am I, a town', '#where/Austin%2C%20TX', ['--expect', '.whereout .trow=3']],
  ['where am I, a zip', '#where/59101', ['--expect', '.whereout .trow=3']],
  ['library', '#library/art', ['--expect', '#library:not([hidden]) .tabs.lib a=6', '--expect', '.libbody .g=20']],
  ['library plants', '#library/plants', ['--expect', '.libbody details.plant=10']],
  ['phone: welcome', '', [...PHONE, '--expect', '.doors a=3']],
  ['phone: broken', '#broken/OK', [...PHONE, '--expect', '.bt-card=5']],
  ['phone: map key', '#treaties', [...PHONE, '--click', '#key-btn', '--expect', 'body.key-open=1']],
];
if (HOMELANDS) pages.push(
  ['a homeland', '#territory/navajo', ['--expect', '.tabs.main button=4', '--expect', '.nname a=1', '--expect', '.summary .linkish=2']],
  ['homeland stories', '#territory/navajo', ['--click', '[data-tab="stories"]', '--expect', '.story-chips button=3', '--expect', '#group .g=10', '--allow-console']],
  ['homeland plants', '#territory/navajo', ['--click', '[data-tab="plants"]', '--expect', '#tab details.plant=10']],
  ['homeland land and treaties', '#territory/navajo', ['--click', '[data-tab="land"]', '--expect', '#treaty-part .trow=2']],
  ['homeland sources', '#territory/navajo', ['--click', '[data-src]', '--expect', '#tab .card=3']],
  ['a small homeland', '#territory/matapeake', ['--expect', '#panel h2=1', '--expect', '#tab .links a=1']],
  ['where am I, coordinates', '#where/@-97.74,30.27', ['--expect', '.whereout .links.big a=3']],
  ['phone: homeland', '#territory/navajo', [...PHONE, '--expect', '.tabs.main button=4']],
);

// Regressions from the 11-10 fresh-eyes pass. Each one was a real defect.
const type = (text, between = '') => `{ const q = document.querySelector('#q'); q.focus(); q.value = ${JSON.stringify(text)}; q.dispatchEvent(new Event('input')); ${between} q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await new Promise((r) => setTimeout(r, 2500)); document.body.dataset.hash = location.hash; }`;
pages.push(
  ['Enter searches what is typed now', '#broken', ['--ready', '#q', '--run', type('Hopi'), '--expect', 'body[data-hash^="#territory/hopi"], body[data-hash^="#nation/hopi"]=1']],
  ['Enter after changing the words uses the new words', '', ['--ready', '#q', '--run', `{ const q = document.querySelector('#q'); q.value = 'Lakota'; q.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 1200)); } ${type('Hopi')}`, '--expect', 'body:not([data-hash*="oceti"])[data-hash*="hopi"]=1']],
  ['Enter in an empty box goes nowhere', '#broken', ['--ready', '#q', '--run', type(''), '--expect', 'body[data-hash="#broken"]=1']],
  ['the treaties on the map have a way back', '#brokenmap/MN', ['--expect', '#panel .backline=1', '--expect', '#panel .trow=10']],
  ['closing the treaties on the map returns to the list', '#brokenmap/MN', ['--click', '#close', '--expect', '#broken:not([hidden])=1', '--expect', '.bt-state option[value="MN"]:checked=1']],
  ['lowercase state in a link still filters', '#broken/sd', ['--expect', '.bt-state option[value="SD"]:checked=1']],
  ['the business state list has every state', '#businesses', ['--expect', '.bizstate option=45']],
  ['typed coordinates without a space', '#where/35.6%2C-106.0', ['--expect', '.whereout .links.big a=1']],
  ['Honolulu is found', '#where/Honolulu', ['--expect', '.whereout .links.big a=1']],
  ['focusing search closes the welcome card', '', ['--ready', '#welcome:not([hidden])', '--run', "document.querySelector('#q').focus()", '--expect', '#welcome[hidden]=1']],
);

async function main() {
  try { const r = await fetch(`${BASE}/api/whoami`); if (r.ok) { console.error(`Port ${PORT} is taken. Set TEST_PORT.`); process.exit(2); } } catch {}
  const srv = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); try { up = (await (await fetch(`${BASE}/api/whoami`)).json()).pid === srv.pid; } catch {} }
  if (!up) { srv.kill(); console.error('server did not start'); process.exit(1); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const failed = [];
  for (const [name, hash, args] of pages) {
    const extra = SHOTS ? ['--shot', path.join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`)] : [];
    const r = spawnSync(process.execPath, [path.join(root, 'tests/prove-page.mjs'), `${BASE}/${hash}`, '--gpu', '--timeout', '30000', ...args, ...extra], { encoding: 'utf8', timeout: 120000 });
    const ok = r.status === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) { failed.push(name); console.log((r.stdout + r.stderr).split('\n').filter((l) => /FAIL|Error|exception/i.test(l)).map((l) => `     ${l.trim()}`).join('\n')); }
  }
  srv.kill();
  console.log(`\n${pages.length - failed.length} of ${pages.length} pages render.${HOMELANDS ? '' : ' (Homeland pages skipped: no Native Land outlines in this copy.)'}`);
  process.exit(failed.length ? 1 : 0);
}
main();
