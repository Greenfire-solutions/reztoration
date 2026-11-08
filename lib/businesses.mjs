// What a Native business listing must carry to appear on the map (PROTOCOLS 12-14), in one place.
// Used by the library when it loads data/research/businesses/*.json and by the checker script.

export const CATEGORIES = {
  arts: 'Arts and crafts',
  food: 'Food and restaurants',
  agriculture: 'Farms, ranches and wild foods',
  education: 'Schools, colleges and language',
  retail: 'Shops and small business',
  tourism: 'Travel, lodging and culture',
  media: 'Books, film, music and media',
  health: 'Health and wellness',
  finance: 'Lending and business support',
  trades: 'Building and trades',
  technology: 'Technology and professional services',
  nonprofit: 'Community organisations',
};

export const OWNERSHIP = {
  'tribal-enterprise': 'Owned by the tribe',
  'certified-member-owned': 'Owned by an enrolled member (certified)',
  'member-body-listed': 'Listed by a Native member or certifying body',
  'self-described': 'Says it is Native-owned, naming the nation',
  'native-led-nonprofit': 'Native-led organisation',
};

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+\.[^\s]+/.test(u);

export function checkBusiness(b) {
  const problems = [];
  if (!b || typeof b !== 'object') return { ok: false, problems: ['not an object'] };
  if (!b.id || !/^[a-z0-9-]+$/.test(b.id)) problems.push('id must be lowercase letters, digits and hyphens');
  if (!b.name) problems.push('missing name');
  if (!CATEGORIES[b.category]) problems.push(`unknown category "${b.category}"`);
  if (!OWNERSHIP[b.ownership]) problems.push(`unknown ownership "${b.ownership}"`);
  if (!isUrl(b.ownershipSource?.url)) problems.push('no ownershipSource url: who says it is Native-owned?');
  if (b.ownership === 'self-described' && !b.nation) problems.push('self-described ownership must name the nation');
  if (!b.state) problems.push('missing state');
  if (!b.city && !b.lonlat) problems.push('missing city');
  if (b.address && b.homeBased) problems.push('a home-based business must not carry a street address');
  if (!isUrl(b.website) && !isUrl(b.shopOnline) && !isUrl(b.ownershipSource?.url)) problems.push('no link a visitor can follow');
  for (const k of ['website', 'shopOnline']) if (k in b && b[k] != null && !isUrl(b[k])) problems.push(`${k} is not a link: "${b[k]}"`);
  if ((b.sources || []).some((s) => !isUrl(s?.url))) problems.push('a source has no real url');
  if (!b.checkedAt) problems.push('missing checkedAt');
  if (b.closed) problems.push('closed businesses come off the map');
  if (/—/.test(`${b.description || ''} ${b.name}`)) problems.push('contains an em dash');
  if (b.lonlat && !(Array.isArray(b.lonlat) && b.lonlat.length === 2 && b.lonlat.every(Number.isFinite))) problems.push('lonlat must be [lon, lat]');
  return { ok: problems.length === 0, problems };
}
