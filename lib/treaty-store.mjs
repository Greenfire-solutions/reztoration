// Treaties on the map: the Royce/Forest Service cession list, joined with whatever the
// treaty-researcher agent has found. Findings files are re-read when they change, and every
// one passes through checkFinding, so the map never shows more than the evidence supports.
import fs from 'node:fs';
import path from 'node:path';
import { checkFinding, STATUSES } from './treaties.mjs';
import { norm, keysOf } from './library.mjs';

const SEVERITY = ['unresearched', 'no-breach-found', 'contested', 'unratified', 'broken'];
const worst = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b);

export class TreatyStore {
  constructor(root, library) {
    this.root = root;
    this.lib = library;
    this.dir = path.join(root, 'data/research/treaty-findings');
    this.sig = null;
    this.at = 0;
    this.data = null;
  }

  #read(rel) { try { return JSON.parse(fs.readFileSync(path.join(this.root, rel), 'utf8')); } catch { return null; } }

  #load() {
    if (this.data && Date.now() - this.at < 4000) return this.data;
    this.at = Date.now();
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch {}
    const listFile = path.join(this.root, 'data/research/treaties.json');
    const stat = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
    let auditFiles = [];
    try { auditFiles = fs.readdirSync(path.join(this.root, 'data/research/treaty-audits')); } catch {}
    const sig = `${stat(listFile)}|${files.map((f) => f + stat(path.join(this.dir, f))).join('|')}|${auditFiles.map((f) => f + stat(path.join(this.root, 'data/research/treaty-audits', f))).join('|')}`;
    if (sig === this.sig && this.data) return this.data;

    const base = this.#read('data/research/treaties.json') || [];
    const cessions = this.#read('public/data/cessions.json') || [];
    const audits = new Map();
    try { for (const f of fs.readdirSync(path.join(this.root, 'data/research/treaty-audits')).filter((x) => x.endsWith('.json'))) { const v = this.#read(`data/research/treaty-audits/${f}`); if (v) audits.set(f.slice(0, -5), v); } } catch {}
    const findings = new Map();
    for (const f of files) {
      const v = this.#read(`data/research/treaty-findings/${f}`);
      if (v) findings.set(f.slice(0, -5), v);
    }
    const treaties = base.map((t) => ({ ...t }));
    // Treaties the researcher added that Royce does not cover.
    for (const [id, f] of findings) if (id.startsWith('extra-') && !treaties.some((t) => t.id === id)) {
      treaties.push({ id, date: f.signed || null, name: f.name, kappler: null, royce: [], cessions: [], presentDayTribes: f.presentDayTribes || [], scheduleTribes: f.nations || [], statute: [], executiveOrder: [], states: [], area: f.area || null });
    }
    for (const t of treaties) {
      const f = findings.get(t.id);
      const chk = f ? checkFinding(f) : null;
      t.status = chk ? chk.status : 'unresearched';
      t.finding = f || null;
      t.check = chk;
      t.audit = audits.get(t.id) || null;
      if (f?.name) t.title = f.name;
    }
    const byId = new Map(treaties.map((t) => [t.id, t]));
    const cessionStatus = {};
    const treatiesOfCession = new Map();
    for (const t of treaties) for (const c of t.cessions) {
      cessionStatus[c] = worst(cessionStatus[c] || 'unresearched', t.status);
      if (!treatiesOfCession.has(c)) treatiesOfCession.set(c, []);
      treatiesOfCession.get(c).push(t);
    }
    const cessionById = new Map(cessions.map((c) => [c.id, c]));
    const counts = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
    for (const t of treaties) counts[t.status]++;
    this.sig = sig;
    this.data = { treaties, byId, cessionStatus, treatiesOfCession, cessionById, counts };
    return this.data;
  }

  #brief(t) {
    return { id: t.id, name: t.title || t.name, date: t.date, status: t.status, cessions: t.cessions, nations: t.presentDayTribes.length, area: t.area || null };
  }

