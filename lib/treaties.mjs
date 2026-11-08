// The rules for what a treaty may be called on the map (PROTOCOLS 9-11), in one place.
// Used by the library when it loads findings and by scripts/research/check-findings.mjs,
// so a findings file can never claim more than its evidence supports.

export const STATUSES = {
  broken: { label: 'Broken', note: 'A court, claims commission, Act of Congress, executive action or the US government itself documents a breach.' },
  unratified: { label: 'Never ratified', note: 'Signed by the nation, never ratified by the US Senate.' },
  contested: { label: 'Contested', note: 'The nation or historians document a breach; no formal finding located yet.' },
  'no-breach-found': { label: 'No breach found yet', note: 'Researched; no documented breach located. This is not a finding that it was honored.' },
  unresearched: { label: 'Not yet researched', note: 'The research agent has not reached this treaty yet.' },
};

// Kinds of evidence that can make a treaty "broken" on their own.
export const FINDING_KINDS = new Set(['court-ruling', 'claims-commission', 'act-of-congress', 'executive-action', 'government-admission']);
export const ALL_KINDS = new Set([...FINDING_KINDS, 'never-ratified', 'nation-statement', 'historian', 'litigation']);

export const PLAIN_KEYS = ['promised', 'happened', 'today'];

const isUrl =(u) => typeof u === 'string' && /^https?:\/\/[^\s]+\.[^\s]+/.test(u);
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// Returns the status the evidence actually supports, and every problem found.
export function checkFinding(f) {
  const problems = [];
  if (!f || typeof f !== 'object') return { status: 'unresearched', problems: ['not an object'] };
  if (!f.id) problems.push('missing id');
  const breaches = Array.isArray(f.breaches) ? f.breaches : [];
  const good = [];
  for (const [i, b] of breaches.entries()) {
    const at = `breach ${i + 1}`;
    if (!ALL_KINDS.has(b.kind)) { problems.push(`${at}: unknown kind "${b.kind}"`); continue; }
    if (!b.what) problems.push(`${at}: says nothing about what happened`);
    if (!isUrl(b.source?.url)) { problems.push(`${at}: no source url`); continue; }
    if (b.quote && words(b.quote) > 25) problems.push(`${at}: quote longer than 25 words`);
    if (/—/.test(`${b.what} ${b.quote || ''}`)) problems.push(`${at}: contains an em dash`);
    good.push(b);
  }
  const formal = good.some((b) => FINDING_KINDS.has(b.kind));
  const never = good.some((b) => b.kind === 'never-ratified');
  const voiced = good.some((b) => ['nation-statement', 'historian', 'litigation'].includes(b.kind));
  let supported = formal ? 'broken' : never ? 'unratified' : voiced ? 'contested' : 'no-breach-found';
  const claimed = STATUSES[f.status] ? f.status : null;
  if (!claimed) problems.push(`unknown status "${f.status}"`);
  // A file may claim less than its evidence supports, never more.
  const rank = { 'no-breach-found': 0, contested: 1, unratified: 2, broken: 3 };
  if (claimed && claimed !== 'unresearched' && rank[claimed] > rank[supported]) {
    problems.push(`status "${claimed}" is not supported by the breaches; shown as "${supported}"`);
  } else if (claimed && claimed !== 'unresearched') supported = claimed;
  if (!f.researchedAt) problems.push('missing researchedAt');
  // The plain-language summary on the Broken Treaties view (PROTOCOLS rule 15): three short
  // lines, written only from this file's own audited fields.
  if (f.plain !== undefined) {
    const p = f.plain;
    if (!p || typeof p !== 'object') problems.push('plain: must be an object');
    else for (const k of PLAIN_KEYS) {
      if (typeof p[k] !== 'string' || !p[k].trim()) { problems.push(`plain.${k}: missing`); continue; }
      if (words(p[k]) > 45) problems.push(`plain.${k}: longer than 45 words`);
      if (/—/.test(p[k])) problems.push(`plain.${k}: contains an em dash`);
    }
  }
  return { status: supported, problems, breaches: good };
}
