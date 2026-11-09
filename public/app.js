import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const getJSON = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));

// ---------- scene ----------
const canvas = $('#map');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d0b0a');
scene.fog = new THREE.Fog('#0d0b0a', 900, 2200);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 5000);
camera.position.set(0, 760, 560);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 30);
controls.enableDamping = true;
controls.maxPolarAngle = 1.3;
controls.minDistance = 30;
controls.maxDistance = 1800;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight('#fff1dc', '#2a1d14', 1.4));
const sun = new THREE.DirectionalLight('#ffd9a8', 1.6);
sun.position.set(-300, 600, 200);
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Map units are [x, z] with z pointing south. A Shape lives in XY, so we store (x, -z)
// and lay the mesh flat with rotation.x = -PI/2.
function shapesOf(polys) {
  const shapes = [];
  for (const [outer, ...holes] of polys) {
    const s = new THREE.Shape();
    for (let i = 0; i < outer.length; i += 2) (i ? s.lineTo : s.moveTo).call(s, outer[i], -outer[i + 1]);
    for (const h of holes) {
      const p = new THREE.Path();
      for (let i = 0; i < h.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, h[i], -h[i + 1]);
      s.holes.push(p);
    }
    shapes.push(s);
  }
  return shapes;
}
function outlinePositions(polys, y, out) {
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      out.push(ring[i], y, ring[i + 1], ring[j], y, ring[j + 1]);
    }
  }
  return out;
}
const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };

const state = { territories: [], lands: [], meshes: [], tById: new Map(), lById: new Map(), hover: null, selected: null };
const groups = { territories: new THREE.Group(), lands: new THREE.Group(), states: new THREE.Group(), focus: new THREE.Group() };
Object.values(groups).forEach((g) => scene.add(g));

async function load() {
  const [states, territories, lands] = await Promise.all([
    getJSON('/data/states.json'), getJSON('/data/territories.json'), getJSON('/data/reservations.json'),
  ]);

  // Land base: the continent as a dark slab.
  const baseGeo = mergeGeometries(states.map((s) => flat(new THREE.ExtrudeGeometry(shapesOf(s.polys), { depth: 3, bevelEnabled: false }))), false);
  const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: '#2a211a', roughness: 0.95 }));
  base.position.y = -3;
  scene.add(base);
  const stateLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(states.reduce((a, s) => outlinePositions(s.polys, 0.04, a), []), 3)),
    new THREE.LineBasicMaterial({ color: '#f2e8d8', transparent: true, opacity: 0.18 }),
  );
  groups.states.add(stateLines);
  groups.states.visible = false;
  // A faint coastline that always shows, so the continent reads at a glance.
  const coast = new THREE.LineSegments(stateLines.geometry, new THREE.LineBasicMaterial({ color: '#8a7760', transparent: true, opacity: 0.25 }));
  scene.add(coast);

  // Traditional territories: one translucent sheet each, bigger ones lower.
  const outline = [], outlineColor = [];
  territories.forEach((t, i) => {
    const y = 0.15 + i * 0.006;
    const geo = flat(new THREE.ShapeGeometry(shapesOf(t.polys)));
    const mat = new THREE.MeshBasicMaterial({ color: t.color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.renderOrder = i;
    m.userData = { kind: 'territory', id: t.id };
    groups.territories.add(m);
    state.meshes.push(m);
    const c = new THREE.Color(t.color);
    const before = outline.length;
    outlinePositions(t.polys, y + 0.01, outline);
    for (let k = before; k < outline.length; k += 3) outlineColor.push(c.r, c.g, c.b);
    state.tById.set(t.id, { ...t, mesh: m, y });
  });
  const tLines = new THREE.LineSegments(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(outline, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(outlineColor, 3)),
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
  );
  groups.territories.add(tLines);

  // Tribal lands today: raised gold, merged into one mesh. Face ranges map back to ids.
  const geos = [], ranges = [];
  let tri = 0;
  for (const l of lands) {
    const g = flat(new THREE.ExtrudeGeometry(shapesOf(l.polys), { depth: 4.5, bevelEnabled: false }));
    geos.push(g);
    const n = g.attributes.position.count / 3;
    ranges.push([tri, tri + n, l.id]);
    tri += n;
    state.lById.set(l.id, l);
  }
  const landMesh = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ color: '#d9a34a', roughness: 0.55, metalness: 0.15, emissive: '#3a2306', emissiveIntensity: 0.6 }));
  landMesh.userData = { kind: 'land', ranges };
  groups.lands.add(landMesh);
  state.landMesh = landMesh;

  state.territories = territories;
  state.lands = lands;
  makeLabels(territories);
  getJSON('/api/stats').then(showStats).catch(() => {});
  let saved = 'then';
  try { saved = localStorage.getItem('rez-mode') || 'then'; } catch {}
  setMode(saved === 'today' ? 'today' : 'then');
  loadTreaties().catch(() => {});
  routeFromHash();
}

function showStats(s) {
  const parts = [`${s.territories} territories`, `${s.lands} tribal lands`];
  if (s.nations) parts.push(`${s.nations} nations`);
  if (s.items) parts.push(`${s.items.toLocaleString()} stories, photos and recordings`);
  if (s.plantUses) parts.push(`${s.plantUses.toLocaleString()} plant uses`);
  $('#stats').textContent = parts.join(' · ');
}

// ---------- labels ----------
const labelLayer = document.createElement('div');
labelLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;font:500 12px Inter,sans-serif;';
document.body.appendChild(labelLayer);
let labels = [];
function makeLabels(territories) {
  labels = [...territories].sort((a, b) => b.area - a.area).slice(0, 160).map((t) => {
    const el = document.createElement('div');
    el.textContent = t.name.replace(/\s+/g, ' ');
    el.style.cssText = 'position:absolute;white-space:nowrap;color:#f2e8d8;text-shadow:0 1px 3px #000,0 0 8px #000;transform:translate(-50%,-50%);opacity:0;transition:opacity .25s;max-width:220px;overflow:hidden;text-overflow:ellipsis;';
    labelLayer.appendChild(el);
    return { el, t, v: new THREE.Vector3(t.center[0], 2, t.center[1]) };
  });
}
function placeLabels() {
  const placed = [];
  const dist = camera.position.distanceTo(controls.target);
  for (const L of labels) {
    const show = L.kind === 'n' ? groups.today.visible : groups.territories.visible;
    const p = L.v.clone().project(camera);
    const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
    const w = Math.min(220, L.el.textContent.length * 6.6), h = 16;
    // Territory size on screen decides whether it earns a label.
    const screenSize = Math.sqrt(L.t.area) * 900 / dist;
    let ok = show && p.z < 1 && x > 0 && x < innerWidth && y > 60 && y < innerHeight - 50 && screenSize > 9;
    if (ok) for (const q of placed) if (Math.abs(q.x - x) < (q.w + w) / 2 + 6 && Math.abs(q.y - y) < h + 4) { ok = false; break; }
    if (ok) placed.push({ x, y, w });
    L.el.style.opacity = ok ? '0.85' : '0';
    if (ok) L.el.style.left = `${x}px`, L.el.style.top = `${y}px`;
  }
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
function pick(ev) {
  mouse.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  ray.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.012;
  if (groups.today.visible) {
    const pts = [tod.biz, tod.nations].filter(Boolean);
    const p = ray.intersectObjects(pts, false).sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
    if (p) { const rec = p.object.userData.list[p.index]; return { kind: p.object.userData.kind, id: rec.id, rec }; }
  }
  const targets = [];
  if (groups.treaties.visible && tre.mesh) targets.push(tre.mesh);
  if (groups.lands.visible && state.landMesh) targets.push(state.landMesh);
  if (groups.territories.visible) targets.push(...state.meshes);
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return null;
  if (hit.object.userData.kind === 'cession') {
    const r = tre.ranges.find((x) => hit.faceIndex >= x.f0 && hit.faceIndex < x.f1);
    return r ? { kind: 'cession', id: r.id } : null;
  }
  if (hit.object.userData.kind === 'land') {
    const r = hit.object.userData.ranges.find(([a, b]) => hit.faceIndex >= a && hit.faceIndex < b);
    return r ? { kind: 'land', id: r[2] } : null;
  }
  return { kind: 'territory', id: hit.object.userData.id };
}
function setHover(h) {
  const prev = state.hover;
  if (prev?.kind === 'territory' && prev.id !== state.selected?.id) state.tById.get(prev.id).mesh.material.opacity = 0.28;
  state.hover = h;
  if (h?.kind === 'territory') state.tById.get(h.id).mesh.material.opacity = 0.62;
  canvas.style.cursor = h ? 'pointer' : '';
}
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointermove', (e) => {
  const h = pick(e);
  if (h?.id !== state.hover?.id) setHover(h);
  const tip = $('#tip');
  if (!h) { tip.hidden = true; return; }
  if (h.kind === 'cession') {
    const st = tre.summary.cessionStatus[h.id] || 'unresearched';
    const ts = tre.list.filter((t) => t.cessions.includes(h.id));
    tip.innerHTML = `${esc(ts[0]?.name || `Royce cession ${h.id}`)}${ts.length > 1 ? ` and ${ts.length - 1} more` : ''}<small>${dot(st)}${esc(tre.summary.statuses[st].label)}</small>`;
  } else if (h.kind === 'nation' || h.kind === 'business') {
    tip.innerHTML = `${esc(h.rec.name)}<small>${h.kind === 'nation' ? 'Nation today' : `${esc(tod.data.categories[h.rec.category]?.label || '')} · ${esc(h.rec.city || '')}, ${esc(h.rec.state || '')}`}</small>`;
  } else {
    const rec = h.kind === 'land' ? state.lById.get(h.id) : state.tById.get(h.id);
    tip.innerHTML = `${esc(rec.name)}<small>${h.kind === 'land' ? esc(rec.kind) : 'Traditional territory'}</small>`;
  }
  tip.style.left = `${e.clientX}px`;
  tip.style.top = `${e.clientY}px`;
  tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => { $('#tip').hidden = true; setHover(null); });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const h = pick(e);
  if (h) location.hash = `${h.kind}/${encodeURIComponent(h.id)}`;
});

