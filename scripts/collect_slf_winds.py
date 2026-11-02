"""Publish SLF tower history from observations already collected by the COP job."""
import json, math, re
from datetime import datetime, timezone
from pathlib import Path

TOWERS = ('0511', '0512', '0513')
KEEP_MS = 24 * 3600 * 1000

def number(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v < 999 else None

def millis(value):
    if not isinstance(value, str): return None
    try:
        t = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
        return int(t.timestamp() * 1000)
    except (ValueError, OverflowError): return None

def build(previous, live, replay, now=None):
    now = now or datetime.now(timezone.utc)
    stamp = int(now.timestamp() * 1000)
    buckets = {tw: {} for tw in TOWERS}
    for tw in TOWERS:
        for row in previous.get('towers', {}).get(tw, []):
            t = row.get('t')
            if isinstance(t, (int, float)) and stamp-KEEP_MS <= t <= stamp+120000 and row.get('hgt') == 30:
                buckets[tw][t] = dict(row)
    # Replay seeds about an hour after initial deployment. Live rows retain peak direction.
    rows = [*replay.get('feeds', {}).get('winds', {}).get('rows', []),
            *live.get('feeds', {}).get('winds', {}).get('rows', [])]
    for r in rows:
        m = re.fullmatch(r'(\d{1,4})', str(r.get('tower', '')))
        tw = m.group(1).zfill(4) if m else ''
        t = millis(r.get('reading_datetime'))
        if tw not in buckets or r.get('hgt') != 30 or t is None or not stamp-KEEP_MS <= t <= stamp+120000: continue
        spd, pk = number(r.get('avg_spd_1min')), number(r.get('peak_spd_1min'))
        if spd is None and pk is None: continue
        row = {'t': t, 'hgt': 30, 'spd': spd, 'pk': pk,
               'dir': number(r.get('avg_dir_1min')), 'pkdir': number(r.get('peak_dir_1min'))}
        # Older replay files omit peak direction. Do not overwrite a known direction with it.
        old = buckets[tw].get(t, {})
        if row['pkdir'] is None and old.get('pkdir') is not None and old.get('pk') == pk:
            row['pkdir'] = old['pkdir']
        buckets[tw][t] = row
    feed = live.get('feeds', {}).get('winds', {})
    return {'version': 1, 'generated_at': now.isoformat(), 'source_status': feed.get('status', 'unavailable'),
            'source_fetched_at': feed.get('fetched_at'), 'source_error': feed.get('error'),
            'units': 'kt, degrees true, feet AGL',
            'towers': {tw: sorted(buckets[tw].values(), key=lambda r: r['t']) for tw in TOWERS}}

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'dist/data'
    path = root / 'slf-winds.json'
    def read(p): return json.loads(p.read_text()) if p.exists() else {}
    result = build(read(path), read(root/'latest.json'), read(root/'replay/index.json'))
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
    temp.replace(path)
    print('SLF history:', {k: len(v) for k, v in result['towers'].items()})
