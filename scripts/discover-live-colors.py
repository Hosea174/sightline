"""Collect confident primary/accent colors from rendered pages using agent-browser.

Writes public/study-sites-live-colors.json and a resumable checkpoint without
changing the input catalog. Run --self-test for the local clustering check.
"""
import argparse
import colorsys
import concurrent.futures
import json
import math
import os
import subprocess
import tempfile
import threading
from pathlib import Path

EVAL = r'''JSON.stringify((() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const rgb = value => {
    const m = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (!m || (m[4] != null && Number(m[4]) < .92)) return null;
    return '#' + m.slice(1, 4).map(x => Math.round(Number(x)).toString(16).padStart(2, '0')).join('');
  };
  let index = 0;
  for (const el of [document.documentElement, document.body, ...document.querySelectorAll('body *')]) {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect(), id = index++;
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < .1 || rect.width <= 0 || rect.height <= 0) continue;
    const w = Math.max(0, Math.min(vw, rect.right) - Math.max(0, rect.left));
    const h = Math.max(0, Math.min(vh, rect.bottom) - Math.max(0, rect.top));
    if (!w || !h) continue;
    const area = Math.min(1, w * h / (vw * vh));
    const tag = el.tagName.toLowerCase(), role = el.getAttribute('role') || '';
    const interactive = /^(a|button|input|select|summary)$/.test(tag) || /^(button|link|menuitem)$/.test(role) || el.hasAttribute('onclick');
    const hint = /primary|accent|brand|cta/i.test((el.className && String(el.className)) + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || ''));
    const common = {area, role: interactive ? 1 : 0, hint: hint ? 1 : 0, id};
    const bg = rgb(style.backgroundColor);
    if (bg) out.push({...common, color:bg, kind:'background'});
    if (el.childNodes && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) {
      const fg = rgb(style.color);
      if (fg) out.push({...common, color:fg, kind:'text', area:area * .16});
    }
    for (const side of ['Top','Right','Bottom','Left']) {
      if (parseFloat(style['border' + side + 'Width']) > 0) {
        const border = rgb(style['border' + side + 'Color']);
        if (border) out.push({...common, color:border, kind:'border', area:area * .08});
      }
    }
  }
  return {viewport:[vw,vh], elements:index, samples:out};
})())'''

thread_data = threading.local()
sessions = set()
sessions_lock = threading.Lock()


