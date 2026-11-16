"""Estimate up to two site colors from bounded HTML/CSS HTTP requests only."""
import argparse
import colorsys
import concurrent.futures
import html.parser
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

MAX_BYTES = 1_000_000
MAX_STYLESHEETS = 5
HEX = re.compile(r"#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b", re.I)
RGB = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)", re.I)
COLOR_DECL = re.compile(r"(?:^|[;{])\s*(--[\w-]*(?:brand|primary|accent)[\w-]*|(?:background(?:-color)?|color|border(?:-[\w-]+)?-color))\s*:\s*([^;]+)", re.I)
COLOR_PROPERTY = re.compile(r"(?:--[\w-]*(?:brand|primary|accent)[\w-]*|background(?:-color)?|color|border(?:-[\w-]+)?-color)\Z", re.I)


class PageParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ''
        self.in_title = False
        self.in_style = False
        self.styles = []
        self.links = []
        self.interactive = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self.in_title = True
        if tag == 'style':
            self.in_style = True
            self.styles.append('')
        if tag == 'link' and 'stylesheet' in attrs.get('rel', '').lower().split() and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag in ('a', 'button', 'input', 'select', 'textarea', 'summary') or attrs.get('role') in ('button', 'link', 'menuitem'):
            for key in ('style',):
                if attrs.get(key):
                    self.interactive.append(attrs[key])

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_style and self.styles:
            self.styles[-1] += data


def fetch(url, timeout):
    req = urllib.request.Request(url, headers={'User-Agent': 'SightlineColorEstimator/1.0', 'Accept': 'text/html,text/css;q=0.9,*/*;q=0.1'})
    deadline = time.monotonic() + timeout
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status >= 400: raise OSError(f'HTTP {response.status}')
        chunks, size = [], 0
        while size < MAX_BYTES and time.monotonic() < deadline:
            part = response.read1(min(65536, MAX_BYTES - size))
            if not part: break
            chunks.append(part); size += len(part)
        if time.monotonic() >= deadline: raise TimeoutError('response deadline exceeded')
        return b''.join(chunks).decode(response.headers.get_content_charset() or 'utf-8', 'replace'), response.geturl()


def colors_in(css):
    # Walk brace boundaries once: a backtracking regex over minified or
    # malformed megabyte-sized stylesheets can monopolize the interpreter.
    found, cursor = [], 0
    while cursor < len(css):
        opening = css.find('{', cursor)
        if opening < 0: break
        closing = css.find('}', opening + 1)
        if closing < 0: break
        nested = css.find('{', opening + 1, closing)
        if nested >= 0:
            cursor = opening + 1
            continue
        selector = css[max(cursor, opening - 4096):opening]
        declarations = css[opening + 1:closing]
        cursor = closing + 1
        interactive = bool(re.search(r":(?:hover|focus|active)|\b(?:a|button|\.btn|\.button)\b", selector, re.I))
        for declaration in declarations.split(';'):
            prop, separator, value = declaration.partition(':')
            prop = prop.strip().lower()
            if not separator or not COLOR_PROPERTY.fullmatch(prop): continue
            weight = 5 if prop.startswith('--') else (3 if interactive else 1)
            for m in HEX.finditer(value):
                color = m.group().lower()
                if len(color) in (5, 9): continue
                if len(color) == 4: color = '#' + ''.join(c * 2 for c in color[1:])
                found.append((color, weight))
            for m in RGB.finditer(value):
                if m.group(4) is not None and float(m.group(4)) < .8: continue
                if all(int(m.group(i)) <= 255 for i in (1, 2, 3)):
                    found.append(('#' + ''.join(f'{int(m.group(i)):02x}' for i in (1, 2, 3)), weight))
    return found


def estimate(css_blocks):
    candidates = {}
    for css, bonus in css_blocks:
        for color, weight in colors_in(css):
            rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
            h, saturation, value = colorsys.rgb_to_hsv(*rgb)
            if saturation < .22 or not .16 < value < .97:
                continue
            candidates[color] = candidates.get(color, 0) + weight + bonus
    families = []
    for color, score in sorted(candidates.items(), key=lambda item: -item[1]):
        rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
        hue = colorsys.rgb_to_hsv(*rgb)[0] * 360
        family = next((f for f in families if min((hue - f['hue']) % 360, (f['hue'] - hue) % 360) < 28), None)
        if family:
            family['score'] += score
            if score > family['rep_score']:
                family.update(color=color, rep_score=score)
        else:
            families.append({'hue': hue, 'color': color, 'score': score, 'rep_score': score})
    return [f['color'] for f in sorted((f for f in families if f['score'] >= 2), key=lambda f: -f['score'])[:2]]


