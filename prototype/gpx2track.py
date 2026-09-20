#!/usr/bin/env python3
"""Reference converter: GPX (with or without legs) -> track JSON v1 for the corner map.

Usage:
  gpx2track.py input.gpx [output.json] [--photos photos.json] [--times]
               [--label N=Text ...] [--mode N=drive|walk|...|stop ...]

Behaviour, as the CDN toolchain should implement it:

  * If the GPX already carries legs (more than one <trk>, or any <trk><type>),
    each <trk> becomes one leg verbatim: <name> -> label, <type> -> mode,
    <extensions><ws:origin> -> origin. Nothing is inferred.
  * Otherwise (one untyped track, i.e. every existing sanitized file) legs are
    inferred from speed and climb rate:
      stop   smoothed speed below 1.5 km/h for at least 3 minutes (logger pauses
             count); a stop with more than 400 m of wandering is reported as a walk
      walk   below 8 km/h
      cable  below 35 km/h horizontally but climbing/descending over 40 m/min
      fly    above 200 km/h
      drive  everything else
    Runs shorter than 150 s (60 s for cable and fly, 180 s for stops) are
    absorbed into their neighbours. --label and --mode override by leg index.
  * Moving legs are simplified with Douglas-Peucker (6 m). A stop becomes its
    centroid.
  * --photos takes a JSON list of {"id": "...", "time": "<RFC 3339>"} and emits
    photo anchors (leg, point index, fraction of the day's distance).
  * The JSON is published, so by default it carries NO clock times: no
    start/end, no per-point times, and a duration only on fly and boat legs.
    --times includes them for local inspection only.
"""
import json
import math
import re
import sys
import datetime as dt
import xml.etree.ElementTree as ET

NS = '{http://www.topografix.com/GPX/1/1}'
WS = '{https://waysmith.app/gpx/1}'
R = 6371000.0
MIN_RUN_SECS = {'stop': 180, 'cable': 60, 'fly': 60}
DEFAULT_MIN_RUN_SECS = 150
SIMPLIFY_TOL_M = 6.0


