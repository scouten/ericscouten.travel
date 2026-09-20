# Track legs: GPX authoring convention and the derived track JSON

Status: proposal, v1. Authored in Waysmith; published to the image CDN; consumed by zola-es-theme.

Two representations, one source of truth:

| | Purpose | Written by | Read by | Published? |
|---|---|---|---|---|
| **GPX** (`*.gpx`) | Archival, editable source of truth. Carries timestamps and the legs. | Waysmith (Save) | Waysmith, any GPX tool | **No.** Stays private. |
| **Track JSON** (`*.json`) | Compact, display-ready derivative. Carries no clock times. | Waysmith (Export) or a script | zola-es-theme in the browser | Yes, on the CDN |

The JSON is always regenerable from the GPX plus the photo list. Nothing is hand-edited in JSON. The CDN toolchain produces it; Waysmith never writes JSON.

## 0. Privacy rule

Nothing public shows or ships a clock time. The JSON has no start or end instants, no per-point times, and no time zone. The only time-derived value it carries is a **duration**, and only on `fly` and `boat` legs, so a caption can read "Flying · ATL → CPT · 14 h 15 min". Stops and other legs are described by place, mode, and distance only.

The GPX keeps everything (it is what makes editing and re-export possible) and is never uploaded to a public location.

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

- `<name>` is the label shown in the widget caption. Free text. Optional; when absent the caption shows the mode and distance alone.
- `<type>` is the mode token (§1.2). Optional; when absent the leg is shown without a mode icon.
- A leg may contain several `<trkseg>` elements (a brief signal dropout inside one drive). Segments within a track are drawn as one leg; the gap between them is not a stop.
- Consecutive legs abut: the boundary point is the last point of one leg and the first point of the next. Consumers de-duplicate it.
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

A stop is a leg with `<type>stop</type>`. Its points are whatever was recorded while stationary, which may be a single point when the logger paused, or a small cloud of GPS wander. Consumers use the centroid of its points; the wander is never drawn.

A stop is the unit that photo clusters attach to ("Cape Point"), so name stops as places. A stop may be as short as you like; the converter's own threshold for *inferring* a stop is 3 minutes, but an explicit `<type>stop</type>` is always honored.

### 1.4 Optional extension: origin of a leg

Waysmith reconstructs legs the logger missed (flights, tunnels, dead batteries). The display draws reconstructed legs differently from recorded ones, so the GPX records where a leg came from:

```xml
<trk>
  <name>ATL → CPT</name>
  <type>fly</type>
  <extensions>
    <ws:origin xmlns:ws="https://waysmith.app/gpx/1">synthesized</ws:origin>
  </extensions>
  <trkseg>…</trkseg>
</trk>
```

Values: `recorded` (default when absent), `routed` (replaced by a routing service), `synthesized` (generated, e.g. smooth flight path or great-circle). Anything else is treated as `recorded`. Origin is per leg: a route fix inside a drive does not change the drive's origin; a leg that is entirely reconstructed is marked.

### 1.5 Waypoints

`<wpt>` elements are passed through untouched. The logger's `Start` and `End` waypoints are ignored by the converter. Named waypoints are reserved for a later "points of interest along a leg" feature and are not interpreted in v1.

### 1.6 Metadata