// ---------- camera flight ----------
let flight = null;
function flyTo(center, size) {
  const target = new THREE.Vector3(center[0], 0, center[1]);
  const d = THREE.MathUtils.clamp(size * 2.2, 60, 1400);
  const pos = target.clone().add(new THREE.Vector3(0, d * 0.82, d * 0.6));
  flight = { t: 0, fromP: camera.position.clone(), toP: pos, fromT: controls.target.clone(), toT: target };
}
function boundsSize(polys) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polys) for (let i = 0; i < p[0].length; i += 2) {
    minX = Math.min(minX, p[0][i]); maxX = Math.max(maxX, p[0][i]);
    minZ = Math.min(minZ, p[0][i + 1]); maxZ = Math.max(maxZ, p[0][i + 1]);
  }
  return { size: Math.max(maxX - minX, maxZ - minZ), mid: [(minX + maxX) / 2, (minZ + maxZ) / 2] };
}

// ---------- focus: the selected territory rises ----------
function focusTerritory(t) {
  groups.focus.clear();
  const geo = flat(new THREE.ExtrudeGeometry(shapesOf(t.polys), { depth: 7, bevelEnabled: false }));
  const c = new THREE.Color(t.color);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, roughness: 0.6 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: c.clone().offsetHSL(0, 0, 0.25) }));
  const g = new THREE.Group();
  g.add(m, edges);
  g.scale.y = 0.01;
  g.userData.rise = 0;
  groups.focus.add(g);
}

// ---------- panel ----------
const panel = $('#panel'), body = $('#panel-body');
$('#close').onclick = () => { location.hash = ''; };
addEventListener('hashchange', routeFromHash);
function routeFromHash() {
  const [kind, id] = location.hash.slice(1).split('/');
  if (state.selected && state.selected.kind === 'territory' && state.selected.id !== decodeURIComponent(id || '')) {
    const t = state.tById.get(state.selected.id);
    if (t) t.mesh.material.opacity = 0.28;
  }
  if (kind === 'library') { brokenEl.hidden = true; openLibrary(id); return; }
  libEl.hidden = true;
  if (kind === 'broken') { openBroken(); return; }
  brokenEl.hidden = true;
  if (kind === 'treaties') return openTreatyList();
  if (kind === 'businesses') return openBusinessList();
  if (!kind || !id) { panel.hidden = true; state.selected = null; groups.focus.clear(); return; }
  const key = decodeURIComponent(id);
  if (kind === 'territory') openTerritory(key);
  else if (kind === 'land') openLand(key);
  else if (kind === 'treaty') openTreaty(key);
  else if (kind === 'cession') openCession(key);
  else if (kind === 'nation') openNation(key);
  else if (kind === 'business') openBusiness(key);
}

async function openTerritory(id) {
  const t = state.tById.get(id);
  if (!t) return;
  state.selected = { kind: 'territory', id };
  t.mesh.material.opacity = 0.62;
  focusTerritory(t);
  const b = boundsSize(t.polys);
  flyTo(b.mid, b.size);
  panel.hidden = false;
  body.innerHTML = `<h2>${esc(t.name)}</h2><p class="sub">Gathering what is known…</p>`;
  let d;
  try { d = await getJSON(`/api/territory/${encodeURIComponent(id)}`); } catch { body.innerHTML += '<p class="empty">Could not load this nation.</p>'; return; }
  if (state.selected?.id !== id) return;
  renderTerritory(d);
}

// ---------- nation page ----------
const USE_LABEL = { Drug: 'Medicine', Food: 'Food', Fiber: 'Fiber and tools', Dye: 'Dye', Other: 'Other' };
const GROUP_NOTE = {
  art: 'Works held by museums. Each piece stays with the museum; follow the link for the full record and rights.',
  films: 'Films and video, many made by outsiders. Where a nation has asked for something not to be shown, it is not here.',
  photos: 'Many of these photographs were made by outsiders, often staged. The people in them were real; look closely, and with respect.',
  recordings: 'Songs, stories and interviews. Some nations tell certain stories only in winter or only within the community; honour that before sharing.',
  writings: 'Books, journals, documents, treaties and newspapers, from open archives and open access journals.',
};
const link = (u, label) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : '');
let cur = null; // the open territory's data
let pendingItem = null; // a search result to show once its territory opens

function renderTerritory(d) {
  cur = d;
  const g = d.groups;
  const tabs = [
    ['overview', 'Overview', null],
    ['art', 'Art', g.art.count],
    ['films', 'Films', g.films.count],
    ['photos', 'Photos', g.photos.count],
    ['recordings', 'Recordings', g.recordings.count],
    ['writings', 'Writings', g.writings.count],
    ['plants', 'Medicine and plants', d.plantCount],
    ['lands', 'Lands today', d.lands.length],
    ['treaties', 'Treaties', null],
    ['sources', 'Sources', null],
  ];
  const hero = safeUrl(d.profile?.image) || safeUrl(d.featured.find((i) => i.image)?.image) || safeUrl(d.featured[0]?.thumb);
  const names = [...new Set(d.nations.map((n) => n.name))];
  body.innerHTML = `
    <div class="hero" ${hero ? `style="background-image:linear-gradient(180deg,rgba(13,11,10,.1),rgba(13,11,10,.95)),url('${esc(hero)}')"` : ''}>
      <h2>${esc(d.name)}</h2>
      <p class="sub"><span class="swatch" style="background:${esc(d.color)}"></span>Traditional territory${names.length ? ` · ${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? ` <button class="linkish" data-go="overview">and ${names.length - 3} more nations today</button>` : ''}` : ''}</p>
    </div>
    <div class="tabs main">${tabs.map(([k, label, n], i) => `<button data-tab="${k}" class="${i ? '' : 'on'}" ${n === 0 ? 'data-zero' : ''}>${label}${n ? `<b>${n.toLocaleString()}</b>` : ''}</button>`).join('')}</div>
    <div id="tab"></div>`;
  body.querySelectorAll('.tabs.main button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  body.querySelector('.hero .linkish')?.addEventListener('click', () => { showTab('overview'); body.querySelector('.card.own')?.scrollIntoView({ behavior: 'smooth' }); });
  showTab('overview');
  if (pendingItem) { const it = pendingItem; pendingItem = null; openViewer([it], 0); }
}

function showTab(k) {
  body.querySelectorAll('.tabs.main button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
  const tab = $('#tab');
  if (k in cur.groups) return renderGroup(tab, k);
  if (k === 'plants') return renderPlants(tab);
  if (k === 'treaties') return renderTreatyTab(tab);
  tab.innerHTML = TABS[k](cur);
  tab.querySelectorAll('[data-land]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = `land/${encodeURIComponent(a.dataset.land)}`; }));
  tab.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.go)));
  bindViewer(tab, cur.featured);
}