def hav(a, b):
    """Great-circle distance in metres between (lat, lon) pairs."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))


def parse_time(s):
    return dt.datetime.fromisoformat(s.strip().replace('Z', '+00:00'))


# ---------------------------------------------------------------- parsing

def parse(path):
    root = ET.parse(path).getroot()
    meta_name = root.findtext(f'{NS}metadata/{NS}name')
    tracks = []
    for trk in root.iter(NS + 'trk'):
        t = {'name': trk.findtext(NS + 'name'), 'type': trk.findtext(NS + 'type'), 'origin': None, 'points': []}
        ext = trk.find(NS + 'extensions')
        if ext is not None:
            o = ext.find(WS + 'origin')
            if o is not None and o.text:
                t['origin'] = o.text.strip()
        for p in trk.iter(NS + 'trkpt'):
            ele = p.find(NS + 'ele')
            tm = p.find(NS + 'time')
            t['points'].append({
                'lat': float(p.get('lat')), 'lon': float(p.get('lon')),
                'ele': float(ele.text) if ele is not None and ele.text else None,
                't': parse_time(tm.text) if tm is not None and tm.text else None,
            })
        if t['points']:
            tracks.append(t)
    return meta_name, tracks


def add_distances(pts):
    for i, p in enumerate(pts):
        p['d'] = 0.0 if i == 0 else hav((pts[i - 1]['lat'], pts[i - 1]['lon']), (p['lat'], p['lon']))


def add_speeds(pts):
    """Time-smoothed horizontal speed (km/h) and vertical rate (m/min). Needs timestamps."""
    for i, p in enumerate(pts):
        p['dt'] = 0.0 if i == 0 else (p['t'] - pts[i - 1]['t']).total_seconds()
    n = len(pts)
    j0 = 0
    for i, p in enumerate(pts):
        t = p['t']
        while j0 < i and (t - pts[j0]['t']).total_seconds() > 20:
            j0 += 1
        j1 = i
        while j1 + 1 < n and (pts[j1 + 1]['t'] - t).total_seconds() <= 20:
            j1 += 1
        dist = sum(pts[k]['d'] for k in range(j0 + 1, j1 + 1))
        secs = (pts[j1]['t'] - pts[j0]['t']).total_seconds()
        p['kmh'] = dist / secs * 3.6 if secs > 0 else 0.0
        if pts[j0]['ele'] is not None and pts[j1]['ele'] is not None and secs > 0:
            p['vmin'] = abs(pts[j1]['ele'] - pts[j0]['ele']) / secs * 60
        else:
            p['vmin'] = 0.0
        if p['dt'] > 120 and p['d'] < 100:   # a long pause in the log is a stop
            p['kmh'] = 0.0


# ---------------------------------------------------------------- inference

def classify(p):
    if p['kmh'] > 200:
        return 'fly'
    if p['kmh'] < 1.5:
        return 'stop'
    if p['kmh'] < 35 and p['vmin'] > 40:
        return 'cable'
    if p['kmh'] < 8:
        return 'walk'
    return 'drive'


def runs_of(pts):
    runs = []
    for i, p in enumerate(pts):
        m = classify(p)
        if runs and runs[-1]['mode'] == m:
            runs[-1]['end'] = i
        else:
            runs.append({'mode': m, 'start': i, 'end': i})
    return runs


def run_secs(pts, r):
    return (pts[r['end']]['t'] - pts[r['start']]['t']).total_seconds()


def merge_short(pts, runs):
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, r in enumerate(runs):
            if run_secs(pts, r) >= MIN_RUN_SECS.get(r['mode'], DEFAULT_MIN_RUN_SECS):
                continue
            left = runs[i - 1] if i > 0 else None
            right = runs[i + 1] if i + 1 < len(runs) else None
            target = left if (left and (not right or run_secs(pts, left) >= run_secs(pts, right))) else right
            if target is None:
                continue
            if target is left:
                left['end'] = r['end']
            else:
                right['start'] = r['start']
            del runs[i]
            changed = True
            break
        j = 0
        while j + 1 < len(runs):
            if runs[j]['mode'] == runs[j + 1]['mode']:
                runs[j]['end'] = runs[j + 1]['end']
                del runs[j + 1]
                changed = True
            else:
                j += 1
    return runs


def infer_legs(pts):
    """Split one timed track into (points, mode) runs."""
    if any(p['t'] is None for p in pts):
        return [(pts, None)]
    add_speeds(pts)
    out = []
    for r in merge_short(pts, runs_of(pts)):
        pp = pts[r['start']:r['end'] + 1]
        mode = r['mode']
        if mode == 'stop' and sum(p['d'] for p in pp[1:]) > 400:
            mode = 'walk'   # a beach or a summit, not a pause
        out.append((pp, mode))
    return out


# ---------------------------------------------------------------- geometry

def simplify(coords, tol_m):
    """Douglas-Peucker on [lon, lat, ...] rows using a local equirectangular projection."""
    if len(coords) < 3:
        return coords
    lat0 = math.radians(coords[0][1])
    kx, ky = 111320.0 * math.cos(lat0), 110540.0
    xy = [(c[0] * kx, c[1] * ky) for c in coords]

    def seg_dist(p, a, b):
        ax, ay = a; bx, by = b; px, py = p
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d = seg_dist(xy[i], xy[a], xy[b])
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [c for c, k in zip(coords, keep) if k]


def make_leg(pp, mode, label, origin, times):
    dist = sum(p['d'] for p in pp[1:])
    timed = pp[0]['t'] is not None and pp[-1]['t'] is not None
    secs = (pp[-1]['t'] - pp[0]['t']).total_seconds() if timed else None
    leg = {}
    if mode:
        leg['mode'] = mode
    if label:
        leg['label'] = label
    if origin and origin != 'recorded':
        leg['origin'] = origin
    leg['dist_m'] = 0 if mode == 'stop' else round(dist)
    if secs is not None and (times or mode in ('fly', 'boat')):
        leg['dur_s'] = round(secs)
    if times and timed:
        leg['start'] = pp[0]['t'].isoformat().replace('+00:00', 'Z')
        leg['end'] = pp[-1]['t'].isoformat().replace('+00:00', 'Z')
    if mode == 'stop':
        leg['pts'] = [[round(sum(p['lon'] for p in pp) / len(pp), 5), round(sum(p['lat'] for p in pp) / len(pp), 5)]]
    else:
        eles = [p['ele'] for p in pp if p['ele'] is not None]
        if eles:
            leg['ele'] = [round(min(eles)), round(max(eles))]
        rows = [[round(p['lon'], 5), round(p['lat'], 5)] + ([round(p['ele'])] if p['ele'] is not None else []) for p in pp]
        leg['pts'] = simplify(rows, SIMPLIFY_TOL_M)
    leg['_pp'] = pp
    leg['_secs'] = secs
    return leg


# ---------------------------------------------------------------- photo anchors

def anchor_photos(legs, photos, total):
    spans, before = [], 0
    for li, leg in enumerate(legs):
        pp = leg['_pp']
        spans.append((li, pp[0]['t'], pp[-1]['t'], before))
        before += leg['dist_m']
    out = []
    for ph in photos:
        try:
            t = parse_time(ph['time'])
        except (KeyError, ValueError, TypeError):
            continue
        best, bd = None, None
        for li, t0, t1, b in spans:
            if t0 is None or t1 is None:
                continue
            if t0 <= t <= t1:
                best, bd = (li, b), 0
                break
            d = min(abs((t - t0).total_seconds()), abs((t - t1).total_seconds()))
            if bd is None or d < bd:
                best, bd = (li, b), d
        if best is None:
            continue
        li, b = best
        leg = legs[li]
        pp = leg['_pp']
        along = 0.0
        if t >= pp[-1]['t']:
            along = sum(p['d'] for p in pp[1:])
        elif t > pp[0]['t']:
            acc = 0.0
            for k in range(1, len(pp)):
                if pp[k]['t'] >= t:
                    span = (pp[k]['t'] - pp[k - 1]['t']).total_seconds()
                    frac = (t - pp[k - 1]['t']).total_seconds() / span if span > 0 else 0.0
                    along = acc + pp[k]['d'] * frac
                    break
                acc += pp[k]['d']
        sp, i, acc = leg['pts'], 0, 0.0
        for k in range(1, len(sp)):
            acc += hav((sp[k - 1][1], sp[k - 1][0]), (sp[k][1], sp[k][0]))
            if acc > along:
                break
            i = k
        f = (b + (0 if leg.get('mode') == 'stop' else along)) / total if total else 0.0
        out.append({'id': ph['id'], 'leg': li, 'i': i, 'f': round(f, 4)})
    return out


# ---------------------------------------------------------------- build

def build(meta_name, tracks, labels=None, mode_overrides=None, times=False, photos=None):
    labels = labels or {}
    mode_overrides = mode_overrides or {}
    for t in tracks:
        add_distances(t['points'])
    explicit = len(tracks) > 1 or any(t['type'] for t in tracks)
    if explicit:
        runs = [(t['points'], t['type'], t['name'], t['origin']) for t in tracks]
    else:
        runs = [(pp, mode, None, None) for pp, mode in infer_legs(tracks[0]['points'])]
    legs = []
    for i, (pp, mode, name, origin) in enumerate(runs):
        legs.append(make_leg(pp, mode_overrides.get(i, mode), labels.get(i, name), origin, times))
    total = sum(l['dist_m'] for l in legs)
    lons = [c[0] for l in legs for c in l['pts']]
    lats = [c[1] for l in legs for c in l['pts']]
    out = {'v': 1}
    if meta_name and not re.match(r'^\d{4}-\d{2}-\d{2}', meta_name):
        out['name'] = meta_name
    out['dist_m'] = total
    out['bbox'] = [min(lons), min(lats), max(lons), max(lats)]
    out['legs'] = legs
    if photos:
        out['photos'] = anchor_photos(legs, photos, total)
    if times:
        first = [l['_pp'][0]['t'] for l in legs if l['_pp'][0]['t']]
        last = [l['_pp'][-1]['t'] for l in legs if l['_pp'][-1]['t']]
        if first and last:
            out['start'] = min(first).isoformat().replace('+00:00', 'Z')
            out['end'] = max(last).isoformat().replace('+00:00', 'Z')
    return out, explicit


def fmt_dur(s):
    if s is None:
        return '—'
    h, m = divmod(int(s) // 60, 60)
    return f'{h} h {m:02d} min' if h else f'{m} min'


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    labels, modes, files, times, photos = {}, {}, [], False, None
    it = iter(argv[1:])
    for a in it:
        if a == '--times':
            times = True
        elif a == '--label':
            k, v = next(it).split('=', 1); labels[int(k)] = v
        elif a == '--mode':
            k, v = next(it).split('=', 1); modes[int(k)] = v
        elif a == '--photos':
            with open(next(it)) as f:
                photos = json.load(f)
        else:
            files.append(a)
    src = files[0]
    out_path = files[1] if len(files) > 1 else None
    meta_name, tracks = parse(src)
    if not tracks:
        print('no track points', file=sys.stderr); return 1
    track, explicit = build(meta_name, tracks, labels, modes, times, photos)
    print('legs from GPX' if explicit else 'legs inferred', file=sys.stderr)
    n_out = 0
    for i, l in enumerate(track['legs']):
        ele = l.get('ele', ['?', '?'])
        print(f"{i:2d} {l.get('mode') or '—':<5} {fmt_dur(l['_secs']):>10} {l['dist_m'] / 1000:7.1f} km "
              f"ele {ele[0]:>4}-{ele[1]:<4} pts {len(l['pts']):4d}  {l.get('label', '')}", file=sys.stderr)
        n_out += len(l['pts'])
        del l['_pp'], l['_secs']
    print(f"total {track['dist_m'] / 1000:.1f} km, {sum(len(t['points']) for t in tracks)} -> {n_out} points"
          + (f", {len(track['photos'])} photo anchors" if 'photos' in track else ''), file=sys.stderr)
    js = json.dumps(track, separators=(',', ':'), ensure_ascii=False)
    if out_path:
        with open(out_path, 'w') as f:
            f.write(js)
    else:
        print(js)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
