# Mode icons: where they come from and how to add one

Two icon sources are in play. Pick one for production; the other is here so nothing is lost.

| | Prototype (`static/prototype/corner-map.html`) | Production proposal (`TRACK-FORMAT.md` §1.2) |
|---|---|---|
| Source | Hand-drawn inline SVG, written for this prototype | Font Awesome, via the kit the theme already loads |
| Style | Line icons: stroke only, no fills | FA's solid style, matching the rest of the site |
| Adding a mode | Draw a glyph to the rules below and add it to the `ICONS` map | Add a name to the icon map in the theme's map partial |
| Trade-off | Bespoke, lighter visual weight, needs a drawing per mode | Zero drawing work, consistent with existing site icons, heavier weight |

The prototype's plane is a paper-plane silhouette in the same spirit as the "send" glyph found in Lucide, Feather, and similar sets; the rest are original. None are copied from a licensed set, so nothing here carries an attribution requirement.

## The hand-drawn set

Rules every glyph follows. Keep to them and a new icon sits beside the others without looking borrowed.

- **Canvas** `viewBox="0 0 24 24"`. Draw inside a 2-unit margin, so the live area is 20 × 20 centred at (12, 12).
- **Stroke** `stroke-width="1.8"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `stroke="currentColor"`, `fill="none"`. The colour comes from the caption, so never hard-code one.
- **Shapes** Prefer a few strokes over many. Circles for wheels and heads (`r` between 1.6 and 2.3), rounded rectangles for bodies (`rx="2"`), single paths for limbs, wings, hulls. No filled areas, no gradients, no text.
- **Weight** Aim for the same amount of ink as the car: roughly four to six strokes. A glyph with much more looks dark next to its neighbours at the 20 px size the caption uses.
- **Recognisability at 20 px** The icon is rendered at 1.25 rem. Test it there, not at 200 px. Detail that disappears at that size should not be drawn.
- **Orientation** Vehicles face right, the direction of reading. People face right.
- **Motion cue** None. The caption text says what the mode is; the icon only has to be scannable.

### Existing glyphs

Each is the inner markup of the `<svg>`; the wrapper is applied by `iconSvg()` in the prototype.

| Mode token | Key in `ICONS` | Markup |
|---|---|---|
| `drive` | `car` | `<path d="M5 11l1.6-4.2A1.5 1.5 0 0 1 8 6h8a1.5 1.5 0 0 1 1.4.8L19 11"/><path d="M3 17v-4.5A1.5 1.5 0 0 1 4.5 11h15a1.5 1.5 0 0 1 1.5 1.5V17h-2.5M3 17h2.5M9 17h6"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>` |
| `walk` | `walk` | `<circle cx="13" cy="4" r="1.8"/><path d="M12 7.5l-1.5 6 3.5 3 1 5"/><path d="M10.5 13.5l-3 6.5"/><path d="M12 7.5l3 2.5 2.5 1"/><path d="M12 7.5l-3.5 1.5-1 3.5"/>` |
| `cable` | `cable` | `<path d="M2 7l20-4"/><path d="M12 5v4"/><rect x="6.5" y="9" width="11" height="10" rx="2"/><path d="M6.5 13.5h11"/><path d="M12 9v10"/>` |
| `fly` | `plane` | `<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-3.5-8.5L2.5 9z"/>` |
| `boat` | `boat` | `<path d="M3 18c1.5 1.5 3.5 1.5 5 0 1.5 1.5 3.5 1.5 5 0 1.5 1.5 3.5 1.5 5 0 1 1 2 1.3 3 1"/><path d="M4 15.5l1.5-5.5h13l1.5 5.5"/><path d="M12 10V4h4.5L12 7.5"/>` |
| `stop` | `pin` | `<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>` |

Modes in the vocabulary with no hand-drawn glyph yet: `hike`, `bike`, `run`, `bus`, `train`. They fall back to an empty icon in the prototype.

### Adding one to the prototype

1. Draw the glyph to the rules above. A quick way to iterate: paste the markup into a scratch HTML file inside `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f2a65a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">…</svg>` next to the car, and adjust until the weights match.
2. Add it to `ICONS` (key is the glyph name).
3. Add the mode to `MODES` with its display name and the glyph key: `bike: { name: 'Cycling', icon: 'bike' }`.
4. If the mode is a ride whose leg should draw dashed, add its token to the `mode-ride` filter in `ourLayers()`.

## The Font Awesome mapping

For production this is the whole job: one entry per mode token. Names are FA 6 solid.

| Mode | Icon |
|---|---|
| `drive` | `fa-car` |
| `walk` | `fa-person-walking` |
| `hike` | `fa-person-hiking` |
| `bike` | `fa-bicycle` |
| `run` | `fa-person-running` |
| `bus` | `fa-bus` |
| `train` | `fa-train` |
| `cable` | `fa-cable-car` |
| `boat` | `fa-ship` |
| `fly` | `fa-plane` |
| `stop` | `fa-location-dot` |
| unknown token | `fa-route` |

Two things to check when the theme partial is built: that the kit's plan includes these solid icons (all are in the free set), and that the caption sizes them with `font-size` rather than a fixed pixel height so they track the text.

## Waysmith

Waysmith uses SF Symbols (`RouteProfile.sfSymbol`: `car.fill`, `bicycle`, `figure.hiking`, `airplane`). The leg-editing proposal extends that map for the SEGMENTS panel; it's a third, independent icon set, appropriate for a native Mac app, and doesn't need to match the web ones.