const TABS = {
  overview(d) {
    let h = '';
    if (d.featured.length) h += `<div class="strip">${d.featured.map((it, i) => `<button class="shot" data-view="${i}" title="${esc(it.title)}"><img loading="lazy" src="${esc(safeUrl(it.thumb) || safeUrl(it.image) || '')}" alt="${esc(it.title)}"></button>`).join('')}</div>`;
    for (const n of d.nations) {
      const o = n.official || {};
      const own = [link(o.website, 'Official website'), link(o.culture, 'Culture department'), link(o.museum, 'Museum'), link(o.language, 'Language program'), link(o.thpo, 'Historic preservation office'), link(o.radio, 'Radio')].filter(Boolean);
      h += `<div class="card own">
        <div class="nname">${esc(n.name)}${n.endonym ? ` <span class="k">(${esc(n.endonym)})</span>` : ''}</div>
        ${n.recognition ? `<div class="k">${esc(n.recognition)} recognition${n.states?.length ? ` · ${esc(n.states.join(', '))}` : ''}</div>` : ''}
        ${own.length ? `<h3>In their own words</h3><div class="links">${own.join('')}</div>` : ''}
        ${n.languages?.length ? `<h3>Language</h3>${n.languages.map((l) => `<div>${esc(l.name)}${l.status ? ` <span class="tag">${esc(l.status)}</span>` : ''} ${link(l.elpUrl, 'Endangered Languages Project')} ${link(l.glottologUrl, 'Glottolog')} ${(l.resources || []).slice(0, 3).map((u, i) => link(u, `resource ${i + 1}`)).join(' ')}</div>`).join('')}` : ''}
      </div>`;
    }
    if (d.profile) h += `<h3>About</h3><p class="about">${esc(d.profile.extract)}</p><p class="note">From ${link(d.profile.url, `Wikipedia: ${d.profile.title}`)}, an outside source (CC BY-SA). Where the nation's own words exist, they come first.</p>`;
    else if (!d.nations.length) h += `<p class="empty">No outside introduction found yet for this people. The outline is here; their voice is still to come.</p>`;
    const tiles = [['art', 'Art'], ['films', 'Films'], ['photos', 'Photos'], ['recordings', 'Recordings'], ['writings', 'Writings']]
      .map(([k, l]) => `<button class="tile" data-go="${k}" ${d.groups[k].count ? '' : 'disabled'}><b>${d.groups[k].count.toLocaleString()}</b>${l}</button>`).join('')
      + `<button class="tile" data-go="plants" ${d.plantCount ? '' : 'disabled'}><b>${d.plantCount.toLocaleString()}</b>Plants</button>`
      + `<button class="tile" data-go="lands" ${d.lands.length ? '' : 'disabled'}><b>${d.lands.length}</b>Lands today</button>`;
    h += `<h3>Explore</h3><div class="tiles">${tiles}</div>
      <p class="note" style="margin-top:14px">Territory outline from Native Land Digital, approximate and meant to start a conversation, not settle one. ${link(d.url, 'See it on Native Land')}</p>`;
    return h;
  },
  lands(d) {
    if (!d.lands.length) return '<p class="empty">No present-day tribal land recorded inside this territory.</p>';
    return d.lands.map((l) => `<div class="card"><a href="#" data-land="${esc(l.id)}">${esc(l.name)}</a><div class="k">${esc(l.kind)}</div></div>`).join('');
  },
  sources(d) {
    return `<div class="card"><b>Territory outline</b><div class="k">Native Land Digital, native-land.ca. Approximate; used as a starting point.</div></div>
      <div class="card"><b>Tribal lands today</b><div class="k">US Census Bureau, Census 2020 American Indian, Alaska Native and Native Hawaiian Areas. Public domain.</div></div>
      <div class="card"><b>Collections</b><div class="k">Internet Archive, Library of Congress, Art Institute of Chicago, Cleveland Museum of Art, Directory of Open Access Journals, university and state digital archives. Everything is linked, not copied; rights are shown as each holder states them.</div></div>
      <div class="card"><b>Plants</b><div class="k">BRIT Native American Ethnobotany Database (Daniel Moerman), each use with its published citation.</div></div>
      ${d.profile ? `<div class="card"><b>Introduction</b><div class="k">${link(d.profile.url, 'Wikipedia')}, CC BY-SA 4.0.</div></div>` : ''}
      ${d.nations.flatMap((n) => n.sources || []).slice(0, 12).map((u) => `<div>${link(u, u)}</div>`).join('')}
      <p class="note">Sacred, ceremonial and community-only material is left out on purpose, even where an archive made it public. Matched on: ${esc(d.keys.join(', '))}</p>`;
  },
};

// A group tab: filter box, gallery or list, show more.
async function renderGroup(tab, group) {
  const g = cur.groups[group];
  const visual = group === 'art' || group === 'photos' || group === 'films';
  tab.innerHTML = `<p class="note">${GROUP_NOTE[group]}</p>
    <input class="filter" type="search" placeholder="Filter ${esc(g.label.toLowerCase())} by words in the title" autocomplete="off">
    <div class="${visual ? 'gallery' : 'items'}"></div><div class="more"></div>`;
  const box = tab.querySelector(visual ? '.gallery' : '.items'), more = tab.querySelector('.more'), filter = tab.querySelector('.filter');
  if (!g.count) { box.outerHTML = `<p class="empty">Nothing open-access found here yet for ${esc(cur.name)}.</p>`; filter.remove(); return; }
  const id = cur.id;
  let list = [], total = 0, q = '';
  const card = (it, i) => {
    const th = safeUrl(it.thumb) || safeUrl(it.image);
    const meta = [it.date, it.creator, it.journal, it.institution].filter(Boolean).map(esc).join(' · ');
    if (visual) return `<button class="g" data-view="${i}" title="${esc(it.title)}">${th ? `<img loading="lazy" src="${esc(th)}" alt="">` : `<div class="ph">${esc(it.kind)}</div>`}${it.media ? '<span class="play">▶</span>' : ''}<span class="cap">${esc(it.title)}</span></button>`;
    return `<button class="item" data-view="${i}">${th ? `<img loading="lazy" src="${esc(th)}" alt="">` : `<div class="ph">${esc(it.kind)}</div>`}<div>
      <div class="t">${esc(it.title)}${it.media ? ' <span class="tag">plays here</span>' : ''}</div><div class="m">${meta}</div>${it.summary ? `<div class="m clip">${esc(it.summary)}</div>` : ''}</div></button>`;
  };
  async function load(reset) {
    if (reset) { list = []; box.innerHTML = ''; }
    const r = await getJSON(`/api/territory/${encodeURIComponent(id)}/items?group=${group}&offset=${list.length}&limit=48&q=${encodeURIComponent(q)}`);
    if (cur?.id !== id) return;
    const start = list.length;
    list.push(...r.items);
    total = r.total;
    box.insertAdjacentHTML('beforeend', r.items.map((it, i) => card(it, start + i)).join(''));
    more.innerHTML = list.length < total ? `<button class="morebtn">Show more (${(total - list.length).toLocaleString()} left)</button>` : `<p class="note">${total.toLocaleString()} shown.</p>`;
    more.querySelector('button')?.addEventListener('click', () => load(false));
    if (!total) box.innerHTML = '<p class="empty">Nothing matches those words.</p>';
  }
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) openViewer(list, Number(b.dataset.view)); });
  let t;
  filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = filter.value.trim(); load(true); }, 200); });
  load(true);
}

