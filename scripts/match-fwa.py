import requests,json,re,collections,io,concurrent.futures
from pathlib import Path
from PIL import Image,ImageOps
base=json.loads(Path('public/study-sites.json').read_text(encoding='utf8'))+json.loads(Path('scripts/css-seed.json').read_text(encoding='utf8'))+json.loads(Path('scripts/godly-seed.json').read_text(encoding='utf8'))
fwa=json.loads(Path('scripts/fwa-archive.json').read_text(encoding='utf8'))
def norm(s):return re.sub(r'[^a-z0-9]','',s.lower())
idx=collections.defaultdict(dict)
for s in base:
 if s.get('url') and s.get('image'):idx[norm(s['title'])][s['url']]=s
previous=json.loads(Path('scripts/fwa-matches.json').read_text(encoding='utf8')) if Path('scripts/fwa-matches.json').exists() else []
jobs=[];seen={x['fwa']['slug'] for x in previous}
for f in fwa:
 k=norm(f.get('title',''))
 if k and len(k)>=8 and len(idx[k])==1 and f['slug'] not in seen:
  seen.add(f['slug']);jobs.append((f,list(idx[k].values())[0]))
print('Checking',len(jobs),'title matches',flush=True)
def hash_image(url):
 r=requests.get(url,timeout=12);r.raise_for_status();im=ImageOps.grayscale(Image.open(io.BytesIO(r.content)));im=ImageOps.fit(im,(17,16));p=list(im.getdata());return [p[y*17+x]>p[y*17+x+1] for y in range(16) for x in range(16)]
def check(job):
 f,s=job
 try:
  a=hash_image(f['image']);b=hash_image(s['image']);dist=sum(x!=y for x,y in zip(a,b));return {'fwa':f,'site':s,'distance':dist}
 except:return None
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
 found=previous+[x for x in ex.map(check,jobs) if x]
Path('scripts/fwa-matches.json').write_text(json.dumps(found,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print('compared',len(found),'within 40 bits',sum(x['distance']<=40 for x in found),flush=True)
print([(x['fwa']['title'],x['distance']) for x in sorted(found,key=lambda x:x['distance'])[:25]],flush=True)
