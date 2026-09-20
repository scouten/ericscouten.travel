# Track legs: GPX authoring convention and the derived track JSON

Status: proposal, v1. Consumed by zola-es-theme; authored in Waysmith; stored on the image CDN.

Two representations, one source of truth:

| | Purpose | Written by | Read by |
|---|---|---|---|
| **GPX** (`*.gpx`) | Archival, editable source of truth. Carries the legs. | Waysmith (Save) | Waysmith, any GPX tool |
| **Track JSON** (`*.json`) | Compact, display-ready derivative. | Waysmith (Export) or a script | zola-es-theme in the browser |

The JSON is always regenerable from the GPX plus the photo list. Nothing is hand-edited in JSON.

---

## 1. GPX authoring convention

Plain GPX 1.1. No custom namespace is required for the core model; one optional extension element is defined in §1.4.

### 1.1 Legs are tracks

A day is a sequence of **legs**, each written as one `<trk>` in chronological order. A leg is a stretch of the day with one mode of travel, or a stop.

```xml
<trk>
  <name>Simon’s Town → Cape Point</name>
  <type>drive</type>
  <trkseg> …trkpt… </trkseg>
</trk>
<trk>
  <name>Cape Point</name>
  <type>stop</type>
  <trkseg> …trkpt… </trkseg>
</trk>
```

- `<name>` is the label shown in the widget caption. Free text. Optional; when absent the display falls back to the leg's local time range.
- `<type>` is the mode token (§1.2). Optional; when absent the leg is shown without a mode icon.
- A leg may contain several `<trkseg>` elements (a brief signal dropout inside one drive). Segments within a track are drawn as one leg; the gap between them is not a stop.
- Files that predate this convention (one unnamed, untyped track) remain valid. See §3.4 for how they degrade.

### 1.2 Mode vocabulary

| `<type>` | Meaning | Icon (Font Awesome) |
|---|---|---|
| `drive` | Car, taxi, any road vehicle you were riding in | `fa-car` |
| `walk` | On foot, urban or beach | `fa-person-walking` |
| `hike` | On foot, trail | `fa-person-hiking` |
| `bike` | Bicycle | `fa-bicycle` |
| `run` | Running | `fa-person-running` |
| `bus` | Bus or coach | `fa-bus` |
| `train` | Rail of any kind, including metro and tram | `fa-train` |
| `cable` | Cable car, gondola, funicular, chairlift | `fa-cable-car` |
| `boat` | Ferry, boat, ship | `fa-ship` |
| `fly` | Aircraft | `fa-plane` |
| `stop` | Not travelling: a visit, a meal, a viewpoint | `fa-location-dot` |

Unknown tokens are preserved and shown with a generic icon. New tokens are added here and in the theme's icon map.

### 1.3 Stops

A stop is a leg with `<type>stop</type>`. Its points are whatever was recorded while stationary, which may be a single point when the logger paused, or a small cloud of GPS wander. Consumers use the stop's time span and the centroid of its points; the wander is never drawn.

A stop is the unit that photo clusters attach to ("Cape Point · 10 min"), so name stops as places. A stop may be as short as you like; the converter's own threshold for *inferring* a stop is 3 minutes, but an explicit `<type>stop</type>` is always honored.

### 1.4 Optional extension: origin of a leg

Waysmith reconstructs legs the logger missed (flights, tunnels, dead batteries). The display draws reconstructed legs differently from recorded ones, so the GPX records where a leg came from:

```xml
<trk>
  <name>Seattle → Amsterdam</name>
  <type>fly</type>
  <extensions>
    <ws:origin xmlns:ws="https://waysmith.app/gpx/1">synthesized</ws:origin>
  </extensions>
  <trkseg>…</trkseg>
</trk>
```

Values: `recorded` (default when absent), `routed` (replaced by a routing service), `synthesized` (generated, e.g. smooth flight path or great-circle). Anything else is treated as `recorded`.

### 1.5 Waypoints

`<wpt>` elements are passed through untouched. The logger's `Start` and `End` waypoints are ignored by the converter. Named waypoints are reserved for a later "points of interest along a leg" feature and are not interpreted in v1.