def oklab(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    l = .4122214708 * lin[0] + .5363325363 * lin[1] + .0514459929 * lin[2]
    m = .2119034982 * lin[0] + .6806995451 * lin[1] + .1073969566 * lin[2]
    s = .0883024619 * lin[0] + .2817188376 * lin[1] + .6299787005 * lin[2]
    l, m, s = (v ** (1 / 3) for v in (l, m, s))
    return (.2104542553*l + .793617785*m - .0040720468*s,
            1.9779984951*l - 2.428592205*m + .4505937099*s,
            .0259040371*l + .7827717662*m - .808675766*s)


def hue(color):
    r, g, b = (int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return colorsys.rgb_to_hsv(r, g, b)[0] * 360


def color_families(samples):
    candidates = {}
    for sample in samples:
        color = sample['color'].lower()
        lab = oklab(color)
        chroma = math.hypot(lab[1], lab[2])
        if chroma < .07 or not .16 < lab[0] < .94:
            continue
        weight = sample['area'] * (1 + 3 * sample['role'] + 1.5 * sample['hint'])
        item = candidates.setdefault(color, {'lab': lab, 'hue': hue(color), 'score': 0., 'count': set(), 'interactive': False})
        item['score'] += weight
        item['count'].add(sample['id'])
        item['interactive'] |= bool(sample['role'])

    families = []
    for color, item in sorted(candidates.items(), key=lambda pair: -pair[1]['score']):
        family = next((f for f in families if
                       abs(item['lab'][0] - f['lab'][0]) < .48 and
                       math.hypot(item['lab'][1] - f['lab'][1], item['lab'][2] - f['lab'][2]) < .23 and
                       min((item['hue'] - f['hue']) % 360, (f['hue'] - item['hue']) % 360) < 34), None)
        if family is None:
            families.append({'lab': item['lab'], 'hue': item['hue'], 'score': item['score'], 'color': color,
                             'rep_score': item['score'], 'count': set(item['count']), 'interactive': item['interactive']})
        else:
            family['score'] += item['score']
            family['count'].update(item['count'])
            family['interactive'] |= item['interactive']
            if item['score'] > family['rep_score']:
                family.update(lab=item['lab'], hue=item['hue'], color=color, rep_score=item['score'])
    families.sort(key=lambda f: f['score'], reverse=True)
    # A small but role-signaled CTA can be meaningful; isolated incidental pixels are not.
    confident = [f for f in families if f['score'] >= .045 or (f['interactive'] and f['score'] >= .018)]
    return [f['color'] for f in confident[:2]], families


def inspect(row, timeout):
    session = getattr(thread_data, 'session', None)
    if session is None:
        session = thread_data.session = 'sightline-colors-' + str(os.getpid()) + '-' + str(threading.get_ident())
        with sessions_lock:
            sessions.add(session)
    commands = [['open', row['url']], ['wait', '--load', 'domcontentloaded'], ['wait', '1500'], ['eval', EVAL]]
    env = os.environ.copy()
    env['AGENT_BROWSER_DEFAULT_TIMEOUT'] = str(round(timeout * 1000))
    for attempt in range(2):
        proc = subprocess.run(['agent-browser', '--session', session, 'batch', '--json', '--bail'],
                              input=json.dumps(commands), text=True, encoding='utf-8', errors='replace', capture_output=True,
                              timeout=timeout + 45, env=env)
        try:
            if proc.returncode:
                raise RuntimeError((proc.stderr or proc.stdout).strip()[-500:])
            results = json.loads(proc.stdout)
            payload = results[-1].get('result') or results[-1].get('data') or {}
            raw = payload.get('result')
            if not raw:
                raise ValueError('browser returned no DOM samples')
            page = json.loads(raw)
            break
        except (RuntimeError, ValueError, json.JSONDecodeError):
            if attempt:
                raise
    colors, families = color_families(page['samples'])
    if not colors:
        raise ValueError('no confident chromatic family')
    return {'title': row.get('title'), 'url': row['url'], 'colors': colors,
            'colorSource': 'live-dom-computed', 'confidence': 'high' if families[0]['score'] >= .1 else 'medium',
            'sampledElements': page['elements'], 'viewport': page['viewport']}


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as file:
            json.dump(data, file, ensure_ascii=False, separators=(',', ':'))
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def self_test():
    samples = [
        {'color':'#1646d8','area':.34,'role':0,'hint':0,'id':1},
        {'color':'#3267f2','area':.12,'role':1,'hint':0,'id':2},
        {'color':'#ed4b36','area':.05,'role':1,'hint':1,'id':3},
        {'color':'#ee6a53','area':.02,'role':0,'hint':0,'id':4},
        {'color':'#ffffff','area':.8,'role':0,'hint':0,'id':5},
    ]
    colors, _ = color_families(samples)
    assert colors == ['#3267f2', '#ed4b36'], colors
    assert not color_families([{'color':'#777777','area':1,'role':0,'hint':0,'id':1}])[0]
    print('Self-test passed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog', nargs='?', type=Path, default=Path('public/study-sites.json'))
    parser.add_argument('--output', type=Path, default=Path('public/study-sites-live-colors.json'))
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--timeout', type=float, default=20)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.workers < 1 or args.timeout <= 0 or (args.limit is not None and args.limit < 0):
        parser.error('workers/timeout must be positive; limit cannot be negative')
    checkpoint = args.output.with_suffix(args.output.suffix + '.checkpoint.json')
    rows = json.loads(args.catalog.read_text(encoding='utf8'))
    done = json.loads(checkpoint.read_text(encoding='utf8')) if checkpoint.exists() else {}
    pending = [row for row in rows if row.get('url') not in done and row.get('url') and not row.get('colors')]
    if args.limit is not None:
        pending = pending[:args.limit]
    print(f'Sites: {len(rows)}; pending: {len(pending)}; workers: {args.workers}', flush=True)
    errors = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(inspect, row, args.timeout): row for row in pending}
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            row = futures[future]
            try:
                result = future.result()
                done[row['url']] = result
                print(f'[{i}/{len(pending)}] OK {row.get("title", row["url"])}: {", ".join(result["colors"])}', flush=True)
            except Exception as error:
                errors += 1
                print(f'[{i}/{len(pending)}] SKIP {row.get("title", row["url"])}: {type(error).__name__}: {error}', flush=True)
            if i % 10 == 0:
                atomic_json(checkpoint, done)
                atomic_json(args.output, list(done.values()))
    atomic_json(checkpoint, done)
    atomic_json(args.output, list(done.values()))
    print(f'Accepted: {len(done)}; skipped this run: {errors}; remaining: {len(rows)-len(done)}; output: {args.output}; checkpoint: {checkpoint}', flush=True)
    # Isolated task sessions only; never closes or attaches to the user's browser.
    for session in sessions:
        subprocess.run(['agent-browser', '--session', session, 'close'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=5)


if __name__ == '__main__':
    main()