async function renderPlants(tab) {
  const d = cur;
  if (!d.plantCount) { tab.innerHTML = '<p class="empty">No recorded plant uses linked to this nation yet.</p>'; return; }
  const chips = [['', 'All', d.plantUseCount], ...Object.entries(d.useCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, USE_LABEL[k] || k, n])];
  tab.innerHTML = `<p class="note warn">A historical cultural record from the published ethnographic literature, with its citation. It is not medical advice. Many plants here are toxic. Ceremonial uses are left out on purpose.</p>
    <div class="tabs uses">${chips.map(([k, l, n], i) => `<button data-use="${esc(k)}" class="${i ? '' : 'on'}">${esc(l)}<b>${n.toLocaleString()}</b></button>`).join('')}</div>
    <input class="filter" type="search" placeholder="Find a plant or a use (yarrow, fever, basket)" autocomplete="off">
    <div class="plants"></div><div class="more"></div>`;
  const box = tab.querySelector('.plants'), more = tab.querySelector('.more'), filter = tab.querySelector('.filter');
  let use = '', q = '', shown = 0;
  async function load(reset) {
    if (reset) { shown = 0; box.innerHTML = ''; }
    const r = await getJSON(`/api/territory/${encodeURIComponent(d.id)}/plants?use=${encodeURIComponent(use)}&q=${encodeURIComponent(q)}&offset=${shown}&limit=40`);
    if (cur?.id !== d.id) return;
    shown += r.plants.length;
    box.insertAdjacentHTML('beforeend', r.plants.map((p) => `
      <details class="plant"><summary><b>${esc(p.commonName || p.plant)}</b> <i>${esc(p.plant)}</i><span class="n">${p.uses.length}</span><br>${[...new Set(p.uses.map((u) => u.use))].map((u) => `<span class="tag ${esc(u)}">${esc(USE_LABEL[u] || u)}</span>`).join('')}</summary>
      <ul>${p.uses.map((u) => `<li><b>${esc(u.subUse || USE_LABEL[u.use] || u.use)}</b>${u.note ? `: ${esc(u.note)}` : ''} <span class="k">${esc(u.nation)}</span>${u.citation ? `<div class="cite">${esc(u.citation)} ${link(u.url, 'record')}</div>` : ''}</li>`).join('')}</ul>
      ${p.info ? `<div class="k">${link(p.info.url, 'All uses of this plant')} ${link(p.info.usdaUrl, 'USDA plant profile')}</div>` : ''}
      </details>`).join('') || '<p class="empty">No plants match.</p>');
    more.innerHTML = shown < r.total ? `<button class="morebtn">Show more plants (${(r.total - shown).toLocaleString()} left)</button>` : '';
    more.querySelector('button')?.addEventListener('click', () => load(false));
  }
  tab.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
    tab.querySelectorAll('[data-use]').forEach((x) => x.classList.toggle('on', x === b));
    use = b.dataset.use; load(true);
  }));
  let t;
  filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = filter.value.trim(); load(true); }, 200); });
  load(true);
}

// ---------- viewer: pictures large, films and recordings play in place ----------
const viewer = $('#viewer');
let vList = [], vAt = 0;
function bindViewer(scope, list) {
  scope.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openViewer(list, Number(b.dataset.view))));
}
function mediaFor(it) {
  const m = safeUrl(it.media);
  if (m && /^https:\/\/archive\.org\/embed\//.test(m)) return `<iframe src="${esc(m)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  if (m && /\.(mp4|webm|m3u8)(\?|$)/i.test(m)) return `<video src="${esc(m)}" controls preload="metadata" ${safeUrl(it.thumb) ? `poster="${esc(it.thumb)}"` : ''}></video>`;
  if (m && /\.(mp3|ogg|wav|m4a)(\?|$)/i.test(m)) return `${safeUrl(it.thumb) ? `<img src="${esc(it.thumb)}" alt="">` : ''}<audio src="${esc(m)}" controls preload="none"></audio>`;
  const img = safeUrl(it.image) || safeUrl(it.thumb);
  return img ? `<img src="${esc(img)}" alt="${esc(it.title)}">` : `<div class="ph big">${esc(it.kind)}</div>`;
}
function openViewer(list, i) {
  vList = list; vAt = i;
  drawViewer();
  if (!viewer.open) viewer.showModal();
}
function drawViewer() {
  const it = vList[vAt];
  if (!it) return;
  viewer.querySelector('.stage').innerHTML = mediaFor(it);
  viewer.querySelector('.info').innerHTML = `<div class="count">${vAt + 1} of ${vList.length}</div>
    <h2>${esc(it.title)}</h2>
    <div class="k">${[it.kind, it.date, it.creator, it.medium, it.journal, it.institution].filter(Boolean).map(esc).join(' · ')}</div>
    ${it.summary ? `<p>${esc(it.summary)}</p>` : ''}
    <div class="rights">${esc(it.rights || 'Rights unknown')}${(it.tkLabels || []).map((l) => ` <span class="tag">${esc(l)}</span>`).join('')}</div>
    <div class="links">${link(it.url, 'Open at the source')}${it.where ? ` <a href="#territory/${encodeURIComponent(it.where.id)}" class="home">Go to the homeland: ${esc(it.where.name)}</a>` : ''}</div>`;
  viewer.querySelector('.home')?.addEventListener('click', () => viewer.close());
}
viewer.querySelector('.prev').onclick = () => { if (vAt > 0) { vAt--; drawViewer(); } };
viewer.querySelector('.next').onclick = () => { if (vAt < vList.length - 1) { vAt++; drawViewer(); } };
viewer.querySelector('.x').onclick = () => viewer.close();
viewer.addEventListener('close', () => { viewer.querySelector('.stage').innerHTML = ''; });
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
addEventListener('keydown', (e) => {
  if (!viewer.open) return;
  if (e.key === 'ArrowLeft') viewer.querySelector('.prev').click();
  if (e.key === 'ArrowRight') viewer.querySelector('.next').click();
});

async function openLand(id) {
  const l = state.lById.get(id);
  if (!l) return;
  state.selected = { kind: 'land', id };
  groups.focus.clear();
  const b = boundsSize(l.polys);
  flyTo(b.mid, Math.max(b.size, 30));
  panel.hidden = false;
  const d = await getJSON(`/api/land/${encodeURIComponent(id)}`);
  body.innerHTML = `<h2>${esc(d.name)}</h2><p class="sub">${esc(d.kind)} · Census 2020</p>
    <h3>Within the homelands of</h3>
    ${d.territories.length ? d.territories.map((t) => `<div class="card"><a href="#territory/${encodeURIComponent(t.id)}">${esc(t.name)}</a></div>`).join('') : '<p class="empty">No traditional territory outline covers this spot on the map.</p>'}
    <p class="note">Present-day tribal lands are a small part of the homelands shown around them.</p>`;
}


// ---------- library: everything, every nation ----------
const libEl = $('#library');
const LIB_TABS = [['art', 'Art'], ['films', 'Films'], ['photos', 'Photos'], ['recordings', 'Recordings'], ['writings', 'Writings'], ['plants', 'Medicine and plants']];
let libGroup = 'art', libQ = '', libList = [], libTimer;
function openLibrary(group) {
  libGroup = LIB_TABS.some(([k]) => k === group) ? group : 'art';
  libEl.hidden = false;
  panel.hidden = true;
  libEl.querySelector('.tabs.lib').innerHTML = LIB_TABS.map(([k, l]) => `<a href="#library/${k}" class="${k === libGroup ? 'on' : ''}">${l}</a>`).join('');
  libLoad(true);
}
async function libLoad(reset) {
  const body2 = libEl.querySelector('.libbody'), more = libEl.querySelector('.more');
  if (reset) { libList = []; body2.innerHTML = ''; body2.className = `libbody ${libGroup === 'plants' ? 'plants' : libGroup === 'writings' || libGroup === 'recordings' ? 'items' : 'gallery'}`; }
  const g = libGroup, q = libQ;
  const r = await getJSON(`/api/browse?group=${g}&q=${encodeURIComponent(q)}&offset=${libList.length}&limit=60`);
  if (g !== libGroup || q !== libQ) return;
  if (g === 'plants') {
    libList.push(...r.plants);
    body2.insertAdjacentHTML('beforeend', r.plants.map((p) => `<details class="plant"><summary><b>${esc(p.commonName || p.plant)}</b> <i>${esc(p.plant)}</i><span class="n">${p.uses.length} uses</span><br>${[...new Set(p.uses.map((u) => u.nation))].slice(0, 8).map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</summary>
      <ul>${p.uses.slice(0, 60).map((u) => `<li><b>${esc(u.nation)}</b>, ${esc(u.subUse || USE_LABEL[u.use] || u.use)}${u.note ? `: ${esc(u.note)}` : ''}${u.citation ? `<div class="cite">${esc(u.citation)} ${link(u.url, 'record')}</div>` : ''}</li>`).join('')}</ul></details>`).join(''));
    more.innerHTML = libList.length < r.total ? `<button class="morebtn">Show more plants (${(r.total - libList.length).toLocaleString()} left)</button>` : '';
  } else {
    const start = libList.length;
    libList.push(...r.items);
    const visual = body2.classList.contains('gallery');
    body2.insertAdjacentHTML('beforeend', r.items.map((it, j) => {
      const i = start + j, th = safeUrl(it.thumb) || safeUrl(it.image), where = it.where ? esc(it.where.name) : '';
      return visual
        ? `<button class="g" data-view="${i}" title="${esc(it.title)}">${th ? `<img loading="lazy" src="${esc(th)}" alt="">` : `<div class="ph">${esc(it.kind)}</div>`}${it.media ? '<span class="play">▶</span>' : ''}<span class="cap">${esc(it.title)}<br><i>${where}</i></span></button>`
        : `<button class="item" data-view="${i}">${th ? `<img loading="lazy" src="${esc(th)}" alt="">` : `<div class="ph">${esc(it.kind)}</div>`}<div><div class="t">${esc(it.title)}${it.media ? ' <span class="tag">plays here</span>' : ''}</div><div class="m">${[where, it.date, it.creator, it.journal].filter(Boolean).map((x) => (x === where ? x : esc(x))).join(' · ')}</div></div></button>`;
    }).join(''));
    more.innerHTML = libList.length < r.total ? `<button class="morebtn">Show more (${(r.total - libList.length).toLocaleString()} left)</button>` : `<p class="note">${r.total.toLocaleString()} in all.</p>`;
  }
  if (!r.total) body2.innerHTML = '<p class="empty">Nothing matches those words yet.</p>';
  more.querySelector('button')?.addEventListener('click', () => libLoad(false));
}
libEl.querySelector('.libbody').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) openViewer(libList, Number(b.dataset.view)); });
libEl.querySelector('.filter').addEventListener('input', (e) => { clearTimeout(libTimer); libTimer = setTimeout(() => { libQ = e.target.value.trim(); libLoad(true); }, 220); });