`<metadata><name>` is passed through to the JSON as `name` when it is not a timestamp-shaped string (the logger's default name is one, and is dropped). `<metadata><time>` is never exported.

---

## 2. Track JSON v1

One file per page. Served from the CDN under `track/v2/YYYY/MM/<date>.json`, gzip-encoded by the CDN. The GPX it was derived from stays private.

Two version numbers, deliberately separate:

- The **CDN path** (`kml/v1/…` today, `track/v2/…` for this format) marks the pipeline generation. Once the retrofit is complete, everything under `v1` is what can be deleted.
- The **`v` field** inside the JSON is the schema version consumers check. It starts at 1 and only changes when the JSON shape changes incompatibly.

```json
{
  "v": 1,
  "dist_m": 166100,
  "bbox": [18.4023, -34.3571, 18.4747, -33.8996],
  "legs": [
    {
      "mode": "drive",
      "label": "Cape Town → Muizenberg",
      "dist_m": 35700,
      "ele": [5, 140],
      "pts": [[18.41206, -33.89974, 6], [18.41177, -33.89978, 12]]
    },
    {
      "mode": "stop",
      "label": "Muizenberg",
      "dist_m": 0,
      "pts": [[18.4321, -34.13599]]
    },
    {
      "mode": "fly",
      "label": "ATL → CPT",
      "origin": "synthesized",
      "dist_m": 13580000,
      "dur_s": 51300,
      "pts": [[-84.4281, 33.6407], [18.6021, -33.9715]]
    }
  ],
  "photos": [
    { "id": "lr-263-7376", "leg": 1, "i": 0, "f": 0.2138 }
  ]
}
```

### 2.1 Top level

| Field | Type | Notes |
|---|---|---|
| `v` | int | Format version. Consumers refuse files with a major version they don't know. |
| `name` | string? | From `<metadata><name>`, when it is a real title. |
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
| `dist_m` | int | Metres along the (unsimplified) leg. 0 for stops. |
| `dur_s` | int? | **Only on `fly` and `boat` legs.** Seconds. Omitted everywhere else. |
| `ele` | [min, max]? | Metres. Present when elevation was recorded. Omitted on stops. |
| `pts` | array of [lon, lat, ele?] | Simplified geometry. `lon`, `lat` to 5 decimals (about 1 m). `ele` is whole metres; omitted when unknown. |

Simplification is Ramer–Douglas–Peucker with a 6 m cross-track tolerance on moving legs. That keeps a full day under about 1,500 points. A stop is reduced to one point at the centroid of its recorded points.

### 2.3 Photo anchors

Produced when the exporter knows the photo capture times, which Waysmith does when media were loaded into the document. The times are used at export and never written. Keyed by the same `id` used in `markers.js` and the `es_cdn_image` shortcodes.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Photo or video id. |
| `leg` | int | Index into `legs`. |
| `i` | int | Index into that leg's `pts` of the point at or before the photo. |
| `f` | number | Fraction of the day's `dist_m` travelled at the photo, 0 to 1. Drives the progress bar and the traveled-portion gradient. |

When `photos` is absent, or a photo id is missing from it, the theme falls back to the forward-constrained nearest-point rule: snap each photo, in page order, to the nearest track point at or after the previous photo's point. That works without timestamps and handles out-and-back roads.

### 2.4 Caption rules (what the reader sees)

| Leg | Caption |
|---|---|
| Moving leg with a label | `Driving · 36 km` over `Cape Town → Muizenberg` |
| Moving leg without a label | `Driving · 36 km` |
| `fly` or `boat` leg | `Flying · ATL → CPT · 14 h 15 min` |
| Stop | `Cape Point` with the pin icon |
| Reconstructed leg (`origin` not `recorded`) | Same text; the line is drawn dashed |

Progress reads as distance: `36 km of 167 km`.

### 2.5 Size budget

The reference day (5,964 GPX points, 857 KB) becomes about 1,100 points and 27 KB before gzip. A page should stay under 100 KB of track JSON; a multi-day flight track that exceeds it should use a larger simplification tolerance for the flight legs.

---

## 3. How each tool uses this

### 3.1 Waysmith (authoring)

Waysmith is where legs are made and stays a pure GPX editor. Proposed in `docs/trip-legs.md` on the Waysmith repo, in dependency order:

1. **Model and GPX round-trip.** `type` and `origin` on `Track`; parse and serialize `<trk><type>` and the `ws:origin` extension; pass `<wpt>` through.
2. **Leg editing.** Split the current track at the focused point; join with previous; set name and type from the SEGMENTS panel.
3. **Suggest legs.** Propose typed legs from speed, dwell, and climb rate through the existing proposal / confirm pattern.

Waysmith does not export JSON. The sanitized GPX it saves is the hand-off to the CDN toolchain.

### 3.1a CDN toolchain (publishing)

Today the toolchain converts GPX to KML, strips timestamps, and uploads. It becomes the GPX-to-JSON step instead. Reference implementation: `gpx2track.py` in this folder, whose behaviour is the specification:

| Input | Output |
|---|---|
| Sanitized GPX from Waysmith (private, timestamps intact) | `track/v2/YYYY/MM/<date>.json` on the CDN, per §2 |
| Photo manifest for the page: `[{"id": "es-263-9512", "time": "2026-03-05T10:20:00Z"}, …]`, ids matching `markers.js` | `photos` anchors in the same JSON, per §2.3 |

Rules:

- **Legs present in the GPX win.** If the file has more than one `<trk>`, or any `<trk><type>`, each track becomes one leg verbatim. Nothing is inferred and nothing is re-split.
- **Legacy files are inferred.** One untyped track (every existing sanitized file) is split by the heuristic in §3.1 item 3 so an un-retrofitted page still gets legs. The result is a best effort, not authoritative; the page is retrofitted by editing legs in Waysmith and re-running the toolchain.
- **Never emit clock times** (§0). The GPX is not uploaded; KML is no longer produced.
- **Photo capture times** come from the toolchain's own EXIF read (it already has the photos). Photos without a usable time are omitted from `photos`; the site falls back to nearest-point snapping for them.
- **Idempotent.** Re-running on unchanged inputs produces byte-identical JSON.

### 3.2 zola-es-theme

**The existing Google Maps / KML map keeps working, unchanged, for as long as the transition takes.** Selection is per page, not per site:

| Page front matter | Map shown |
|---|---|
| `track = "track/v2/…json"` | New corner map (this design). |
| `track_log_key = "kml/v1/…kml"` and no `track` | Existing Google map, exactly as today. |
| `markers` only, no track of either kind | Existing Google map with markers, as today (65 pages). Later: optionally the new map with photo dots and no route. |
| `lat` / `lon` only | Existing Google map, as today (used by other sites on the theme). |

Concretely:

- The current `map.html` is untouched. A new partial (`map_track.html`) is included by `page.html` only when `page.extra.track` is set; otherwise `map.html` runs as before. No existing page changes behaviour until its front matter changes.
- The new partial reads one track JSON and the page's photo list, renders the corner widget, the docking slot, and the expanded view, and draws legs by mode and origin. It never reads GPX or KML.
- Icon map for §1.2 tokens, using the Font Awesome kit already loaded.
- Site-level config: `extra.track_map = true` enables the new partial at all (so 146parks.blog and ericscouten.dev see no change until opted in), plus basemap style choices.
- The Google API key and the `GOOGLE_API_KEY` environment lookup stay in place until the last page has migrated, at which point removing `map.html` is a separate, deliberate change.

### 3.3 ericscouten.travel front matter

```toml
[extra]
track = "track/v2/2026/03/2026-03-05.json"   # presence of this key selects the new map
track_log_key = "kml/v1/2026/03/2026-03-05.kml"  # may stay during transition; ignored once `track` is set
distance = "167 km / 104 mi"                  # optional: overrides the JSON's dist_m
bounds = { … }                                # optional: overrides the JSON's bbox
markers = "markers.js"                        # unchanged; ids must match photo anchors
```

Migrating a page is one front-matter edit after the JSON is on the CDN. Reverting a page is deleting that one line. Pages are migrated in whatever order and at whatever pace suits; nothing forces a bulk change.

Per-page leg overrides are deliberately **not** in front matter. Legs are edited in Waysmith and saved in the GPX, so the GPX stays the single place where a day's structure lives.

### 3.4 Degradation for un-retrofitted files

A GPX with one unnamed, untyped track (every file today) converts to a JSON with one leg, no `mode`, no `label`. The widget draws the route and the traveled portion, shows only the distance as the caption, and anchors photos by the nearest-point rule. Retrofitting a page means opening the GPX in Waysmith, accepting or correcting suggested legs, saving, exporting, and uploading the JSON.

A KML with only coordinates converts the same way.

---

## 4. Open questions

1. Should `hike` and `walk` stay distinct, or is one on-foot token enough?
2. Should a stop show its duration ("Cape Point · 10 min")? The privacy rule as written says no; a dwell time is not a clock time, so this is a judgment call.
3. Does the CDN toolchain already know each photo's capture time when it writes `markers.js`? If so the photo manifest in §3.1a is a by-product of that step.
