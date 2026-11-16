"""Fetch missing website brand colors from Context.dev, with bounded credit use.

Set CONTEXT_DEV_API_KEY in the environment. Each request uses 10 credits.
Usage: python scripts/discover-brand-colors.py catalog.json --max-calls 100
"""
import argparse, json, os, re, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlsplit

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('catalog',type=Path)
parser.add_argument('--max-calls',type=int,required=True)
args=parser.parse_args()
if args.max_calls<1:parser.error('--max-calls must be positive')
api_key=os.environ.get('CONTEXT_DEV_API_KEY')
if not api_key:parser.error('Set CONTEXT_DEV_API_KEY first')
rows=json.loads(args.catalog.read_text(encoding='utf8'))

def save():
    fd,temp=tempfile.mkstemp(dir=args.catalog.parent,prefix='discover-brand-',suffix='.tmp')
    try:
        with os.fdopen(fd,'w',encoding='utf8') as out:
            json.dump(rows,out,ensure_ascii=False,separators=(',',':'));out.flush();os.fsync(out.fileno())
        os.replace(temp,args.catalog)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def normalize(hex_value):
    if not isinstance(hex_value,str) or not re.fullmatch(r'#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?',hex_value):return None
    v=hex_value.lower()
    return '#'+''.join(c*2 for c in v[1:]) if len(v)==4 else v

groups={}
for row in rows:
    if row.get('colors'):continue
    domain=urlsplit(row.get('url','')).hostname
    if domain:groups.setdefault(domain.lower().removeprefix('www.'),[]).append(row)
count=updated=0
for domain,sites in groups.items():
    if count>=args.max_calls:break
    request=urllib.request.Request('https://api.context.dev/v1/brand/retrieve',data=json.dumps({'type':'by_domain','domain':domain}).encode(),headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json'},method='POST')
    try:
        count+=1
        with urllib.request.urlopen(request,timeout=45) as response:data=json.load(response)
        palette=list(dict.fromkeys(filter(None,(normalize(item.get('hex')) for item in (data.get('brand') or {}).get('colors',[]) if isinstance(item,dict)))))[:2]
        if palette:
            for row in sites:row['colors'],row['colorSource']=palette,'context.dev'
            updated+=len(sites);save()
        print(f'{count}: {domain}: {len(palette)} colors',flush=True)
    except urllib.error.HTTPError as e:
        print(f'{count}: {domain}: HTTP {e.code}',flush=True)
        if e.code in (401,402,403,429):break
    except (OSError,ValueError) as e:print(f'{count}: {domain}: {type(e).__name__}',flush=True)
    time.sleep(6) # free plan allows 10 requests per minute
print(f'Calls: {count}; sites updated: {updated}; estimated maximum credits: {count*10}',flush=True)
