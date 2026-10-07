/* corner-map.js — what the site's corner maps share: the widget around the map, and the map's life on the page.
 *
 * The countries page (countries-map.js) and the country and state pages (place-map.js) are each a corner map built on
 * the theme's track map (themes/zola-es-theme/docs/track-map.md): the same widget markup and styles, and the basemap from
 * track-common.js. This script runs everything that doesn't depend on what the map shows:
 *   - following the reader: the card that crosses the reading line is the one in view
 *   - the widget: collapsing it, fading it over a cover photo, and opening it full-screen in the theme's modal
 *   - the buttons, the keyboard, and the window's resizing
 *   - starting up: the basemap and the page's own data load together, then the map is made
 * A page's script makes a map with `esCornerMap.create(options)`, which returns the map's controller, then calls
 * `start()` on that. The options:
 *   cfg            the page's config JSON (basemap options, `dim`, `mobileCollapsed`)
 *   cards          the cards in page order, each with `el`, its element
 *   load()         async; loads the page's own data, and returns once it's ready
 *   bounds()       the bounds to start on, or null when there's nothing to show
 *   buildStyle()   the style for the map as it is now (corner or full-screen), from `ctl.basemapStyle()`
 *   frame(animate, world)   fits the view to what's to be seen (the whole of it, for `world`), using `ctl.fitTo()`
 *   idle()         whether the corner map should fade away
 *   onFocus(i)     the card in view has changed to `i` (-1 before the first); also called once at the start
 *   barHref()      where clicking the caption goes, or ''
 *   wire()         adds the page's own handlers to `ctl.map`
 *   onReady()      the map has loaded
 *   onExpanded(v)  the map is about to open (or close) full-screen
 *   afterLayout()  the map has been resized and reframed
 *   noTiles        the notice for a basemap that couldn't be loaded
 * The controller has `map`, `mapReady`, `focus`, `expanded`, `collapsed`, and `base` (the stock basemap style, or null),
 * and the helpers below.
 */