// ---------- search ----------
const q = $('#q'), results = $('#results');
let searchTimer, lastResults = [];
q.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const v = q.value.trim();
    if (v.length < 2) { results.hidden = true; return; }
    const r = await getJSON(`/api/search?q=${encodeURIComponent(v)}`);
    lastResults = r;
    results.innerHTML = r.length ? r.map((x) => x.type === 'item'
      ? `<li data-h="territory/${encodeURIComponent(x.id)}" data-i="${r.indexOf(x)}">${esc(x.name)}<small>${esc(x.kind)} · ${esc(x.where || '')}</small></li>`
      : `<li data-h="${x.type}/${encodeURIComponent(x.id)}">${esc(x.name)}<small>${x.type === 'land' ? esc(x.kind) : 'territory'}</small></li>`).join('') : '<li class="empty">Nothing by that name yet</li>';
    results.hidden = false;
  }, 120);
});
results.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-h]');
  if (!li) return;
  const hit = lastResults[Number(li.dataset.i)];
  if (hit?.type === 'item') {
    if (location.hash === `#${li.dataset.h}` && cur) { openViewer([hit.item], 0); results.hidden = true; return; }
    pendingItem = hit.item;
  }
  location.hash = li.dataset.h;
  results.hidden = true;
  q.blur();
});
q.addEventListener('keydown', (e) => { if (e.key === 'Enter') results.querySelector('li[data-h]')?.click(); if (e.key === 'Escape') results.hidden = true; });

// ---------- layers + about ----------
$('#l-territories').onchange = (e) => { groups.territories.visible = mode === 'then' && e.target.checked; };
$('#l-lands').onchange = (e) => { groups.lands.visible = mode === 'today' || e.target.checked; };
$('#l-treaties').onchange = (e) => { groups.treaties.visible = mode === 'then' && e.target.checked; drawLegend(); };
document.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#l-states').onchange = (e) => { groups.states.visible = e.target.checked; };
$('#about-btn').onclick = () => $('#about').showModal();

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (flight) {
    flight.t = Math.min(1, flight.t + dt / 1.2);
    const k = 1 - Math.pow(1 - flight.t, 3);
    camera.position.lerpVectors(flight.fromP, flight.toP, k);
    controls.target.lerpVectors(flight.fromT, flight.toT, k);
    if (flight.t >= 1) flight = null;
  }
  for (const g of groups.focus.children) {
    g.userData.rise = Math.min(1, g.userData.rise + dt / 0.9);
    g.scale.y = 0.01 + (1 - Math.pow(1 - g.userData.rise, 3)) * 0.99;
  }
  controls.update();
  placeLabels();
  renderer.render(scene, camera);
});


// ================= Treaties (Then mode) and the present-day map (Today mode) =================
const STATUS_COLOR = { broken: '#d9462f', unratified: '#e8892e', contested: '#e6c34a', 'no-breach-found': '#8a8f8c', unresearched: '#5a4c40' };
const CAT_COLOR = { arts: '#e47fa0', food: '#eba63e', agriculture: '#86c45e', education: '#62ade6', retail: '#d4ad74', tourism: '#5fc2b4', media: '#b893e6', health: '#e8705f', finance: '#dccb5c', trades: '#a8937d', technology: '#72d4ec', nonprofit: '#f2e8d8' };
const KIND_LABEL = { 'court-ruling': 'Court ruling', 'claims-commission': 'Claims commission', 'act-of-congress': 'Act of Congress', 'executive-action': 'Executive action', 'government-admission': 'Government admission', 'never-ratified': 'Never ratified', 'nation-statement': "The nation's account", historian: 'Historian', litigation: 'In litigation' };
groups.treaties = new THREE.Group(); groups.treaties.visible = false; scene.add(groups.treaties);
groups.today = new THREE.Group(); groups.today.visible = false; scene.add(groups.today);
const tre = { summary: null, cById: new Map(), mesh: null, ranges: [], list: [] };
const tod = { data: null, nations: null, biz: null, cats: new Set(Object.keys(CAT_COLOR)), bizShown: [] };
let mode = 'then';

const dotTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.65)'; g.stroke();
  return new THREE.CanvasTexture(c);
})();
const ringTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
  g.lineWidth = 9; g.strokeStyle = '#fff'; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
})();
function pointsOf(list, color, tex, size) {
  const pos = [], col = [];
  for (const p of list) {
    pos.push(p.xz[0], 6, p.xz[1]);
    const c = new THREE.Color(typeof color === 'function' ? color(p) : color);
    col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, map: tex, vertexColors: true, transparent: true, alphaTest: 0.3, depthTest: false }));
  pts.renderOrder = 9999;
  return pts;
}