def inspect(row, timeout):
    url = row.get('url', '')
    if urllib.parse.urlsplit(url).scheme not in ('http', 'https'):
        raise ValueError('URL must use HTTP or HTTPS')
    html, base = fetch(url, timeout)
    page = PageParser()
    page.feed(html)
    blocks = [(style, 0) for style in page.styles]
    blocks.extend(('button{' + style + '}', 2) for style in page.interactive)
    for href in page.links[:MAX_STYLESHEETS]:
        css_url = urllib.parse.urljoin(base, href)
        if urllib.parse.urlsplit(css_url).scheme in ('http', 'https'):
            try:
                blocks.append((fetch(css_url, timeout)[0], 0))
            except Exception:
                continue
    colors = estimate(blocks)
    if not colors:
        raise ValueError('no confident chromatic CSS family')
    return {'url': url, 'title': row.get('title') or page.title.strip() or url, 'colors': colors, 'colorSource': 'http-css-estimate'}


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def append_result(output, checkpoint, result):
    url = result['url']
    if any(row.get('url') == url for row in output) or url in checkpoint:
        return False
    output.append(result)
    checkpoint[url] = result
    return True


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog', nargs='?', type=Path, default=Path('public/study-sites.json'))
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('APPDATA', str(Path.home())))/'com.sightline.app'/'discover-live-colors.json')
    parser.add_argument('--workers', type=int, default=24)
    parser.add_argument('--timeout', type=float, default=8)
    parser.add_argument('--retry-failed', action='store_true', help='retry sites that failed on earlier runs')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.workers < 1 or args.timeout <= 0 or args.limit is not None and args.limit < 0:
        parser.error('workers/timeout must be positive; limit cannot be negative')
    started = time.monotonic()
    checkpoint = args.output.with_suffix(args.output.suffix + '.checkpoint.json')
    rows = json.loads(args.catalog.read_text(encoding='utf-8'))
    old_output = json.loads(args.output.read_text(encoding='utf-8')) if args.output.exists() else []
    done = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
    if not isinstance(old_output, list) or not isinstance(done, dict):
        parser.error('output must be a JSON list and checkpoint a JSON object')
    # A crash between the two atomic writes must not hide a saved result.
    output_urls = {r.get('url') for r in old_output if isinstance(r, dict)}
    for url, result in done.items():
        if url not in output_urls and isinstance(result, dict) and result.get('colors'):
            old_output.append(result); output_urls.add(url)
    for result in old_output:
        if isinstance(result, dict) and result.get('url') and result.get('colors'):
            done.setdefault(result['url'], result)
    failures_path = args.output.with_suffix(args.output.suffix + '.failures.json')
    failures = json.loads(failures_path.read_text(encoding='utf-8')) if failures_path.exists() else {}
    if not isinstance(failures, dict): parser.error('failure checkpoint must be a JSON object')
    present = output_urls | set(done)
    pending = [r for r in rows if r.get('url') and r['url'] not in present and not r.get('colors') and (args.retry_failed or r['url'] not in failures)]
    if args.limit is not None:
        pending = pending[:args.limit]
    print(f'Sites: {len(rows)}; pending: {len(pending)}; workers: {args.workers}', flush=True)
    accepted, failed = 0, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(inspect, row, args.timeout): row for row in pending}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            row = futures[future]
            try:
                result = future.result()
                if append_result(old_output, done, result):
                    failures.pop(row['url'], None)
                    accepted += 1
                    print(f'[{index}/{len(pending)}] OK {result["title"]}: {", ".join(result["colors"])}', flush=True)
                else:
                    print(f'[{index}/{len(pending)}] SKIP already recorded {row["url"]}', flush=True)
            except Exception as error:
                failed += 1
                failures[row['url']] = f'{type(error).__name__}: {str(error)[:200]}'
                print(f'[{index}/{len(pending)}] SKIP {row.get("title", row["url"])}: {type(error).__name__}: {error}', flush=True)
            if index % 10 == 0:
                atomic_json(checkpoint, done)
                atomic_json(args.output, old_output)
                atomic_json(failures_path, failures)
                rate = index / max(time.monotonic() - started, .001)
                print(f'Progress: {index}/{len(pending)}; accepted {accepted}; failed {failed}; estimated remaining {(len(pending)-index)/rate/60:.1f} minutes', flush=True)
    atomic_json(failures_path, failures)
    atomic_json(checkpoint, done)
    atomic_json(args.output, old_output)
    print(f'Accepted: {accepted}; failed: {failed}; elapsed: {time.monotonic()-started:.1f}s; total preserved+new: {len(old_output)}; output: {args.output}', flush=True)


if __name__ == '__main__':
    main()
