/* countries-map.js — the countries page's corner map: the country in view, outlined and filled, with enough of its
 * surroundings to see where it sits, and every country I've visited tinted.
 *
 * A corner map (corner-map.js) built on the theme's track map: as the reader scrolls, the map glides to frame the
 * country whose card is in view. Clicking it opens it full-screen, where the reader can pan and zoom, and click a
 * country to jump to its card. On a phone the corner map is the theme's bottom strip. Reads:
 *   - #countries-map-config     JSON written by countries_map.html (basemap options, the outlines' URL, story counts)
 *   - the outlines              static/common/country-shapes.json, made by tools/build-country-shapes.js
 *   - .card[data-country]       the cards, in page order (written by the es_country shortcode)
 *   - CSS custom properties on the widget (--es-track-*) for every colour
 */
(function () {
  'use strict';

  const cfgEl = document.getElementById('countries-map-config');
  if (!cfgEl || !window.esCornerMap) return;
  const CFG = JSON.parse(cfgEl.textContent);

  // How much of the surroundings to show: the country's extent is multiplied by this, and never framed tighter than
  // MIN_SPAN degrees, so a city-state still shows the country around it. A very large country doesn't need more than
  // the world.
  const CONTEXT = 2.4;
  const MIN_SPAN = 9;
  const MAX_SPAN = 200;

  // A shape smaller than this many degrees is too small to see at the corner map's scale: it gets a dot as well.
  const TINY = 0.6;

  const cards = Array.from(document.querySelectorAll('.card[data-country]')).map(el => ({
    el,
    key: el.dataset.country,
    name: el.dataset.name,
    flag: el.dataset.flag,
    years: el.dataset.years,
    seq: +el.dataset.seq,
    stories: (CFG.stories || {})[el.dataset.href] || 0,
    href: el.dataset.href || '',
  }));
  if (!cards.length) return;
  const byKey = new Map(cards.map(c => [c.key, c]));

  // The card ends with a line about the country's stories: a link saying how many there are ("See 4 travel stories from
  // India"), or, when there are none yet, that. The counts come from the page template, as a shortcode can't look at
  // the site's taxonomies.
  cards.forEach(c => {
    const content = c.el.querySelector('.card-content .content') || (() => {
      const outer = document.createElement('div');
      outer.className = 'card-content';
      const inner = document.createElement('div');
      inner.className = 'content';
      outer.appendChild(inner);
      c.el.appendChild(outer);
      return inner;
    })();
    let line = content.querySelector('.read-more');
    if (c.stories) {
      const link = line && line.querySelector('a');
      if (link) link.textContent = link.textContent.replace('See travel stories', `See ${c.stories} travel ${c.stories === 1 ? 'story' : 'stories'}`);
      return;
    }
    if (!line) {
      line = document.createElement('div');
      line.className = 'read-more';
      content.appendChild(line);
    }
    const none = document.createElement('span');
    none.className = 'no-stories';
    none.textContent = 'No travel stories yet';
    line.replaceChildren(none);
  });

  let shapes = {};  // The outlines, by country key.

  // ------------------------------------------------------------ map
  const shapeData = () => ({
    type: 'FeatureCollection',
    features: Object.entries(shapes).map(([key, s]) => ({ type: 'Feature', properties: { key }, geometry: s.geometry })),
  });

  // A dot at the middle of every shape too small to see.
  const dotData = () => ({
    type: 'FeatureCollection',
    features: Object.entries(shapes)
      .filter(([, s]) => Math.max(s.bbox[2] - s.bbox[0], s.bbox[3] - s.bbox[1]) < TINY)
      .map(([key, s]) => ({ type: 'Feature', properties: { key }, geometry: { type: 'Point', coordinates: [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2] } })),
  });

  const key = ['get', 'key'];
  const NONE = ['==', key, ''];
  const at = () => ctl.focus >= 0 ? cards[ctl.focus].key : '';

  // A phone's strip is too small a picture for the tint: only the country in view is drawn there.
  const FILTERS = {
    'cm-visited': () => ctl.strip() ? NONE : ['!=', key, at()],
    'cm-visited-line': () => ctl.strip() ? NONE : ['!=', key, at()],
    'cm-visited-dot': () => ctl.strip() ? NONE : ['!=', key, at()],
    'cm-current': () => ['==', key, at()],
    'cm-current-line': () => ['==', key, at()],
    'cm-current-dot': () => ['==', key, at()],
  };

  function buildStyle() {
    const style = ctl.basemapStyle();
    const { tok } = ctl;
    const cur = tok('current'), acc = tok('accent');
    const h = ctl.strip() ? .7 : 1;
    style.sources['cm-shapes'] = { type: 'geojson', data: shapeData() };
    style.sources['cm-dots'] = { type: 'geojson', data: dotData() };
    const layer = (id, type, source, paint, extra) => Object.assign({ id, type, source, filter: FILTERS[id](), paint }, extra);
    style.layers.push(
      layer('cm-visited', 'fill', 'cm-shapes', { 'fill-color': acc, 'fill-opacity': .22 }),
      layer('cm-visited-line', 'line', 'cm-shapes', { 'line-color': acc, 'line-opacity': .55, 'line-width': .8 }, { layout: { 'line-join': 'round' } }),
      layer('cm-visited-dot', 'circle', 'cm-dots', { 'circle-radius': 2.5, 'circle-color': acc, 'circle-stroke-color': tok('casing'), 'circle-stroke-width': .8 }),

      // The country in view: a stronger fill and a bold outline, with a dot where the shape is too small to see.
      layer('cm-current', 'fill', 'cm-shapes', { 'fill-color': cur, 'fill-opacity': .42 }),
      layer('cm-current-line', 'line', 'cm-shapes', { 'line-color': cur, 'line-opacity': 1, 'line-width': 2 * h }, { layout: { 'line-join': 'round' } }),
      layer('cm-current-dot', 'circle', 'cm-dots', { 'circle-radius': 5 * h, 'circle-color': tok('dot'), 'circle-stroke-color': cur, 'circle-stroke-width': 2.5 * h }),
    );
    ctl.widget.classList.add('basemap-muted');
    return style;
  }

  function applyFilters() {
    if (ctl.mapReady) Object.keys(FILTERS).forEach(id => ctl.map.setFilter(id, FILTERS[id]()));
  }

  // The bounds that frame a country with its surroundings, or the whole world (before the first card, and for the
  // fit button).
  function boundsFor(k) {
    const s = shapes[k];

    // Centred over the Atlantic, west of the middle of the world: the corner map can't show it all, and this shows the
    // Americas and Europe, where most of the dots are.
    if (!s) return [[-220, -58], [140, 78]];
    const [w, so, e, n] = s.bbox;
    const cx = (w + e) / 2, cy = (so + n) / 2;
    const min = s.span || MIN_SPAN;
    const hx = Math.min(MAX_SPAN, Math.max((e - w) * CONTEXT, min)) / 2;
    const hy = Math.min(120, Math.max((n - so) * CONTEXT, min)) / 2;
    return [[cx - hx, Math.max(-84, cy - hy)], [cx + hx, Math.min(84, cy + hy)]];
  }

  // ------------------------------------------------------------ caption
  // The country in view: its number in the list, its name and flag, and when I went and what I've written about it.
  // Before the first card, the tally.
  function caption() {
    const c = ctl.focus >= 0 ? cards[ctl.focus] : null;
    const { line } = ctl;
    let lines;
    if (c) {
      // The count stays whole when a long name is cut short with an ellipsis.
      const title = line('mode cm-title', '');
      title.append(line('cm-count', `${c.seq} of ${cards.length}`), line('cm-name', `${c.name} ${c.flag}`));
      const detail = line('label', `${c.years} · `);
      if (c.stories && c.href) {
        const link = document.createElement('a');
        link.href = c.href;
        link.textContent = `${c.stories} travel ${c.stories === 1 ? 'story' : 'stories'}`;
        detail.append(link);
      } else {
        detail.append(c.stories ? `${c.stories} travel stories` : 'No travel stories yet');
      }
      lines = [title, detail];
    } else {
      lines = [line('mode', 'Countries I’ve Visited'), line('label', `${cards.length} countries and territories`)];
    }
    ctl.setCaption('pin', lines, c && c.href ? `Open ${c.name}` : '');
  }

  // Full-screen, pointing at a visited country shows what it is, and clicking it closes the map at its card.
  function wire() {
    const { map } = ctl;
    map.on('mousemove', 'cm-visited', e => {
      if (!ctl.expanded || !e.features.length) return;
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'cm-visited', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', e => {
      if (!ctl.expanded) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ['cm-visited', 'cm-current', 'cm-visited-dot', 'cm-current-dot'] })[0];
      const c = f && byKey.get(f.properties.key);
      if (!c) return;
      ctl.setExpanded(false);
      c.el.scrollIntoView({ block: 'center' });
    });
  }

  // ------------------------------------------------------------ boot
  async function loadShapes() {
    try {
      const r = await fetch(CFG.shapesUrl);
      if (!r.ok) throw new Error('HTTP ' + r.status);

      // The file also holds countries that have posts but aren't on this page.
      const all = (await r.json()).shapes || {};
      shapes = Object.fromEntries(Object.entries(all).filter(([k]) => byKey.has(k)));
    } catch (e) {
      console.warn('countries-map: could not load the outlines', e);
    }
  }

  const ctl = window.esCornerMap.create({
    cfg: CFG,
    cards,
    load: loadShapes,
    bounds: () => boundsFor(ctl.focus >= 0 ? at() : ''),
    buildStyle,
    frame: (animate, world) => ctl.fitTo(boundsFor(world || ctl.focus < 0 ? '' : at()), animate, 900),

    // Only on a phone, before the first card, is there nothing for the strip to show.
    idle: () => ctl.strip() && ctl.focus < 0,
    onFocus: () => {
      caption();
      applyFilters();
      ctl.fitTo(boundsFor(ctl.focus < 0 ? '' : at()), true, 900);
    },
    onExpanded: caption,
    barHref: () => ctl.focus >= 0 ? cards[ctl.focus].href : '',
    wire,
    onReady: applyFilters,
    noTiles: 'Map tiles unavailable. Showing the countries alone.',
  });
  ctl.start().catch(err => console.warn('countries-map:', err));
})();
