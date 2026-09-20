#!/usr/bin/env python3
"""Convert a GPX track log into the compact per-page track JSON the corner map uses.

Usage: gpx2track.py input.gpx [output.json] [--label N=Text ...] [--mode N=walk|drive|cable|fly|boat|stop ...] [--times]

The JSON is meant to be published, so by default it carries no clock times:
no start/end, no per-point times, and a duration only on fly and boat legs.
Pass --times to include them (for local inspection only).

Segments are inferred from speed and vertical rate:
  stop   smoothed speed below 1.5 km/h for at least 3 minutes (logger pauses count);
         a stop that still covers more than 400 m of wandering is reported as a walk
  walk   below 8 km/h
  cable  below 35 km/h horizontally but climbing or descending faster than 40 m/min
  fly    above 200 km/h
  drive  everything else
Runs shorter than 150 s (60 s for cable and fly, 180 s for stops) are absorbed into their neighbours. Coordinates are
simplified with Douglas-Peucker (6 m tolerance) so a full day is a few hundred
points instead of several thousand.
"""
import json
import math
import sys
import datetime as dt
import xml.etree.ElementTree as ET

NS = '{http://www.topografix.com/GPX/1/1}'
R = 6371000.0


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))


def parse(path):
    pts = []
    for p in ET.parse(path).getroot().iter(NS + 'trkpt'):
        ele = p.find(NS + 'ele')
        tm = p.find(NS + 'time')
        pts.append({
            'lat': float(p.get('lat')), 'lon': float(p.get('lon')),
            'ele': float(ele.text) if ele is not None else None,
            't': dt.datetime.fromisoformat(tm.text.replace('Z', '+00:00')) if tm is not None else None,
        })
    return pts


def annotate(pts):
    """Per-point distance, elapsed time, and time-smoothed horizontal / vertical speeds."""
    for i, p in enumerate(pts):
        if i == 0:
            p['d'] = 0.0; p['dt'] = 0.0
        else:
            q = pts[i - 1]
            p['d'] = hav((q['lat'], q['lon']), (p['lat'], p['lon']))
            p['dt'] = (p['t'] - q['t']).total_seconds() if p['t'] and q['t'] else 1.0
    # smooth over a +-20 s window (time based, so it survives variable sampling)
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
        # a long pause in the log is a stop regardless of the window
        if p['dt'] > 120 and p['d'] < 100:
            p['kmh'] = 0.0


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


MIN_RUN_SECS = {'stop': 180, 'cable': 60, 'fly': 60}


def merge_short(pts, runs, min_secs=150):
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, r in enumerate(runs):
            limit = MIN_RUN_SECS.get(r['mode'], min_secs)
            if run_secs(pts, r) >= limit:
                continue
            # absorb into the longer neighbour
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
        # merge adjacent same-mode runs
        j = 0
        while j + 1 < len(runs):
            if runs[j]['mode'] == runs[j + 1]['mode']:
                runs[j]['end'] = runs[j + 1]['end']
                del runs[j + 1]
                changed = True
            else:
                j += 1
    return runs


def simplify(coords, tol_m):
    """Douglas-Peucker on [lon, lat] pairs using a local equirectangular projection."""
    if len(coords) < 3:
        return coords
    lat0 = math.radians(coords[0][1])
    kx = 111320.0 * math.cos(lat0)
    ky = 110540.0
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


def build(pts, labels=None, mode_overrides=None, tol_m=6.0, times=False):
    annotate(pts)
    runs = merge_short(pts, runs_of(pts))
    # a stop's boundary points belong to the moving legs on either side
    segs = []
    for i, r in enumerate(runs):
        mode = (mode_overrides or {}).get(i, r['mode'])
        a, b = r['start'], r['end']
        pp = pts[a:b + 1]
        coords = [[round(p['lon'], 5), round(p['lat'], 5)] for p in pp]
        dist = sum(p['d'] for p in pp[1:])
        secs = (pp[-1]['t'] - pp[0]['t']).total_seconds()
        eles = [p['ele'] for p in pp if p['ele'] is not None]
        # a "stop" with real wandering (a beach, a summit) is a walk, not a pause
        if mode == 'stop' and dist > 400 and i not in (mode_overrides or {}):
            mode = 'walk'
        seg = {'mode': mode, 'label': (labels or {}).get(i), 'dist_m': 0 if mode == 'stop' else round(dist)}
        if times or mode in ('fly', 'boat'):
            seg['dur_s'] = round(secs)
        if times:
            seg['start'] = pp[0]['t'].isoformat().replace('+00:00', 'Z')
            seg['end'] = pp[-1]['t'].isoformat().replace('+00:00', 'Z')
        if eles:
            seg['ele'] = [round(min(eles)), round(max(eles))]
        if mode == 'stop':
            seg['pts'] = [[round(sum(c[0] for c in coords) / len(coords), 5), round(sum(c[1] for c in coords) / len(coords), 5)]]
        else:
            kept = simplify(coords, tol_m)
            ele_by = {(c[0], c[1]): p['ele'] for c, p in zip(coords, pp)}
            seg['pts'] = [[c[0], c[1], round(ele_by[(c[0], c[1])])] if ele_by.get((c[0], c[1])) is not None else c for c in kept]
        seg['_secs'] = secs
        segs.append(seg)
    total = sum(s['dist_m'] for s in segs)
    lons = [c[0] for s in segs for c in s['pts']]; lats = [c[1] for s in segs for c in s['pts']]
    out = {
        'v': 1,
        'dist_m': total,
        'bbox': [min(lons), min(lats), max(lons), max(lats)],
        'legs': segs,
    }
    if times:
        out['start'] = pts[0]['t'].isoformat().replace('+00:00', 'Z')
        out['end'] = pts[-1]['t'].isoformat().replace('+00:00', 'Z')
    return out


def fmt_dur(s):
    h, m = divmod(int(s) // 60, 60)
    return f'{h} h {m:02d} min' if h else f'{m} min'


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    labels, modes, files, times = {}, {}, [], False
    it = iter(argv[1:])
    for a in it:
        if a == '--times':
            times = True
        elif a == '--label':
            k, v = next(it).split('=', 1); labels[int(k)] = v
        elif a == '--mode':
            k, v = next(it).split('=', 1); modes[int(k)] = v
        else:
            files.append(a)
    src = files[0]
    out = files[1] if len(files) > 1 else None
    parsed = parse(src)
    track = build(parsed, labels, modes, times=times)
    n_out = 0
    for i, s in enumerate(track['legs']):
        ele = s.get('ele', ['?', '?'])
        print(f"{i:2d} {s['mode']:<5} {fmt_dur(s['_secs']):>10} {s['dist_m'] / 1000:7.1f} km "
              f"ele {ele[0]:>4}-{ele[1]:<4} pts {len(s['pts']):4d}  {s['label'] or ''}", file=sys.stderr)
        n_out += len(s['pts'])
        del s['_secs']
    print(f"total {track['dist_m'] / 1000:.1f} km, {len(parsed)} -> {n_out} points", file=sys.stderr)
    js = json.dumps(track, separators=(',', ':'))
    if out:
        with open(out, 'w') as f:
            f.write(js)
    else:
        print(js)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