### 1.6 Metadata

`<metadata><name>` and `<metadata><time>` are passed through to the JSON as `name` and `start` when present. No other metadata is required.

---

## 2. Track JSON v1

One file per page. Served from the CDN under `track/v1/YYYY/MM/<date>.json`, gzip-encoded by the CDN, next to the GPX it was derived from.

```json
{
  "v": 1,
  "src": "2026-03-05.gpx",
  "name": "2026-03-05T10:18:42",
  "tz": "Africa/Johannesburg",
  "start": "2026-03-05T08:18:42Z",
  "end": "2026-03-05T18:11:50Z",
  "dist_m": 167100,
  "bbox": [18.4023, -34.3571, 18.4747, -33.8996],
  "legs": [
    {
      "mode": "drive",
      "label": "Cape Town → Muizenberg",
      "origin": "recorded",
      "start": "2026-03-05T08:18:42Z",
      "end": "2026-03-05T09:12:57Z",
      "off": 120,
      "dist_m": 35700,
      "dur_s": 3255,
      "ele": [5, 140],
      "pts": [[18.41206, -33.89974, 0, 6], [18.41177, -33.89978, 101, 12]]
    },
    {
      "mode": "stop",
      "label": "Muizenberg",
      "start": "2026-03-05T09:25:31Z",
      "end": "2026-03-05T09:29:00Z",
      "off": 120,
      "dist_m": 0,
      "dur_s": 209,
      "pts": [[18.4321, -34.13599, 0, 7]]
    }
  ],
  "photos": [
    { "id": "lr-263-7376", "t": "2026-03-05T09:26:10Z", "leg": 1, "i": 0, "f": 0.2138 }
  ]
}
```

### 2.1 Top level

| Field | Type | Notes |
|---|---|---|
| `v` | int | Format version. Consumers refuse files with a major version they don't know. |
| `src` | string | Basename of the GPX this was derived from. Informational. |
| `name` | string? | From `<metadata><name>`. |
| `tz` | string | IANA zone at the track's first point (Waysmith's `tz_name_at`). Used for display when a leg has no `off`. |
| `start`, `end` | RFC 3339 UTC | Whole-day span. |
| `dist_m` | int | Sum of moving legs, metres. Stops contribute 0. Replaces the hand-typed `distance` in front matter when that is absent. |
| `bbox` | [minLon, minLat, maxLon, maxLat] | Of all points. Replaces the hand-typed `bounds` in front matter when that is absent. |
| `legs` | array | In chronological order. See §2.2. |
| `photos` | array? | Optional photo anchors. See §2.3. |

### 2.2 Legs

| Field | Type | Notes |
|---|---|---|
| `mode` | string? | Token from §1.2, or absent when the GPX had no `<type>`. |
| `label` | string? | From `<name>`. |
| `origin` | string? | From §1.4. Absent means `recorded`. |
| `start`, `end` | RFC 3339 UTC | Leg time span. Absent when the GPX had no timestamps. |
| `off` | int? | Local UTC offset in minutes at the leg's start, for caption times. A day that crosses a zone boundary gets a different `off` per leg. |
| `dist_m` | int | Metres along the (unsimplified) leg. 0 for stops. |
| `dur_s` | int? | Seconds between `start` and `end`. |
| `ele` | [min, max]? | Metres. Present when elevation was recorded. |
| `pts` | array of [lon, lat, t, ele] | Simplified geometry. `lon`, `lat` to 5 decimals (about 1 m). `t` is whole seconds since the leg's `start`, or `null` when untimed. `ele` is whole metres or `null`. Trailing `null`s may be omitted, so an untimed, unelevated point is `[lon, lat]`. |

Simplification is Ramer–Douglas–Peucker with a 6 m cross-track tolerance on moving legs. That keeps a full day under about 1,500 points. A stop is reduced to one point at the centroid of its recorded points, with `t` 0.

### 2.3 Photo anchors