async function loadTreaties() {
  const [cessions, summary] = await Promise.all([getJSON('/data/cessions.json'), getJSON('/api/treaties')]);
  tre.summary = summary;
  tre.list = summary.treaties;
  const geos = [];
  let tri = 0;
  tre.ranges = [];
  for (const c of cessions) {
    tre.cById.set(c.id, c);
    const g = flat(new THREE.ShapeGeometry(shapesOf(c.polys)));
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    geos.push(g);
    const faces = g.index ? g.index.count / 3 : n / 3;
    tre.ranges.push({ id: c.id, f0: tri, f1: tri + faces, v0: 0, n });
    tri += faces;
  }
  const merged = mergeGeometries(geos, false);
  let v = 0;
  for (const r of tre.ranges) { r.v0 = v; v += r.n; }
  tre.mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  tre.mesh.position.y = 4.8;
  tre.mesh.renderOrder = 2000;
  tre.mesh.userData = { kind: 'cession' };
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cessions.reduce((a, c) => outlinePositions(c.polys, 4.85, a), []), 3)),
    new THREE.LineBasicMaterial({ color: '#f2e8d8', transparent: true, opacity: 0.22 }),
  );
  groups.treaties.add(tre.mesh, lines);
  paintCessions();
  drawLegend();
}
function paintCessions() {
  const col = tre.mesh.geometry.attributes.color;
  for (const r of tre.ranges) {
    const c = new THREE.Color(STATUS_COLOR[tre.summary.cessionStatus[r.id] || 'unresearched']);
    for (let i = r.v0; i < r.v0 + r.n; i++) col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}
// Findings arrive while the map is open: repaint every half minute.
setInterval(async () => {
  if (!tre.mesh || document.hidden) return;
  try { tre.summary = await getJSON('/api/treaties'); tre.list = tre.summary.treaties; paintCessions(); drawLegend(); } catch {}
}, 30000);

async function loadToday() {
  tod.data = await getJSON('/api/today');
  groups.today.clear();
  tod.nations = pointsOf(tod.data.nations, '#f6ead2', ringTexture, 15);
  tod.nations.userData = { kind: 'nation', list: tod.data.nations };
  groups.today.add(tod.nations);
  drawBusinesses();
  makeNationLabels(tod.data.nations);
  drawLegend();
}
function drawBusinesses() {
  if (tod.biz) { groups.today.remove(tod.biz); tod.biz.geometry.dispose(); }
  tod.bizShown = tod.data.businesses.filter((b) => tod.cats.has(b.category));
  tod.biz = pointsOf(tod.bizShown, (b) => CAT_COLOR[b.category], dotTexture, 11);
  tod.biz.userData = { kind: 'business', list: tod.bizShown };
  groups.today.add(tod.biz);
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem('rez-mode', m); } catch {}
  document.body.dataset.mode = m;
  document.querySelectorAll('.mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  const today = m === 'today';
  groups.territories.visible = !today && $('#l-territories').checked;
  groups.treaties.visible = !today && $('#l-treaties').checked;
  groups.today.visible = today;
  groups.lands.visible = today || $('#l-lands').checked;
  if (today && !tod.data) loadToday().catch(() => {});
  drawLegend();
}

function drawLegend() {
  const el = $('#legend');
  if (mode === 'today') {
    if (!tod.data) { el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<div class="lg-title">Native businesses and nations today <a href="#businesses">See the list</a></div>
      <div class="chips">${Object.entries(tod.data.categories).map(([k, v]) => `<button data-cat="${k}" class="${tod.cats.has(k) ? 'on' : ''}"><i style="background:${CAT_COLOR[k]}"></i>${esc(v.label)} <b>${v.count}</b></button>`).join('')}</div>
      <div class="k"><i class="ring"></i> Seat of a nation's government (${tod.data.nations.length}). Gold shapes are tribal lands today.</div>`;
    el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.cat;
      if (tod.cats.size === Object.keys(CAT_COLOR).length) { tod.cats = new Set([k]); } else if (tod.cats.has(k)) tod.cats.delete(k); else tod.cats.add(k);
      if (!tod.cats.size) tod.cats = new Set(Object.keys(CAT_COLOR));
      drawBusinesses(); drawLegend();
    }));
    return;
  }
  if (!$('#l-treaties').checked || !tre.summary) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="lg-title">Land taken by treaty and act, 1784 to 1894 <a href="#treaties">All treaties</a></div>
    <div class="chips">${Object.entries(tre.summary.statuses).map(([k, v]) => `<span title="${esc(v.note)}"><i style="background:${STATUS_COLOR[k]}"></i>${esc(v.label)} <b>${v.count}</b></span>`).join('')}</div>
    <div class="k">Areas from Royce's 1899 survey, the government's own record. A treaty is marked broken only on a court, claims commission, congressional or government finding.</div>`;
}

// ---------- panels ----------
const dot = (s) => `<i class="sdot" style="background:${STATUS_COLOR[s] || STATUS_COLOR.unresearched}"></i>`;
const treatyRow = (t) => `<a class="trow" href="#treaty/${encodeURIComponent(t.id)}">${dot(t.status)}<span>${esc(t.name)}</span><small>${esc(t.date || '')}</small></a>`;

function highlightCessions(ids, status) {
  groups.focus.clear();
  const polys = ids.map((id) => tre.cById.get(String(id))).filter(Boolean).flatMap((c) => c.polys);
  if (!polys.length) return null;
  const c = new THREE.Color(STATUS_COLOR[status] || STATUS_COLOR.unresearched);
  const geo = flat(new THREE.ExtrudeGeometry(shapesOf(polys), { depth: 6, bevelEnabled: false }));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, transparent: true, opacity: 0.6 })),
    new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: c.clone().offsetHSL(0, 0, 0.25) })));
  g.position.y = 4.8; g.scale.y = 0.01; g.userData.rise = 0;
  groups.focus.add(g);
  return boundsSize(polys);
}

async function openTreaty(id) {
  state.selected = { kind: 'treaty', id };
  panel.hidden = false;
  body.innerHTML = '<p class="sub" style="margin-top:20px">Opening the treaty…</p>';
  let t;
  try { t = await getJSON(`/api/treaty/${encodeURIComponent(id)}`); } catch { body.innerHTML = '<p class="empty">Could not load this treaty.</p>'; return; }
  if (state.selected?.id !== id) return;
  const b = tre.cById.size ? highlightCessions(t.cessions, t.status) : null;
  if (b) flyTo(b.mid, Math.max(b.size, 40));
  const f = t.finding;
  let h = `<h2 style="margin-top:18px">${esc(t.name)}</h2>
    <p class="sub">${esc(t.date || '')}${f?.citation ? ` · ${esc(f.citation)}` : ''}${t.cessions.length ? ` · Royce cession ${t.cessions.map(esc).join(', ')}` : ''}</p>
    <div class="status s-${esc(t.status)}">${dot(t.status)}<b>${esc(t.statusLabel)}</b><span>${esc(t.statusNote)}</span></div>`;
  if (t.sameEventAs) h += `<p class="note">This row of the government's list records the same taking as <a href="#treaty/${encodeURIComponent(t.sameEventAs.id)}">${esc(t.sameEventAs.name)}</a>. It is counted once, there.</p>`;
  if (t.alsoRecordedAs?.length) h += `<p class="note">The same taking is also recorded as ${t.alsoRecordedAs.map((o) => `<a href="#treaty/${encodeURIComponent(o.id)}">${esc(o.name)}</a>`).join(', ')}. It is counted once, here.</p>`;
  if (f?.unsupported) h += `<p class="note">The research claimed "${esc(f.claimed)}"; the evidence recorded so far supports "${esc(t.statusLabel)}", so that is what is shown.</p>`;
  if (f?.nationVoice?.length) h += `<h3>In the nation's words</h3>${f.nationVoice.map((v) => `<div class="card own"><b>${esc(v.nation)}</b><div>${esc(v.summary)}</div>${link(v.url, 'Read it from the nation')}</div>`).join('')}`;
  if (f?.promises?.length) h += `<h3>What the United States promised</h3><ul class="promises">${f.promises.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  if (f?.breaches?.length) h += `<h3>How it was broken, on the record</h3>${f.breaches.map((x) => `<div class="card breach"><div class="k">${esc(KIND_LABEL[x.kind] || x.kind)}${x.date ? ` · ${esc(x.date)}` : ''}</div><div>${esc(x.what)}</div>${x.whoFoundIt ? `<div class="k">${esc(x.whoFoundIt)}</div>` : ''}${x.quote ? `<blockquote>"${esc(x.quote)}"</blockquote>` : ''}<div class="links">${link(x.source?.url, x.source?.title || 'Source')}</div></div>`).join('')}`;
  for (const [k, label] of [['landTaken', 'Land taken'], ['compensation', 'Payment and awards'], ['today', 'Where it stands today']]) if (f?.[k]) h += `<h3>${label}</h3><p>${esc(f[k])}</p>`;
  if (!f) h += `<p class="empty">The treaty researcher has not reached this one yet. What is known from the government's own record is below.</p>`;
  const parties = f?.nations?.length ? f.nations : [...new Set(t.scheduleTribes.flatMap((x) => x.split(/;\s*/)).map((x) => x.trim()).filter(Boolean))];
  h += `<h3>Nations</h3><div class="k">Named in the treaty or Royce's record</div><p>${parties.map(esc).join('; ') || 'Not recorded'}</p>`;
  if (t.presentDayTribes.length) h += `<details class="more-n"><summary>${t.presentDayTribes.length} nations today with ties to this land (US Forest Service)</summary><p>${t.presentDayTribes.map(esc).join('; ')}</p></details>`;
  if (t.homelands.length) h += `<h3>Homelands on this map</h3><div class="links">${t.homelands.map((x) => `<a href="#territory/${encodeURIComponent(x.id)}">${esc(x.name)}</a>`).join('')}</div>`;
  const docs = [link(f?.textUrl, 'Treaty text'), link(t.kappler, "Kappler's Indian Affairs: Laws and Treaties"), ...(t.royce || []).map((u) => link(u, "Royce's schedule (1899)")), ...(t.statute || []).map((u) => link(u, 'Federal statute')), ...(t.executiveOrder || []).map((u) => link(u, 'Executive order'))].filter(Boolean);
  if (docs.length) h += `<h3>The documents</h3><div class="links">${docs.join('')}</div>`;
  if (f?.sources?.length) h += `<h3>Sources</h3><div class="links col">${f.sources.map((s) => link(s.url, `${s.title || s.url}${s.publisher ? `, ${s.publisher}` : ''}`)).join('')}</div>`;
  if (f?.openQuestions?.length) h += `<h3>Still to settle</h3><ul>${f.openQuestions.map((q2) => `<li>${esc(q2)}</li>`).join('')}</ul>`;
  const AUDIT = { confirmed: 'every figure and source confirmed', corrected: 'corrections made', downgraded: 'status lowered to what the evidence supports', 'could-not-verify': 'some sources could not be opened' };
  h += `<p class="note">${f ? `Researched ${esc(f.researchedAt || '')} by the treaty research agent. ` : ''}${f?.audit ? `Independently checked ${esc(f.audit.auditedAt || '')}: ${esc(AUDIT[f.audit.verdict] || f.audit.verdict || '')}${f.audit.changes.length ? ` (${f.audit.changes.map(esc).join('; ')})` : ''}. ` : ''}If you belong to a nation named here and something is wrong, it will be corrected.</p>`;
  body.innerHTML = h;
}

