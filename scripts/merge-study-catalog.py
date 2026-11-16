import json,re,urllib.parse,datetime,collections
from pathlib import Path
p=Path('public/study-sites.json'); original=json.loads(p.read_text(encoding='utf8'))
def key(u):
 try:
  x=urllib.parse.urlsplit(u.strip());host=(x.hostname or '').lower().removeprefix('www.');port=x.port
  if x.scheme.lower() not in ('http','https') or not host:return None
  if port and port not in (80,443):host+=f':{port}'
  path=re.sub(r'%([0-9a-fA-F]{2})',lambda m:chr(int(m.group(1),16)) if chr(int(m.group(1),16)).isalnum() or chr(int(m.group(1),16)) in '-._~' else m.group(0).upper(),x.path or '/').rstrip('/') or '/'
  q=sorted((k,v) for k,v in urllib.parse.parse_qsl(x.query,keep_blank_values=True) if not (k.lower().startswith('utm_') or k.lower() in ('ref','fbclid','gclid','mc_cid','mc_eid')))
  return (host,path,tuple(q))
 except:return None
items={};counts=collections.Counter()
def add(s):
 k=key(s.get('url',''))
 if not k:return
 if k not in items:items[k]=s;counts['new']+=1;return
 old=items[k];counts['overlap']+=1
 old['image']=old.get('image') or s.get('image','');old['tags']=list(dict.fromkeys(old.get('tags',[])+s.get('tags',[])))
 for source in s.get('sources',[]):
  found=next((x for x in old['sources'] if x['name']==source['name'] and x['url'].rstrip('/')==source['url'].rstrip('/')),None)
  if found:
   found['awards']=list(dict.fromkeys(found.get('awards',[])+source.get('awards',[])))
   if not found.get('date'):found['date']=source.get('date')
  else:old['sources'].append(source)
for x in original:add(x)
for file in ['scripts/godly-seed.json','scripts/css-seed.json']:
 for x in json.loads(Path(file).read_text(encoding='utf8')):add(x)
for r in json.loads(Path('scripts/month-year.json').read_text(encoding='utf8')):
 dated=[]
 for a in r.get('awards',[]):
  try:
   d=datetime.datetime.strptime(a['date'],'%b %d, %Y').date()
   if d.year>=2023:dated.append((a['title'],str(d)))
  except:pass
 if not dated or not r.get('liveUrl'):continue
 source={'name':'Awwwards','url':'https://www.awwwards.com/sites/'+r['slug'],'date':dated[0][1],'awards':list(dict.fromkeys([x[0] for x in dated]+r['collectionLabels']))}
 tags=[t.strip() for t in re.sub(r' \+\d+$','',r.get('tags','')).split(',') if t.strip()]
 add({'title':re.sub(r' - Awwwards.*$','',r['title']),'url':r['liveUrl'],'image':r.get('ogImage',''),'tags':tags,'sources':[source]})
matches=Path('scripts/fwa-matches.json')
if matches.exists():
 for match in json.loads(matches.read_text(encoding='utf8')):
  if match['distance']>32:continue
  f=match['fwa'];site=match['site'];awards=f['awards'];source={'name':'FWA','url':'https://legacy.thefwa.com/cases/'+f['slug'],'date':awards[0].get('awardedDate'),'awards':[a.get('name','FWA award') for a in awards]}
  add({'title':site['title'],'url':site['url'],'image':site.get('image','') or f['image'],'tags':[],'sources':[source]})
filtered=[s for s in items.values() if s.get('image')];print('unique before removing missing previews:',len(items),'removed:',len(items)-len(filtered),'remaining:',len(filtered),'merged overlap records:',counts['overlap']);print('sources:',dict(collections.Counter(x['name'] for s in filtered for x in s['sources'])));print('multiple sources:',sum(len(s['sources'])>1 for s in filtered))
p.write_text(json.dumps(filtered,ensure_ascii=False,separators=(',',':')),encoding='utf8')
