/* countries-map.js — the countries page's corner map: the country in view, outlined and filled, with enough of its
 * surroundings to see where it sits, and every country I've visited tinted.
 *
 * Built on the theme's track map (themes/zola-es-theme/docs/track-map.md): the same widget markup and styles, and the
 * basemap from track-common.js. As the reader scrolls, the map glides to frame the country whose card is in view.
 * Clicking it opens it full-screen, where the reader can pan and zoom, and click a country to jump to its card. On a
 * phone the corner map is the theme's bottom strip. Reads:
 *   - #countries-map-config     JSON written by countries_map.html (basemap options, the outlines' URL)
 *   - the outlines              static/common/country-shapes.json, made by tools/build-country-shapes.js
 *   - .card[data-country]       the cards, in page order (written by the es_country shortcode)
 *   - CSS custom properties on the widget (--es-track-*) for every colour
 */
(function () {
  'use strict';

  const cfgEl = document.getElementById('countries-map-config');
  const widget = document.getElementById('es-track-widget');
  if (!cfgEl || !widget || !window.esTrack) return;
  const { iconSvg, isPhone } = window.esTrack;
  const CFG = JSON.parse(cfgEl.textContent);
  const tok = n => getComputedStyle(widget).getPropertyValue('--es-track-' + n).trim();

  // The reading line, as a fraction of the window's height: the card that crosses it is the one in view.
  const FOCUS_LINE = 0.4;

  // How much of the surroundings to show: the country's extent is multiplied by this, and never framed tighter than
  // MIN_SPAN degrees, so a city-state still shows the country around it. A very large country doesn't need more than
  // the world.
  const CONTEXT = 2.4;
  const MIN_SPAN = 9;
  const MAX_SPAN = 200;

  // A shape smaller than this many degrees is too small to see at the corner map's scale: it gets a dot as well.
  const TINY = 0.6;

  const notice = document.getElementById('es-track-notice');
  const ico = document.getElementById('es-track-ico');
  const text = document.getElementById('es-track-text');
  const collapseBtn = document.getElementById('es-track-collapse');
  const attrBtn = document.getElementById('es-track-attr-btn');
  const modal = document.getElementById('es-track-modal');
  const showNotice = msg => { notice.textContent = msg || ''; notice.hidden = !msg; };

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

  let map = null, mapReady = false, focus = -1, collapsed = false, expanded = false;
  let base = null;  // OpenFreeMap's style, or null when it couldn't be loaded.
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
  const at = () => focus >= 0 ? cards[focus].key : '';

  // A phone's strip is too small a picture for the tint: only the country in view is drawn there.
  const strip = () => isPhone() && !expanded;
  const FILTERS = {
    'cm-visited': () => strip() ? NONE : ['!=', key, at()],
    'cm-visited-line': () => strip() ? NONE : ['!=', key, at()],
    'cm-visited-dot': () => strip() ? NONE : ['!=', key, at()],
    'cm-current': () => ['==', key, at()],
    'cm-current-line': () => ['==', key, at()],
    'cm-current-dot': () => ['==', key, at()],
  };

  function buildStyle() {
    const style = window.esTrack.basemapStyle(base, { cfg: CFG, tok, detail: expanded ? 'standard' : CFG.detail || 'minimal' });
    const cur = tok('current'), acc = tok('accent');
    const h = strip() ? .7 : 1;
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
    widget.classList.add('basemap-muted');
    return style;
  }

  function applyFilters() {
    if (mapReady) Object.keys(FILTERS).forEach(id => map.setFilter(id, FILTERS[id]()));
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

  // There's nothing to frame while the map has no size: collapsed to its caption. The corner map leaves room at the
  // top for its expand button.
  function frame(animate, world) {
    if (!mapReady) return;
    const box = map.getContainer();
    if (!box.clientWidth || !box.clientHeight) return;
    const padding = expanded ? (isPhone() ? 20 : 50) : isPhone() ? 6 : { top: 40, right: 10, bottom: 10, left: 10 };
    const k = world || focus < 0 ? '' : at();
    map.fitBounds(boundsFor(k), { padding, duration: animate ? 900 : 0, essential: true });
  }

  // ------------------------------------------------------------ caption
  // The country in view: its name and flag, and when I went. Before the first card, the tally.
  function caption() {
    const c = focus >= 0 ? cards[focus] : null;
    const line = (cls, t) => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = t;
      return el;
    };

    // Names come from the site, but are set as text all the same.
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
    ico.innerHTML = iconSvg('pin');
    text.replaceChildren(...lines);
    text.title = c && c.href ? `Open ${c.name}` : '';
  }

  // ------------------------------------------------------------ following the reader
  // The card that crosses the reading line, else the nearest one; -1 before the first card reaches the line.
  function focusIndex() {
    if (!cards.length) return -1;
    const line = innerHeight * FOCUS_LINE;
    if (cards[0].el.getBoundingClientRect().top > line) return -1;

    // At the foot of the page the last card may never reach the line.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) return cards.length - 1;
    let best = 0, bd = Infinity;
    cards.forEach((c, i) => {
      const r = c.el.getBoundingClientRect();
      const d = r.top > line ? r.top - line : r.bottom < line ? line - r.bottom : 0;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // On a phone, the strip has nothing to show before the first card is in view, so it fades out.
  function updateIdle() {
    widget.classList.toggle('is-idle', strip() && focus < 0);
  }

  function setFocus(i) {
    if (i === focus) return;
    focus = i;
    caption();
    applyFilters();
    updateIdle();
    frame(true);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      setFocus(focusIndex());
      updateOverlap();
    });
  }

  // Fade the widget while it sits over a cover photo, as on the park pages' map.
  function updateOverlap() {
    if (!CFG.dim || isPhone()) { widget.classList.remove('over-photo'); return; }
    const w = widget.getBoundingClientRect();
    let over = false;
    for (const c of cards) {
      const img = c.el.querySelector('.card-image img');
      if (!img) continue;
      const r = img.getBoundingClientRect();
      if (r.left < w.right && r.right > w.left && r.top < w.bottom && r.bottom > w.top) { over = true; break; }
    }
    widget.classList.toggle('over-photo', over);
  }

  function setCollapsed(v, remember) {
    collapsed = v;
    widget.classList.toggle('is-collapsed', v);
    collapseBtn.setAttribute('aria-expanded', String(!v));
    collapseBtn.setAttribute('aria-label', v ? 'Show map' : 'Collapse map');
    if (remember) { try { localStorage.setItem('es-track-collapsed', v ? '1' : '0'); } catch (e) { /* Private mode. */ } }
    if (mapReady) requestAnimationFrame(() => { map.resize(); frame(false); });
    updateOverlap();
  }

  // ------------------------------------------------------------ full-screen
  // The map opens full-screen in the theme's modal, as a park page's map does, and returns to the corner on close.
  const home = { parent: widget.parentNode, next: widget.nextSibling };

  function setInteractive(on) {
    ['scrollZoom', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'boxZoom'].forEach(h => { if (map[h]) on ? map[h].enable() : map[h].disable(); });
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.dragRotate.disable();
    map.touchPitch.disable();
  }

  function setExpanded(v) {
    if (v === expanded || !mapReady) return;
    expanded = v;
    caption();
    widget.classList.toggle('is-corner', !v);
    widget.classList.toggle('is-expanded', v);
    if (v) modal.appendChild(widget);
    else home.parent.insertBefore(widget, home.next);
    modal.hidden = !v;
    document.body.style.overflow = v ? 'hidden' : '';
    setInteractive(v);
    map.setStyle(buildStyle());
    requestAnimationFrame(() => {
      map.resize();
      frame(false);
    });
    updateOverlap();
    updateIdle();
  }

  // Full-screen, pointing at a visited country shows what it is, and clicking it closes the map at its card.
  function wireMap() {
    map.on('mousemove', 'cm-visited', e => {
      if (!expanded || !e.features.length) return;
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'cm-visited', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', e => {
      if (!expanded) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ['cm-visited', 'cm-current', 'cm-visited-dot', 'cm-current-dot'] })[0];
      const c = f && byKey.get(f.properties.key);
      if (!c) return;
      setExpanded(false);
      c.el.scrollIntoView({ block: 'center' });
    });
  }

  // ------------------------------------------------------------ controls
  // Clicking the corner map opens it full-screen; clicking its caption opens the country in view.
  widget.addEventListener('click', e => {
    if (expanded || e.target.closest('.es-track-attr-btn, .es-track-attr, .es-track-collapse')) return;
    if (collapsed) { setCollapsed(false, true); return; }
    const c = focus >= 0 ? cards[focus] : null;
    if (e.target.closest('.es-track-bar')) { if (c && c.href) location.href = c.href; return; }
    setExpanded(true);
  });
  attrBtn.addEventListener('click', e => { e.stopPropagation(); attrBtn.setAttribute('aria-expanded', String(attrBtn.getAttribute('aria-expanded') !== 'true')); });
  collapseBtn.addEventListener('click', e => { e.stopPropagation(); setCollapsed(!collapsed, true); });
  document.getElementById('es-track-expand').addEventListener('click', e => { e.stopPropagation(); setExpanded(true); });
  document.getElementById('es-track-close').addEventListener('click', e => { e.stopPropagation(); setExpanded(false); });
  document.getElementById('es-track-fit').addEventListener('click', e => { e.stopPropagation(); frame(true, true); });
  document.getElementById('es-track-zoom-in').addEventListener('click', e => { e.stopPropagation(); map.zoomIn(); });
  document.getElementById('es-track-zoom-out').addEventListener('click', e => { e.stopPropagation(); map.zoomOut(); });

  // Outside the map, or Escape, closes it.
  modal.addEventListener('click', e => { if (e.target === modal) setExpanded(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) setExpanded(false); });

  // ------------------------------------------------------------ boot
  async function loadShapes() {
    try {
      const r = await fetch(CFG.shapesUrl);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).shapes || {};
    } catch (e) {
      console.warn('countries-map: could not load the outlines', e);
      return {};
    }
  }

  async function start() {
    if (!cards.length) return;
    widget.hidden = false;
    try { const v = localStorage.getItem('es-track-collapsed'); collapsed = v === null ? (isPhone() && CFG.mobileCollapsed) : v === '1'; }
    catch (e) { collapsed = isPhone() && CFG.mobileCollapsed; }
    setCollapsed(collapsed, false);
    focus = focusIndex();
    caption();
    updateIdle();
    addEventListener('scroll', onScroll, { passive: true });

    // Turning a phone, or resizing a window, may move the map between the strip and the corner, which draw the
    // countries differently: the style is rebuilt when that happens.
    let phone = isPhone();
    addEventListener('resize', () => {
      onScroll();
      updateIdle();
      if (!mapReady) return;
      map.resize();
      if (phone !== isPhone()) { phone = isPhone(); map.setStyle(buildStyle()); }
      frame(false);
    });

    const [basemap, outlines] = await Promise.all([window.esTrack.loadBasemap(CFG, tok), loadShapes()]);
    base = basemap;
    shapes = outlines;
    if (!window.maplibregl) { showNotice('The map library could not be loaded.'); return; }
    if (!base) showNotice('Map tiles unavailable. Showing the countries alone.');

    // Interactive only full-screen: the corner map is a picture, and a click on it opens it.
    map = new maplibregl.Map({ container: 'es-track-canvas', style: buildStyle(), bounds: boundsFor(focus >= 0 ? at() : ''), attributionControl: false, fadeDuration: 0, maxZoom: 16, minZoom: 0.5 });
    setInteractive(false);
    wireMap();
    map.on('load', () => {
      mapReady = true;
      applyFilters();
      frame(false);
    });
    map.on('error', e => { const m = (e && e.error && e.error.message) || ''; if (m) console.warn('countries-map:', m); });
    onScroll();
  }

  start().catch(err => console.warn('countries-map:', err));
})();
