"""Backfill Discover colors from the SOTD index, only.

Usage: python scripts/discover-colors.py [catalog.json]
Other sites remain uncolored until a brand-data provider is configured.
"""
import json, os, re, sys, tempfile, urllib.request
from pathlib import Path
from urllib.parse import urlsplit

path = Path(next((arg for arg in sys.argv[1:] if not arg.startswith('--')), 'public/study-sites.json'))
rows = json.loads(path.read_text(encoding='utf8'))

def save():
    fd, temp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as out:
            json.dump(rows, out, ensure_ascii=False, separators=(',', ':'))
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def fetch(url, limit=8_000_000):
    request = urllib.request.Request(url, headers={'User-Agent':'Sightline/1.0 (personal visual research)'})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read(limit + 1)
        if len(data) > limit: raise ValueError('file too large')
        return data

def hex_color(value):
    if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?',value): return None
    value=value.lower()
    return '#'+''.join(c*2 for c in value[1:]) if len(value)==4 else value

try:
    raw=fetch('https://esirop.github.io/awwwards-sotd-index/data/sotd.js')
    index=json.loads(raw[raw.index(b'{'):].rstrip(b';\n\r '))
    by_slug={site.get('s'):site for site in index['sites']}
    count=0
    for row in rows:
        source=next((source for source in row.get('sources',[]) if source.get('name')=='Awwwards'),None)
        slug=urlsplit(source.get('url','')).path.rstrip('/').split('/')[-1] if source else None
        site=by_slug.get(slug)
        if site:
            palette=list(dict.fromkeys(filter(None,map(hex_color,site.get('c',[])))))[:2]
            if palette and (row.get('colors')!=palette or row.get('colorSource')!='awwwards'):
                row['colors'],row['colorSource']=palette,'awwwards';count+=1
    print('SOTD index updated:',index.get('updated'),'colors:',count,flush=True)
    save()
except Exception as e:
    print('SOTD index unavailable:',e,flush=True)

# The Awwwards index provides actual source colors. Other sites remain uncolored
# until a brand-data provider has been configured; thumbnails are not used.