Produced when the exporter knows the photo capture times, which Waysmith does when media were loaded into the document. Keyed by the same `id` used in `markers.js` and the `es_cdn_image` shortcodes.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Photo or video id. |
| `t` | RFC 3339 UTC? | Capture time, when known. |
| `leg` | int | Index into `legs`. |
| `i` | int | Index into that leg's `pts` of the point at or before the photo. |
| `f` | number | Fraction of the day's `dist_m` travelled at the photo, 0 to 1. Drives the progress bar and the traveled-portion gradient. |

When `photos` is absent, or a photo id is missing from it, the theme falls back to the forward-constrained nearest-point rule: snap each photo, in page order, to the nearest track point at or after the previous photo's point. That works without timestamps and handles out-and-back roads.

### 2.4 Size budget

The reference day (5,964 GPX points, 857 KB) becomes about 1,100 points and 30 KB before gzip. A page should stay under 100 KB of track JSON; a multi-day flight track that exceeds it should use a larger simplification tolerance for the flight legs.

---

## 3. How each tool uses this

### 3.1 Waysmith

Needed, in dependency order:

1. **Model and GPX round-trip.** Add `type: Option<String>` and `origin: Option<String>` to `Track`; parse and serialize `<trk><type>` and the `ws:origin` extension; pass `<wpt>` through (already a TODO). Existing files are unaffected: untyped tracks stay untyped.
2. **Leg editing.** Split the current track at the focused point (the point starts the new track); join with previous; set name and type from the SEGMENTS panel. Fix Route and Smooth Flight Path set `origin` on the leg they produce.
3. **Suggest legs.** A core function that proposes a split of an untyped track into typed legs from speed, dwell, and climb rate. The reference implementation is `gpx2track.py` in this folder: smooth speed over ±20 s, classify each point (stop < 1.5 km/h, walk < 8, cable when horizontal < 35 km/h and vertical > 40 m/min, fly > 200), absorb runs under 150 s (60 s for cable and fly, 180 s for stop), then promote a stop with more than 400 m of wandering to a walk. On the reference day it produced 15 of 16 legs correctly. Present it through the existing proposal / confirm pattern.
4. **Export track JSON.** Serialize §2 from the document plus loaded media items. This is where photo anchors come from.

### 3.2 zola-es-theme

- A new map partial reads one track JSON and the page's photo list, renders the corner widget, the docking slot, and the expanded view, and draws legs by mode and origin. It never reads GPX or KML.
- Icon map for §1.2 tokens, using the Font Awesome kit already loaded.
- The existing Google/KML template stays until every site has migrated, selected by config.

### 3.3 ericscouten.travel front matter

```toml
[extra]
track = "track/v1/2026/03/2026-03-05.json"   # replaces track_log_key
gpx = "gpx/v1/2026/03/2026-03-05.gpx"         # optional: archival link for a "download GPX" affordance
distance = "167 km / 104 mi"                  # optional: overrides the JSON's dist_m
bounds = { … }                                # optional: overrides the JSON's bbox
markers = "markers.js"                        # unchanged for now; ids must match photo anchors
```

Per-page leg overrides are deliberately **not** in front matter. Legs are edited in Waysmith and saved in the GPX, so the GPX stays the single place where a day's structure lives.

### 3.4 Degradation for un-retrofitted files

A GPX with one unnamed, untyped track (every file today) converts to a JSON with one leg, no `mode`, no `label`. The widget draws the route and the traveled portion, shows the local time range as the caption, and anchors photos by the nearest-point rule. Retrofitting a page means opening the GPX in Waysmith, accepting or correcting suggested legs, saving, exporting, and uploading.

A KML with only coordinates converts the same way, minus times: no `start`, `end`, `dur_s`, or `off`, and `t` is `null` on every point.

---

## 4. Open questions

1. Should `hike` and `walk` stay distinct, or is one on-foot token enough?
2. Is a "download GPX" link on the page wanted? If not, `gpx` in front matter can be dropped.
3. Photo anchors could alternatively be produced by the Lightroom-to-CDN export that writes `markers.js`, if that pipeline can read the track JSON. Waysmith is the simpler home because it already has both the track and the media timestamps.
