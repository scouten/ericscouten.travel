#!/usr/bin/env node
// Builds the outlines behind the corner maps on the countries page and on the country and state pages:
//
//   static/common/country-shapes.json   one shape per entry on the countries page, plus any country that has posts but
//                                       isn't on that page, and `terms`, which says which shapes make up each country
//                                       tag (the United Kingdom is England, Scotland, Wales, and Northern Ireland)
//   static/common/state-shapes.json     one shape per US state, and Guam and Puerto Rico, keyed by the slug of the tag
//
// The shapes come from Natural Earth (public domain, https://www.naturalearthdata.com/), from the geojson folder of
// https://github.com/nvkelso/natural-earth-vector:
//
//   ne_10m_admin_0_map_subunits.geojson
//   ne_10m_admin_1_states_provinces.geojson
//   ne_50m_admin_1_states_provinces.geojson
//
// Usage: node tools/build-country-shapes.js <folder with the three files above>
//
// Every `es_country` entry on the countries page gets one shape, keyed by the slug of its name (the shortcode puts the
// same slug on the card). An entry that matches nothing is an error, so a new entry fails loudly here.
'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node tools/build-country-shapes.js <natural-earth folder>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const subunits = read('ne_10m_admin_0_map_subunits.geojson').features;
const admin1 = read('ne_50m_admin_1_states_provinces.geojson').features;
const usStates = read('ne_10m_admin_1_states_provinces.geojson').features.filter(f => f.properties.admin === 'United States of America');

const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ------------------------------------------------------------ which outline is which
// Most entries are a subunit of the same name, or of the name before the comma ("Tasmania, Australia"). These are the
// ones that aren't.
const SUBUNITS = {
  'British Sovereign Base Areas, Cyprus': ['Akrotiri Sovereign Base Area', 'Dhekelia Sovereign Base Area'],
  'France': ['France', 'Corsica'],
  'United States mainland': ['United States'],
  'Vatican City': ['Vatican'],
  'Bahamas': ['The Bahamas'],
  'Belgium': ['Flemish Region', 'Walloon Region', 'Brussels Capital Region'],
  'New Zealand': ['North Island', 'South Island'],
};

// Japan is its four main islands and many smaller groups, each a subunit of its own.
const ADMIN = { 'Japan': 'Japan' };

// Pieces of a multipolygon, picked by where the piece is: [west, south, east, north].
const PIECES = {
  'Dodecanese Islands, Greece': { subunit: 'Greece', within: [26.5, 35.8, 29.7, 37.9] },
  'Turkey in Europe': { subunit: 'Turkey', within: [25, 39.5, 29.2, 42.2] },
  'Turkey in Asia': { subunit: 'Turkey', without: [25, 39.5, 29.2, 42.2] },
};

// A shape drawn whole but framed by its main part alone, so the map isn't zoomed out to reach a far-flung island chain:
// the Aleutians (Alaska) and the northwestern Hawaiian Islands.
const FRAMING = {
  'Alaska': [-170, 50, -128, 72],
  'Hawaii': [-161.5, 18, -154, 23],
};

// Small places far from any other land, which need a wider view than the map's usual minimum to show where they are:
// the narrowest span, in degrees, to frame each in.
const SPANS = {
  'Guam': 50,
  'Fiji': 60,
  'Hawaii': 30,
};

const PROVINCES = { 'Prince Edward Island, Canada': 'Prince Edward Island' };

// ------------------------------------------------------------ geometry
const polygonsOf = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
const ringBox = ring => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const centroid = poly => { const b = ringBox(poly[0]); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// Douglas–Peucker, on a ring that stays closed.
function simplify(ring, tol) {
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, dmax = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(ring[i], ring[a], ring[b]);
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far >= 0 && dmax > tol) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// A big country is often seen as the backdrop to a small one (Canada around Prince Edward Island), close up, so its
// detail is capped in degrees however large it is: lines are simplified to within MAX_TOLERANCE, and pieces smaller
// than MAX_PIECE across are dropped.
const MAX_TOLERANCE = 0.03;
const MAX_PIECE = 0.1;

// Outlines are drawn in a map a couple of hundred pixels wide, so detail is relative to the shape's own size: a coarse
// line for Canada, a fine one for Monaco. Pieces much smaller than the shape (a speck of an island) are dropped,
// unless nothing else would be left.
function prepare(polys, basis) {
  const boxes = polys.map(p => ringBox(p[0]));
  const all = extent(basis);
  const diag = Math.hypot(all[2] - all[0], all[3] - all[1]);
  const tol = Math.min(diag * 0.004, MAX_TOLERANCE);
  const minPiece = Math.min(diag * 0.01, MAX_PIECE);
  const digits = tol < 0.01 ? 3 : 2;
  const r = n => +n.toFixed(digits);
  const out = [];
  polys.forEach((p, i) => {
    const d = Math.hypot(boxes[i][2] - boxes[i][0], boxes[i][3] - boxes[i][1]);
    if (d < minPiece && polys.length > 1) return;
    const rings = p.map((ring, k) => k === 0 || Math.hypot(...[ringBox(ring)].map(b => [b[2] - b[0], b[3] - b[1]]).flat()) > Math.min(diag * 0.02, MAX_PIECE * 2) ? simplify(ring, tol) : null)
      .filter(ring => ring && ring.length >= 4);
    if (rings.length) out.push(rings.map(ring => ring.map(([x, y]) => [r(x), r(y)])));
  });
  return out.length ? out : [polys[0].map(ring => ring.map(([x, y]) => [r(x), r(y)]))];
}

// The shape's extent, [west, south, east, north]. A shape that crosses the antimeridian (Fiji) is measured with its
// western pieces moved east of 180, which the map accepts.
function extent(polys) {
  const boxes = polys.map(p => ringBox(p[0]));
  const crosses = boxes.some(b => b[2] > 170) && boxes.some(b => b[0] < -170);
  const shifted = crosses ? boxes.map(b => b[2] < 0 ? [b[0] + 360, b[1], b[2] + 360, b[3]] : b) : boxes;
  const e = shifted.reduce((b, c) => [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])]);
  return e.map(n => +n.toFixed(3));
}