(function () {
  'use strict';

  const widget = document.getElementById('es-track-widget');
  if (!widget || !window.esTrack) return;
  const { iconSvg, isPhone } = window.esTrack;

  // The reading line, as a fraction of the window's height: the card that crosses it is the one in view.
  const FOCUS_LINE = 0.4;

  const tok = n => getComputedStyle(widget).getPropertyValue('--es-track-' + n).trim();
  const notice = document.getElementById('es-track-notice');
  const ico = document.getElementById('es-track-ico');
  const text = document.getElementById('es-track-text');
  const collapseBtn = document.getElementById('es-track-collapse');
  const attrBtn = document.getElementById('es-track-attr-btn');
  const modal = document.getElementById('es-track-modal');

  function create(opts) {
    const { cfg, cards } = opts;
    let map = null, mapReady = false, focus = -1, collapsed = false, expanded = false, base = null;

    // The widget goes back where it came from when the map closes.
    const home = { parent: widget.parentNode, next: widget.nextSibling };

    const ctl = {
      get map() { return map; },
      get mapReady() { return mapReady; },
      get focus() { return focus; },
      get expanded() { return expanded; },
      get collapsed() { return collapsed; },
      get base() { return base; },
      cfg,
      cards,
      tok,
      isPhone,
      widget,
      setExpanded,
      updateIdle,
      updateOverlap,
      start,

      // A phone's strip is a small picture of its place, so pages draw less on it.
      strip: () => isPhone() && !expanded,
      showNotice(msg) { notice.textContent = msg || ''; notice.hidden = !msg; },

      // A fresh style from the stock basemap, at the site's detail (full-screen, the full basemap).
      basemapStyle() {
        return window.esTrack.basemapStyle(base, { cfg, tok, detail: expanded ? 'standard' : cfg.detail || 'minimal' });
      },

      // A span with a class, for the caption's lines; names come from the site, but are set as text all the same.
      line(cls, t) {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = t;
        return el;
      },

      // The caption: an icon, and its lines.
      setCaption(icon, lines, title) {
        ico.innerHTML = iconSvg(icon);
        text.replaceChildren(...lines.filter(Boolean));
        text.title = title || '';
      },

      // Fits the view to `bounds`. There's nothing to frame while the map has no size: collapsed to its caption. The
      // corner map leaves room at the top for its expand button.
      fitTo(bounds, animate, ms) {
        if (!mapReady || !bounds) return;
        const box = map.getContainer();
        if (!box.clientWidth || !box.clientHeight) return;
        const padding = expanded ? (isPhone() ? 20 : 50) : isPhone() ? 6 : { top: 40, right: 10, bottom: 10, left: 10 };
        map.fitBounds(bounds, { padding, duration: animate ? ms : 0, essential: true });
      },
    };

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

    // The corner map fades away when the page says there's nothing for it to show.
    function updateIdle() {
      widget.classList.toggle('is-idle', !expanded && opts.idle());
    }

    function setFocus(i) {
      if (i === focus) return;
      focus = i;
      opts.onFocus(i);
      updateIdle();
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
      if (!cfg.dim || isPhone()) { widget.classList.remove('over-photo'); return; }
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

    // ------------------------------------------------------------ the widget
    function layout() {
      map.resize();
      opts.frame(false);
      if (opts.afterLayout) opts.afterLayout();
    }

    function setCollapsed(v, remember) {
      collapsed = v;
      widget.classList.toggle('is-collapsed', v);
      collapseBtn.setAttribute('aria-expanded', String(!v));
      collapseBtn.setAttribute('aria-label', v ? 'Show map' : 'Collapse map');
      if (remember) { try { localStorage.setItem('es-track-collapsed', v ? '1' : '0'); } catch (e) { /* Private mode. */ } }
      if (mapReady) requestAnimationFrame(layout);
      updateOverlap();
    }

    function setInteractive(on) {
      ['scrollZoom', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'boxZoom'].forEach(h => { if (map[h]) on ? map[h].enable() : map[h].disable(); });
      if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
      map.dragRotate.disable();
      map.touchPitch.disable();
    }

    // The map opens full-screen in the theme's modal, as a park page's map does, and returns to the corner on close.
    function setExpanded(v) {
      if (v === expanded || !mapReady) return;
      expanded = v;
      if (opts.onExpanded) opts.onExpanded(v);
      widget.classList.toggle('is-corner', !v);
      widget.classList.toggle('is-expanded', v);
      if (v) modal.appendChild(widget);
      else home.parent.insertBefore(widget, home.next);
      modal.hidden = !v;
      document.body.style.overflow = v ? 'hidden' : '';
      setInteractive(v);
      map.setStyle(opts.buildStyle());
      requestAnimationFrame(layout);
      updateOverlap();
      updateIdle();
    }

    // ------------------------------------------------------------ controls
    // Clicking the corner map opens it full-screen; clicking its caption goes to what the page says.
    widget.addEventListener('click', e => {
      if (expanded || e.target.closest('.es-track-attr-btn, .es-track-attr, .es-track-collapse')) return;
      if (collapsed) { setCollapsed(false, true); return; }
      if (e.target.closest('.es-track-bar')) { const href = opts.barHref(); if (href) location.href = href; return; }
      setExpanded(true);
    });
    const press = (id, fn) => document.getElementById(id).addEventListener('click', e => { e.stopPropagation(); fn(); });
    attrBtn.addEventListener('click', e => { e.stopPropagation(); attrBtn.setAttribute('aria-expanded', String(attrBtn.getAttribute('aria-expanded') !== 'true')); });
    collapseBtn.addEventListener('click', e => { e.stopPropagation(); setCollapsed(!collapsed, true); });
    press('es-track-expand', () => setExpanded(true));
    press('es-track-close', () => setExpanded(false));
    press('es-track-fit', () => opts.frame(true, true));
    press('es-track-zoom-in', () => map.zoomIn());
    press('es-track-zoom-out', () => map.zoomOut());

    // Outside the map, or Escape, closes it.
    modal.addEventListener('click', e => { if (e.target === modal) setExpanded(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) setExpanded(false); });

    // ------------------------------------------------------------ start
    async function start() {
      widget.hidden = false;
      try { const v = localStorage.getItem('es-track-collapsed'); collapsed = v === null ? (isPhone() && cfg.mobileCollapsed) : v === '1'; }
      catch (e) { collapsed = isPhone() && cfg.mobileCollapsed; }
      setCollapsed(collapsed, false);
      focus = focusIndex();
      opts.onFocus(focus);
      updateIdle();
      addEventListener('scroll', onScroll, { passive: true });

      // Turning a phone, or resizing a window, may move the map between the strip and the corner, which draw things
      // differently: the style is rebuilt when that happens.
      let phone = isPhone();
      addEventListener('resize', () => {
        onScroll();
        updateIdle();
        if (!mapReady) return;
        map.resize();
        if (phone !== isPhone()) { phone = isPhone(); map.setStyle(opts.buildStyle()); }
        opts.frame(false);
        if (opts.afterLayout) opts.afterLayout();
      });

      const [basemap] = await Promise.all([window.esTrack.loadBasemap(cfg, tok), opts.load()]);
      base = basemap;
      const bounds = opts.bounds();
      if (!window.maplibregl) { ctl.showNotice('The map library could not be loaded.'); return; }
      if (!bounds) return;
      if (!base) ctl.showNotice(opts.noTiles);

      // Interactive only full-screen: the corner map is a picture, and a click on it opens it.
      map = new maplibregl.Map({ container: 'es-track-canvas', style: opts.buildStyle(), bounds, attributionControl: false, fadeDuration: 0, maxZoom: 16, minZoom: 0.5 });
      setInteractive(false);
      opts.wire();
      map.on('load', () => {
        mapReady = true;
        if (opts.onReady) opts.onReady();
        opts.frame(false);
        if (opts.afterLayout) opts.afterLayout();
      });
      map.on('error', e => { const m = (e && e.error && e.error.message) || ''; if (m) console.warn('corner-map:', m); });
      onScroll();
    }

    return ctl;
  }

  window.esCornerMap = { create };
})();