  summary() {
    const d = this.#load();
    return {
      statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, { ...v, count: d.counts[k] }])),
      cessionStatus: d.cessionStatus,
      treaties: d.treaties.map((t) => this.#brief(t)),
    };
  }

  treaty(id) {
    const d = this.#load();
    const t = d.byId.get(id);
    if (!t) return null;
    const f = t.finding || {};
    const homelands = [...new Set(t.cessions.flatMap((c) => d.cessionById.get(c)?.territories || []))]
      .map((tid) => ({ id: tid, name: this.lib.tById.get(tid)?.name })).filter((x) => x.name);
    return {
      ...this.#brief(t),
      statusLabel: STATUSES[t.status].label,
      statusNote: STATUSES[t.status].note,
      kappler: t.kappler, royce: t.royce, statute: t.statute, executiveOrder: t.executiveOrder,
      scheduleTribes: t.scheduleTribes, presentDayTribes: t.presentDayTribes, states: t.states,
      homelands,
      center: (() => { const c = d.cessionById.get(t.cessions[0]); return c ? c.center : null; })(),
      finding: t.finding ? {
        aka: f.aka || [], signed: f.signed || null, ratified: f.ratified || null, proclaimed: f.proclaimed || null, citation: f.citation || null,
        textUrl: f.textUrl || null, nations: f.nations || [], promises: f.promises || [],
        breaches: t.check.breaches, landTaken: f.landTaken || null, compensation: f.compensation || null, today: f.today || null,
        nationVoice: f.nationVoice || [], sources: f.sources || [], openQuestions: f.openQuestions || [],
        researchedAt: f.researchedAt || null, claimed: f.status,
        audit: t.audit ? { auditedAt: t.audit.auditedAt || null, verdict: t.audit.verdict || null, changes: t.audit.changes || [] } : null, unsupported: t.check.problems.some((p) => p.startsWith('status')),
      } : null,
    };
  }

  cession(id) {
    const d = this.#load();
    const c = d.cessionById.get(String(id));
    if (!c) return null;
    return {
      id: c.id, status: d.cessionStatus[c.id] || 'unresearched',
      treaties: (d.treatiesOfCession.get(c.id) || []).map((t) => this.#brief(t)),
      homelands: c.territories.map((tid) => ({ id: tid, name: this.lib.tById.get(tid)?.name })).filter((x) => x.name),
    };
  }

  // Treaties for a homeland: land ceded inside it, or signed by the nations living there today.
  forTerritory(id) {
    const d = this.#load();
    const base = this.lib.nationsOf(id);
    if (!base) return null;
    const names = new Set(base.nations.flatMap((n) => [n.name, ...(n.officialNames || [])]).map(norm));
    const keys = new Set(base.keys);
    const signed = [], within = [];
    for (const t of d.treaties) {
      // Signed: Royce names this homeland's people as a party. Within: land ceded inside the
      // outline by others, or a cession the Forest Service links to a nation living here today.
      const ours = t.scheduleTribes.some((s) => s.split(/[;,]\s*/).some((x) => keysOf(x).some((k) => keys.has(k))));
      if (ours) signed.push(t);
      else if (t.presentDayTribes.some((p) => names.has(norm(p))) || t.cessions.some((c) => d.cessionById.get(c)?.territories.includes(id))) within.push(t);
    }
    const order = (a, b) => SEVERITY.indexOf(b.status) - SEVERITY.indexOf(a.status) || String(a.date).localeCompare(String(b.date));
    signed.sort(order); within.sort(order);
    return { total: signed.length + within.length, signed: signed.map((t) => this.#brief(t)), within: within.map((t) => this.#brief(t)) };
  }

  forNationNames(names) {
    const d = this.#load();
    const set = new Set(names.map(norm));
    return d.treaties.filter((t) => t.presentDayTribes.some((p) => set.has(norm(p)))).map((t) => this.#brief(t));
  }
}
