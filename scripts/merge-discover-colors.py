"""Merge a live-site color batch by URL without changing source colors or user data."""
import argparse,json,os,re,tempfile
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('catalog',type=Path);p.add_argument('results',type=Path);args=p.parse_args()
rows=json.loads(args.catalog.read_text(encoding='utf8'))
results=json.loads(args.results.read_text(encoding='utf8'))
by_url={item['url']:item for item in results if item.get('url') and item.get('colorSource')=='live-dom-computed'}
count=0
for row in rows:
    result=by_url.get(row.get('url'))
    if row.get('colors') or not result:continue
    colors=list(dict.fromkeys(c.lower() for c in result.get('colors',[]) if isinstance(c,str) and re.fullmatch(r'#[a-fA-F0-9]{6}',c)))[:2]
    if colors:row['colors'],row['colorSource']=colors,'live-dom-computed';count+=1
fd,temp=tempfile.mkstemp(dir=args.catalog.parent,prefix='discover-merge-',suffix='.tmp')
try:
    with os.fdopen(fd,'w',encoding='utf8') as f:json.dump(rows,f,ensure_ascii=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
    os.replace(temp,args.catalog)
finally:
    if os.path.exists(temp):os.unlink(temp)
print('Applied colors to',count,'sites')