// ------------------------------------------------------------ the shapes
const bySubunit = n => subunits.filter(f => f.properties.SUBUNIT === n);
const problems = [];

// A shape from its polygons: its extent (framed by `framing` alone, if given), and its simplified outline.
function shapeOf(name, polys, extra) {
  // Alaska reaches across the antimeridian with the Aleutians; the map frames the part east of it.
  const framed = FRAMING[name] ? polys.filter(p => inBox(centroid(p), FRAMING[name])) : polys;
  const [w, s, e, n] = extent(framed);
  return {
    name,
    bbox: [w, s, e, n],
    ...(SPANS[name] && { span: SPANS[name] }),
    ...extra,
    geometry: { type: 'MultiPolygon', coordinates: prepare(polys, framed) },
  };
}

// ------------------------------------------------------------ the countries page's entries
const names = [...fs.readFileSync(path.join(root, 'content/countries/index.md'), 'utf8').matchAll(/^\s*name = "([^"]+)"/gm)].map(m => m[1]);
const shapes = {};

for (const name of names) {
  let polys = [];
  if (PIECES[name]) {
    const { subunit, within, without } = PIECES[name];
    polys = bySubunit(subunit).flatMap(f => polygonsOf(f.geometry))
      .filter(p => within ? inBox(centroid(p), within) : !inBox(centroid(p), without));
  } else if (PROVINCES[name]) {
    polys = admin1.filter(f => f.properties.name === PROVINCES[name]).flatMap(f => polygonsOf(f.geometry));
  } else if (ADMIN[name]) {
    polys = subunits.filter(f => f.properties.ADMIN === ADMIN[name]).flatMap(f => polygonsOf(f.geometry));
  } else {
    const wanted = SUBUNITS[name] || [name.split(',')[0]];
    polys = wanted.flatMap(n => bySubunit(n)).flatMap(f => polygonsOf(f.geometry));
  }
  if (!polys.length) { problems.push(name); continue; }
  shapes[slugify(name)] = shapeOf(name, polys);
}

// ------------------------------------------------------------ the tags
// The country and state tags the posts use, from their front matter.
const tagged = { country: new Set(), state: new Set() };
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) {
      const front = (fs.readFileSync(p, 'utf8').match(/^\+\+\+\n([\s\S]*?)\n\+\+\+/) || [])[1] || '';
      for (const kind of ['country', 'state']) {
        const m = front.match(new RegExp('^' + kind + '\\s*=\\s*\\[(.*?)\\]', 'm'));
        if (m) [...m[1].matchAll(/"([^"]+)"/g)].forEach(t => tagged[kind].add(t[1]));
      }
    }
  }
})(path.join(root, 'content'));

// A tag made of several of the shapes above.
const TERM_GROUPS = {
  'United Kingdom': ['England, United Kingdom', 'Scotland, United Kingdom', 'Wales, United Kingdom', 'Northern Ireland, United Kingdom'],
};

// Which shapes make up each country tag. A tag that is a shape's name, or the name before its comma ("Tasmania"),
// takes that shape; a country with posts but no entry on the countries page gets a shape of its own, marked `extra` so
// that page leaves it out.
const terms = {};
for (const tag of [...tagged.country].sort()) {
  const slug = slugify(tag);
  const keys = (TERM_GROUPS[tag] || []).map(slugify);
  if (!keys.length) {
    const hit = Object.keys(shapes).find(k => k === slug || slugify(shapes[k].name.split(',')[0]) === slug);
    if (hit) keys.push(hit);
  }
  if (!keys.length) {
    const polys = bySubunit(tag).flatMap(f => polygonsOf(f.geometry));
    if (!polys.length) { problems.push(`country tag ${tag}`); continue; }
    shapes[slug] = shapeOf(tag, polys, { extra: true });
    keys.push(slug);
  }
  terms[slug] = keys;
}

// ------------------------------------------------------------ the states
const stateShapes = {};
for (const f of usStates) stateShapes[slugify(f.properties.name)] = shapeOf(f.properties.name, polygonsOf(f.geometry));

// Territories that are tagged as states.
for (const [name, subunit] of [['Guam', 'Guam'], ['Puerto Rico', 'Puerto Rico']]) {
  stateShapes[slugify(name)] = shapeOf(name, bySubunit(subunit).flatMap(f => polygonsOf(f.geometry)));
}
for (const tag of tagged.state) if (!stateShapes[slugify(tag)]) problems.push(`state tag ${tag}`);

if (problems.length) {
  console.error('No outline found for: ' + problems.join(', '));
  process.exit(1);
}

// ------------------------------------------------------------ output
function write(file, doc) {
  const dest = path.join(root, 'static/common', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(doc));
  console.log(`${Object.keys(doc.shapes).length} shapes, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB -> ${path.relative(root, dest)}`);
}

write('country-shapes.json', { source: 'Natural Earth (public domain), simplified', shapes, terms });
write('state-shapes.json', { source: 'Natural Earth (public domain), simplified', shapes: stateShapes });