async function openCession(id) {
  state.selected = { kind: 'cession', id };
  panel.hidden = false;
  const d = await getJSON(`/api/cession/${encodeURIComponent(id)}`);
  const b = highlightCessions([id], d.status);
  if (b) flyTo(b.mid, Math.max(b.size, 40));
  body.innerHTML = `<h2 style="margin-top:18px">Royce cession ${esc(id)}</h2><p class="sub">Land ceded to the United States</p>
    <h3>By these treaties and acts</h3>${d.treaties.map(treatyRow).join('') || '<p class="empty">No treaty recorded for this area.</p>'}
    ${d.homelands.length ? `<h3>Inside the homelands of</h3><div class="links">${d.homelands.map((x) => `<a href="#territory/${encodeURIComponent(x.id)}">${esc(x.name)}</a>`).join('')}</div>` : ''}
    <p class="note">Area drawn from Royce's 1899 survey, digitised by the US Forest Service. It is the government's record of what was taken, not the nation's own map.</p>`;
}

// ---------- Broken treaties: every documented wrong, readable in seconds ----------
const brokenEl = $('#broken');
const bt = { data: null, status: '', state: '', q: '', sort: 'old', shown: 0, list: [] };
const BT_PAGE = 30;
async function openBroken() {
  brokenEl.hidden = false;
  panel.hidden = true;
  state.selected = null;
  if (!bt.data) {
    brokenEl.querySelector('.bt-cards').innerHTML = '<p class="sub">Gathering the treaties…</p>';
    try { bt.data = await getJSON('/api/broken'); } catch { brokenEl.querySelector('.bt-cards').innerHTML = '<p class="empty">Could not load the treaties.</p>'; return; }
    const d = bt.data;
    brokenEl.querySelector('.bt-tally').innerHTML = `<b>${d.cards.length}</b> treaties with a documented wrong, out of <b>${d.researched}</b> researched so far (${d.total} in all).`;
    brokenEl.querySelector('.bt-status').innerHTML = Object.entries(d.statuses).map(([k, v]) => `<button data-s="${k}" title="${esc(v.note)}">${dot(k)}${esc(v.label)} <b>${v.count}</b></button>`).join('');
    const sel = brokenEl.querySelector('.bt-state');
    sel.insertAdjacentHTML('beforeend', Object.keys(d.states).sort().map((s) => `<option value="${esc(s)}">${esc(s)} (${d.states[s]})</option>`).join(''));
    brokenEl.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { bt.status = bt.status === b.dataset.s ? '' : b.dataset.s; brokenEl.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x.dataset.s === bt.status)); drawBroken(); }));
    sel.addEventListener('change', (e) => { bt.state = e.target.value; drawBroken(); });
    brokenEl.querySelector('.bt-sort').addEventListener('change', (e) => { bt.sort = e.target.value; drawBroken(); });
    let tmr;
    brokenEl.querySelector('.filter').addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { bt.q = e.target.value; drawBroken(); }, 150); });
    brokenEl.querySelector('.more').addEventListener('click', (e) => { if (e.target.closest('.morebtn')) moreBroken(); });
  }
  drawBroken();
}
function drawBroken() {
  const w = bt.q.toLowerCase().split(/\s+/).filter(Boolean);
  bt.list = bt.data.cards.filter((c) => (!bt.status || c.status === bt.status) && (!bt.state || c.states.includes(bt.state)) &&
    w.every((x) => `${c.name} ${c.date} ${c.nations.join(' ')} ${c.today.join(' ')} ${c.states.join(' ')}`.toLowerCase().includes(x)));
  if (bt.sort === 'new') bt.list.reverse();
  brokenEl.querySelector('.bt-count').textContent = `${bt.list.length} shown`;
  brokenEl.querySelector('.bt-cards').innerHTML = bt.list.length ? '' : '<p class="empty">Nothing matches yet. The research reaches more treaties every round.</p>';
  bt.shown = 0;
  moreBroken();
}
function moreBroken() {
  const next = bt.list.slice(bt.shown, bt.shown + BT_PAGE);
  bt.shown += next.length;
  brokenEl.querySelector('.bt-cards').insertAdjacentHTML('beforeend', next.map(brokenCard).join(''));
  const left = bt.list.length - bt.shown;
  brokenEl.querySelector('.more').innerHTML = left > 0 ? `<button class="morebtn">Show more (${left} left)</button>` : '';
}
function brokenCard(c) {
  const year = (s) => String(s || '').slice(0, 4);
  const found = c.foundBy ? `${esc(KIND_LABEL[c.foundBy.kind] || c.foundBy.kind)}${c.foundBy.date ? `, ${esc(year(c.foundBy.date))}` : ''}` : '';
  const nations = c.nations.slice(0, 5).map((n) => `<span class="tag">${esc(n)}</span>`).join('') + (c.nations.length > 5 ? `<span class="tag">+${c.nations.length - 5}</span>` : '');
  return `<article class="bt-card s-${esc(c.status)}">
    <div class="bt-head">${dot(c.status)}<span class="bt-st">${esc({ broken: 'Broken', unratified: 'Never ratified', contested: 'Contested' }[c.status])}${c.status === 'broken' && c.neverRatified ? ' · never ratified' : ''}</span><span class="bt-yr">${esc(year(c.date))}</span></div>
    <h3><a href="#treaty/${encodeURIComponent(c.id)}">${esc(c.name)}</a></h3>
    <div class="bt-nations">${nations}</div>
    ${c.voice ? `<div class="bt-voice"><div class="k">In the words of ${esc(c.voice.nation)}</div><p>${esc(c.voice.summary)}</p>${link(c.voice.url, 'Read it from the nation')}</div>` : ''}
    <dl>
      ${c.plain.promised ? `<dt>Promised</dt><dd>${esc(c.plain.promised)}</dd>` : ''}
      ${c.plain.happened ? `<dt>What happened</dt><dd>${esc(c.plain.happened)}${found ? ` <span class="bt-found">${c.foundBy.url ? link(c.foundBy.url, `Found by: ${KIND_LABEL[c.foundBy.kind] || c.foundBy.kind}${c.foundBy.date ? `, ${year(c.foundBy.date)}` : ''}`) : found}</span>` : ''}</dd>` : ''}
      ${c.plain.today ? `<dt>Today</dt><dd>${esc(c.plain.today)}</dd>` : ''}
    </dl>
    ${c.alsoRecordedAs?.length ? `<p class="bt-also">Also recorded as ${c.alsoRecordedAs.map((o) => `<a href="#treaty/${encodeURIComponent(o.id)}">${esc(o.name)}</a>`).join(', ')}</p>` : ''}
    <a class="bt-more" href="#treaty/${encodeURIComponent(c.id)}">The full record, every source, and the land on the map</a>
  </article>`;
}

function openTreatyList() {
  state.selected = { kind: 'treaties' };
  groups.focus.clear();
  panel.hidden = false;
  if (!$('#l-treaties').checked) { $('#l-treaties').checked = true; $('#l-treaties').dispatchEvent(new Event('change')); }
  const s = tre.summary;
  if (!s) { body.innerHTML = '<p class="sub" style="margin-top:20px">Loading treaties…</p>'; setTimeout(openTreatyList, 800); return; }
  let filter = '', words = '';
  body.innerHTML = `<h2 style="margin-top:18px">Treaties</h2><p class="sub">${s.treaties.length} treaties and acts that took land, from Royce's survey, and what the research has found so far.</p>
    <div class="chips status-chips">${Object.entries(s.statuses).map(([k, v]) => `<button data-s="${k}">${dot(k)}${esc(v.label)} <b>${v.count}</b></button>`).join('')}</div>
    <input class="filter" type="search" placeholder="A nation, a year, a place" autocomplete="off">
    <div class="tlist"></div>`;
  const draw = () => {
    const w = words.toLowerCase().split(/\s+/).filter(Boolean);
    const list = s.treaties.filter((t) => (!filter || t.status === filter) && w.every((x) => `${t.name} ${t.date}`.toLowerCase().includes(x)));
    const order = ['broken', 'unratified', 'contested', 'no-breach-found', 'unresearched'];
    list.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || String(a.date).localeCompare(String(b.date)));
    body.querySelector('.tlist').innerHTML = list.slice(0, 400).map(treatyRow).join('') || '<p class="empty">None yet.</p>';
  };
  body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { filter = filter === b.dataset.s ? '' : b.dataset.s; body.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x.dataset.s === filter)); draw(); }));
  body.querySelector('.filter').addEventListener('input', (e) => { words = e.target.value; draw(); });
  draw();
}

