/* place-map.js — the corner map on a country's or state's page: the place, held at one zoom, with the track of the
 * post in view drawn on it, or a dot where the track is too small to find at that zoom.
 *
 * A corner map (corner-map.js) built on the theme's track map: the region outline from track-common.js, and the track
 * format of docs/track-format.md. Unlike the theme's section map, the view doesn't follow the posts: it stays on the
 * place, and only the post in view changes. A post without a track has nothing to show, so the map fades away over it. Clicking the map opens it full-screen, where
 * the reader can pan and zoom, see every post's track at once, and click one to jump to its post. Reads:
 *   - #place-map-config         JSON written by place_map.html (the place, the posts that have tracks, basemap options)
 *   - the outlines              static/common/country-shapes.json or state-shapes.json, made by
 *                               tools/build-country-shapes.js
 *   - .pages > .card            the posts, in page order, paired with the config's pages by their links
 *   - CSS custom properties on the widget (--es-track-*) for every colour
 */
(function () {
  'use strict';

  const cfgEl = document.getElementById('place-map-config');
  if (!cfgEl || !window.esCornerMap) return;
  const { MODES, fmtBoth, modeSummary } = window.esTrack;
  const CFG = JSON.parse(cfgEl.textContent);

  // How much of the surroundings to show: the place's extent is multiplied by this, and never framed tighter than
  // MIN_SPAN degrees, so a small place still shows what's around it.
  const CONTEXT = 2.2;
  const MIN_SPAN = 9;
  const MAX_SPAN = 200;

  // A track that spans less than this many pixels at the map's zoom is hard to find: a dot marks it instead.
  const DOT_PX = 28;

  // Tracks are fetched as their posts come near, this many posts ahead of the reader.
  const AHEAD = 2;

  // The posts' links are compared by path, so a page served from another origin still matches.
  const pathOf = url => { try { return new URL(url, location.href).pathname; } catch (e) { return url; } };
  const byPath = new Map(CFG.pages.map(p => [pathOf(p.permalink), p]));

  const cards = Array.from(document.querySelectorAll('.pages > .card')).map(el => {
    const link = el.querySelector('.card-header .title a');
    const info = link && byPath.get(pathOf(link.href));
    return {
      el,
      info: info || null,
      state: info ? 'waiting' : 'none',  // Then 'loading', then 'ok' or 'failed'.
      coords: null,
      bbox: null,
      legs: [],
      distM: 0,
    };
  });
  if (!cards.some(c => c.info)) return;

  let shapes = {};  // The outlines in the shapes file, by key.
  let keys = [];  // The keys of the shapes that make up this place.
  let region = null;  // The place's outline, a GeoJSON multipolygon, or null.
  let dotted = [];  // The indexes of the cards whose tracks are too small to find at the map's zoom.

  // ------------------------------------------------------------ tracks
  const R = 6371000;
  const nearLon = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);

  function hav(a, b) {
    const toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Each leg's mode and distance, for the post's summary: the leg's `dist_m`, else measured along its points.
  const legsOf = track => (track.legs || []).map(l => {
    const pts = l.pts || [];
    let m = typeof l.dist_m === 'number' ? l.dist_m : 0;
    if (typeof l.dist_m !== 'number') for (let k = 1; k < pts.length; k++) m += hav(pts[k - 1], pts[k]);
    return { mode: l.mode, m };
  });

  // The track's points as one line, each longitude within 180° of the one before, so a track that crosses the
  // antimeridian runs on past ±180°.
  function trackCoords(track) {
    const out = [];
    let prev = null;
    (track.legs || []).forEach(l => (l.pts || []).forEach(p => {
      const lon = prev == null ? p[0] : nearLon(p[0], prev);
      out.push([lon, p[1]]);
      prev = lon;
    }));
    return out;
  }

  const load = url => fetch(url, { credentials: 'omit' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + url); return r.json(); });

  // The CDN only answers cross-origin fetches from the production origins; a deploy preview proxies the same path
  // through its own origin instead, so retry there when the direct fetch was refused outright.
  function loadCard(c) {
    if (c.state !== 'waiting') return;
    c.state = 'loading';
    load(c.info.trackUrl)
      .catch(err => {
        if (!c.info.trackFallback || !(err instanceof TypeError)) throw err;
        return load(c.info.trackFallback);
      })
      .then(track => {
        const coords = trackCoords(track);
        if (coords.length < 2) throw new Error('track has no line');
        c.coords = coords;
        c.legs = legsOf(track);
        c.distM = typeof track.dist_m === 'number' ? track.dist_m : 0;
        const lons = coords.map(p => p[0]), lats = coords.map(p => p[1]);
        c.bbox = Array.isArray(track.bbox) && track.bbox.length === 4 ? track.bbox : [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
        c.state = 'ok';
      })
      .catch(err => {
        c.state = 'failed';
        console.warn('place-map: could not load ' + c.info.trackUrl, err);
      })
      .then(() => {
        if (ctl.mapReady) {
          ctl.map.getSource('pm-tracks').setData(trackData());
          ctl.map.getSource('pm-dots').setData(dotData());
          updateDots();
        }
        caption();
        updateNotice();
        ctl.updateIdle();
      });
  }

  // Loads the track of the post in view and the few after it, or every track when the map is full-screen.
  function loadNear() {
    cards.forEach((c, i) => { if (c.info && (ctl.expanded || (ctl.focus >= 0 && i >= ctl.focus && i <= ctl.focus + AHEAD))) loadCard(c); });
  }

  // ------------------------------------------------------------ map
  const trackData = () => ({
    type: 'FeatureCollection',
    features: cards.flatMap((c, i) => c.state === 'ok'
      ? [{ type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: c.coords } }] : []),
  });

  // A dot at the middle of each track.
  const dotData = () => ({
    type: 'FeatureCollection',
    features: cards.flatMap((c, i) => c.state === 'ok'
      ? [{ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [(c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2] } }] : []),
  });

  const idx = ['get', 'i'];
  const NONE = ['==', idx, -2];
  const at = () => ctl.focus;
  const isDotted = () => ['in', idx, ['literal', dotted.length ? dotted : [-2]]];

  // Corner: only the post in view is drawn. Full-screen: every post with a track, the one in view in green and the
  // rest in amber. A track too small to find is drawn as a dot, not as a line.
  const FILTERS = {
    'pm-others-casing': () => ctl.expanded ? ['all', ['!=', idx, at()], ['!', isDotted()]] : NONE,
    'pm-others': () => ctl.expanded ? ['all', ['!=', idx, at()], ['!', isDotted()]] : NONE,
    'pm-current-casing': () => ['all', ['==', idx, at()], ['!', isDotted()]],
    'pm-current-halo': () => ['all', ['==', idx, at()], ['!', isDotted()]],
    'pm-current': () => ['all', ['==', idx, at()], ['!', isDotted()]],
    'pm-others-dot': () => ctl.expanded ? ['all', ['!=', idx, at()], isDotted()] : NONE,
    'pm-current-dot-halo': () => ['all', ['==', idx, at()], isDotted()],
    'pm-current-dot-ring': () => ['all', ['==', idx, at()], isDotted()],
    'pm-current-dot': () => ['all', ['==', idx, at()], isDotted()],
  };

  function buildStyle() {
    const style = ctl.basemapStyle();
    const { tok } = ctl;
    const cur = tok('current'), acc = tok('accent');
    const z = ctl.expanded ? 1.4 : 1;

    // The place stands out: its surroundings dim, and a fine line traces its border, as on the park pages' maps.
    window.esTrack.addRegion(style, region, tok);
    style.sources['pm-tracks'] = { type: 'geojson', data: trackData() };
    style.sources['pm-dots'] = { type: 'geojson', data: dotData() };
    const line = { 'line-cap': 'round', 'line-join': 'round' };
    const day = (id, paint) => ({ id, type: 'line', source: 'pm-tracks', filter: FILTERS[id](), layout: line, paint });
    const dot = (id, paint) => ({ id, type: 'circle', source: 'pm-dots', filter: FILTERS[id](), paint });
    style.layers.push(
      day('pm-others-casing', { 'line-color': tok('casing'), 'line-width': 4.8 }),
      day('pm-others', { 'line-color': acc, 'line-width': 3 }),
      day('pm-current-casing', { 'line-color': tok('casing'), 'line-width': 4.8 }),
      day('pm-current-halo', { 'line-color': tok('current-halo'), 'line-width': 12, 'line-blur': 1.5 }),
      day('pm-current', { 'line-color': cur, 'line-width': 3 }),
      dot('pm-others-dot', { 'circle-radius': 3.5 * z, 'circle-color': acc, 'circle-stroke-color': tok('casing'), 'circle-stroke-width': .8 * z }),

      // The post in view, as a dot: a soft halo, a ring, and a white dot, as the park pages' map marks its position.
      dot('pm-current-dot-halo', { 'circle-radius': 11, 'circle-color': cur, 'circle-opacity': .3, 'circle-blur': .4 }),
      dot('pm-current-dot-ring', { 'circle-radius': 11, 'circle-color': cur, 'circle-opacity': 0, 'circle-stroke-color': cur, 'circle-stroke-width': 3 }),
      dot('pm-current-dot', { 'circle-radius': 5, 'circle-color': tok('dot'), 'circle-stroke-color': cur, 'circle-stroke-width': 2.5 }),

      // What the pointer finds: every track, wider than it's drawn.
      { id: 'pm-hit', type: 'line', source: 'pm-tracks', layout: line, paint: { 'line-width': 16, 'line-opacity': 0 } },
      { id: 'pm-hit-dot', type: 'circle', source: 'pm-dots', paint: { 'circle-radius': 12, 'circle-opacity': 0 } },
    );
    ctl.widget.classList.add('basemap-muted');
    return style;
  }

  function applyFilters() {
    if (ctl.mapReady) Object.keys(FILTERS).forEach(id => ctl.map.setFilter(id, FILTERS[id]()));
  }

  // The tracks too small to find at the map's zoom, which change as the reader zooms full-screen.
  function updateDots() {
    if (!ctl.mapReady) return;
    const next = [];
    cards.forEach((c, i) => {
      if (c.state !== 'ok') return;
      const a = ctl.map.project([c.bbox[0], c.bbox[1]]), b = ctl.map.project([c.bbox[2], c.bbox[3]]);
      if (Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) < DOT_PX) next.push(i);
    });
    if (next.join() !== dotted.join()) dotted = next;
    applyFilters();
  }

  // The bounds that frame the place with its surroundings.
  function placeBounds() {
    const parts = keys.map(k => shapes[k]).filter(Boolean);
    if (!parts.length) return null;
    const w = Math.min(...parts.map(s => s.bbox[0])), so = Math.min(...parts.map(s => s.bbox[1]));
    const e = Math.max(...parts.map(s => s.bbox[2])), n = Math.max(...parts.map(s => s.bbox[3]));
    const min = Math.max(MIN_SPAN, ...parts.map(s => s.span || 0));
    const cx = (w + e) / 2, cy = (so + n) / 2;
    const hx = Math.min(MAX_SPAN, Math.max((e - w) * CONTEXT, min)) / 2;
    const hy = Math.min(120, Math.max((n - so) * CONTEXT, min)) / 2;
    return [[cx - hx, Math.max(-84, cy - hy)], [cx + hx, Math.min(84, cy + hy)]];
  }

  // ------------------------------------------------------------ caption
  // The post in view: its title and date, and, once its track has arrived, its ways of travel and distance, under the
  // icon of the main one. Before the first post, the place.
  const STATUS = { waiting: 'Loading map …', loading: 'Loading map …', failed: 'The map for this post could not be loaded', none: 'No map for this post' };

  function caption() {
    const c = ctl.focus >= 0 ? cards[ctl.focus] : null;
    const sum = c && c.state === 'ok' ? modeSummary(c.legs) : null;
    const { line } = ctl;
    let lines;
    if (c && c.info) {
      const dist = c.state === 'ok' ? (c.info.distance || (c.distM ? fmtBoth(c.distM) : '')) : '';
      const ways = sum ? [sum.ways, dist].filter(Boolean).join(' · ') : STATUS[c.state];
      lines = [line('mode', c.info.title), line('label', c.info.date), line('label', ways)];
    } else {
      lines = [line('mode', CFG.name), line('label', c ? STATUS.none : 'Scroll to follow my travels')];
    }
    ctl.setCaption(sum ? MODES[sum.mode].icon : 'pin', lines);
  }

  function updateNotice() {
    const c = ctl.focus >= 0 ? cards[ctl.focus] : null;
    if (!window.maplibregl) ctl.showNotice('The map library could not be loaded.');
    else if (c && c.state === 'ok' && !ctl.base) ctl.showNotice('Map tiles unavailable. Showing the route alone.');
    else ctl.showNotice('');
  }

  // Full-screen, clicking a track (or its dot) closes the map at its post.
  function wire() {
    const { map } = ctl;
    const hits = ['pm-hit', 'pm-hit-dot'];
    map.on('mousemove', e => { if (ctl.expanded) map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: hits }).length ? 'pointer' : ''; });
    map.on('click', e => {
      if (!ctl.expanded) return;
      const f = map.queryRenderedFeatures(e.point, { layers: hits })[0];
      const c = f && cards[f.properties.i];
      if (!c) return;
      ctl.setExpanded(false);
      c.el.scrollIntoView({ block: 'center' });
    });
    map.on('zoomend', updateDots);
  }

  // ------------------------------------------------------------ boot
  async function loadShapes() {
    let doc = {};
    try {
      const r = await fetch(CFG.shapesUrl);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      doc = await r.json();
    } catch (e) {
      console.warn('place-map: could not load the outlines', e);
    }
    shapes = doc.shapes || {};
    keys = (doc.terms ? doc.terms[CFG.term] : [CFG.term]) || [];
    const polygons = keys.flatMap(k => shapes[k] ? shapes[k].geometry.coordinates : []);
    region = polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
  }

  const ctl = window.esCornerMap.create({
    cfg: CFG,
    cards,
    load: loadShapes,
    bounds: placeBounds,
    buildStyle,
    frame: animate => ctl.fitTo(placeBounds(), animate, 600),

    // The map fades away while the post in view has no new-style track (or none that loaded), and before the first post.
    idle: () => {
      const c = ctl.focus >= 0 ? cards[ctl.focus] : null;
      return !c || c.state === 'none' || c.state === 'failed';
    },
    onFocus: () => {
      loadNear();
      caption();
      updateDots();
      updateNotice();
    },
    onExpanded: () => loadNear(),
    afterLayout: updateDots,
    barHref: () => { const c = ctl.focus >= 0 ? cards[ctl.focus] : null; return c && c.info ? c.info.permalink : ''; },
    wire,
    noTiles: 'Map tiles unavailable. Showing the routes alone.',
  });
  ctl.start().catch(err => console.warn('place-map:', err));
})();