async function openNation(id) {
  state.selected = { kind: 'nation', id };
  groups.focus.clear();
  panel.hidden = false;
  let n;
  try { n = await getJSON(`/api/nation/${encodeURIComponent(id)}`); } catch { body.innerHTML = '<p class="empty">Could not load this nation.</p>'; return; }
  if (n.xz) flyTo(n.xz, 60);
  const o = n.official || {};
  const own = [link(o.website, 'Official website'), link(o.culture, 'Culture department'), link(o.museum, 'Museum'), link(o.language, 'Language program'), link(o.thpo, 'Historic preservation office'), link(o.radio, 'Radio')].filter(Boolean);
  body.innerHTML = `<h2 style="margin-top:18px">${esc(n.name)}</h2>
    <p class="sub">${n.endonym ? `${esc(n.endonym)} · ` : ''}${esc(n.recognition)} recognition${n.states.length ? ` · ${esc(n.states.join(', '))}` : ''}</p>
    ${own.length ? `<h3>In their own words</h3><div class="links">${own.join('')}</div>` : ''}
    ${n.languages.length ? `<h3>Language</h3><p>${n.languages.map(esc).join(', ')}</p>` : ''}
    <h3>Native businesses of this nation</h3>${n.businesses.length ? n.businesses.map((b) => `<a class="trow" href="#business/${encodeURIComponent(b.id)}"><i class="sdot" style="background:${CAT_COLOR[b.category]}"></i><span>${esc(b.name)}</span><small>${esc(b.categoryLabel)} · ${esc(b.city || '')}</small></a>`).join('') : '<p class="empty">None listed yet. The business research agent adds more over time.</p>'}
    ${n.homelands.length ? `<h3>Homelands</h3><div class="links">${n.homelands.map((x) => `<a href="#territory/${encodeURIComponent(x.id)}">${esc(x.name)}</a>`).join('')}</div>` : ''}
    <h3>Treaties</h3>${n.treaties.length ? n.treaties.map(treatyRow).join('') : '<p class="empty">No land cession in Royce\'s survey names this nation today.</p>'}`;
}

async function openBusiness(id) {
  state.selected = { kind: 'business', id };
  groups.focus.clear();
  panel.hidden = false;
  let b;
  try { b = await getJSON(`/api/business/${encodeURIComponent(id)}`); } catch { body.innerHTML = '<p class="empty">This listing is not on the map.</p>'; return; }
  flyTo(b.xz, 40);
  body.innerHTML = `<h2 style="margin-top:18px">${esc(b.name)}</h2>
    <p class="sub"><i class="sdot" style="background:${CAT_COLOR[b.category]}"></i>${esc(b.categoryLabel)}${b.subcategory ? ` · ${esc(b.subcategory)}` : ''}</p>
    ${b.nation ? `<p><b>${esc(b.nation)}</b></p>` : ''}
    ${b.description ? `<p>${esc(b.description)}</p>` : ''}
    <div class="links">${link(b.website, 'Website')}${link(b.shopOnline, 'Shop online')}</div>
    <h3>Where</h3><p>${b.address && !b.homeBased ? `${esc(b.address)}, ` : ''}${esc(b.city || '')}, ${esc(b.state)}</p>
    ${b.placedAt === 'town' ? '<p class="note">Shown at the town, not a street address.</p>' : ''}
    <h3>Why it is listed</h3><p>${esc(b.ownershipLabel)}: ${link(b.ownershipSource.url, b.ownershipSource.title || 'source')}</p>
    <p class="note">Last checked ${esc(b.checkedAt)}. If this is wrong or closed, it will come off.</p>`;
}

let bizCat = '', bizQ = '', bizTimer;
async function openBusinessList(cat) {
  state.selected = { kind: 'businesses' };
  groups.focus.clear();
  panel.hidden = false;
  if (mode !== 'today') setMode('today');
  if (cat !== undefined) bizCat = cat;
  const d = await getJSON(`/api/businesses?limit=120&category=${encodeURIComponent(bizCat)}&q=${encodeURIComponent(bizQ)}`);
  const cats = tod.data?.categories || {};
  const fresh = !body.querySelector('.bizlist');
  if (fresh) {
    body.innerHTML = `<h2 style="margin-top:18px">Support Native businesses</h2><p class="sub">Native-owned and tribal businesses and organisations, each with the source that shows who owns it.</p>
      <div class="chips cat-chips"></div><input class="filter" type="search" placeholder="A nation, a town, a craft, a food" autocomplete="off"><div class="bizlist"></div>`;
    body.querySelector('.filter').value = bizQ;
    body.querySelector('.filter').addEventListener('input', (e) => { clearTimeout(bizTimer); bizTimer = setTimeout(() => { bizQ = e.target.value.trim(); openBusinessList(); }, 220); });
  }
  body.querySelector('.cat-chips').innerHTML = `<button data-c="" class="${bizCat ? '' : 'on'}">Everything</button>${Object.entries(cats).map(([k, v]) => `<button data-c="${k}" class="${bizCat === k ? 'on' : ''}"><i style="background:${CAT_COLOR[k]}"></i>${esc(v.label)} <b>${v.count}</b></button>`).join('')}`;
  body.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => openBusinessList(b.dataset.c)));
  body.querySelector('.bizlist').innerHTML = d.businesses.map((b) => `<a class="trow" href="#business/${encodeURIComponent(b.id)}"><i class="sdot" style="background:${CAT_COLOR[b.category]}"></i><span>${esc(b.name)}${b.nation ? ` <small>${esc(b.nation)}</small>` : ''}</span><small>${esc(b.city || '')}, ${esc(b.state)}</small></a>`).join('')
    || '<p class="empty">No listings yet for this. The business research agent is adding them.</p>';
}

// Treaties tab on a homeland's page.
async function renderTreatyTab(tab) {
  tab.innerHTML = '<p class="sub">Finding the treaties…</p>';
  const d = await getJSON(`/api/territory/${encodeURIComponent(cur.id)}/treaties`);
  const rows = (l) => l.map(treatyRow).join('');
  tab.innerHTML = `<p class="note">A treaty is marked broken only on a court, claims commission, congressional or government finding. Colours: ${Object.entries(STATUS_COLOR).map(([k, c]) => `<i class="sdot" style="background:${c}"></i>${esc({ broken: 'broken', unratified: 'never ratified', contested: 'contested', 'no-breach-found': 'no breach found yet', unresearched: 'not yet researched' }[k])}`).join(' ')}</p>
    <h3>Signed by the nations of this homeland</h3>${rows(d.signed) || '<p class="empty">None in Royce\'s survey.</p>'}
    ${d.within.length ? `<details class="more-n"><summary>${d.within.length} more treaties touch this land or its nations today</summary>${rows(d.within)}</details>` : ''}`;
}

// Nation names on the Today map, shown as you come closer.
function makeNationLabels(list) {
  labels = labels.filter((L) => L.kind !== 'n');
  for (const n of list) {
    const el = document.createElement('div');
    el.textContent = n.name.replace(/ of the .*| of [A-Z][a-z]+, .*$/, '');
    el.style.cssText = 'position:absolute;white-space:nowrap;color:#f6ead2;text-shadow:0 1px 3px #000,0 0 8px #000;transform:translate(-50%,-160%);opacity:0;transition:opacity .25s;max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:11px;';
    labelLayer.appendChild(el);
    labels.push({ el, t: { area: 14 }, v: new THREE.Vector3(n.xz[0], 6, n.xz[1]), kind: 'n' });
  }
}

load().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:45%;width:100%;text-align:center">The map could not load: ${esc(e.message)}</p>`); });
window.__rez = { state, camera, controls, renderer, tre, tod, groups };
