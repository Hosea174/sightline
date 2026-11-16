import json,re,urllib.parse,datetime
from pathlib import Path
p=Path('public/study-sites.json'); sites=json.loads(p.read_text(encoding='utf8')); rows=json.loads(Path('scripts/awwwards-seed.json').read_text(encoding='utf8'))
def key(url):
 try:
  u=urllib.parse.urlsplit(url);return (u.hostname.lower().removeprefix('www.'),u.path.rstrip('/') or '/',u.query)
 except:return None
index={key(x['url']):x for x in sites}
added=0
for r in rows:
 url=r.get('liveUrl');awards=r.get('awards',[])
 if not url or not url.startswith(('https://','http://')):continue
 dated=[]
 for a in awards:
  try:
   d=datetime.datetime.strptime(a['date'],'%b %d, %Y').date()
   if d.year>=2023:dated.append((a['title'],str(d)))
  except:pass
 if not dated:continue
 source={'name':'Awwwards','url':'https://www.awwwards.com/sites/'+r['slug'],'date':dated[0][1],'awards':[x[0] for x in dated]}
 k=key(url);tags=[x.strip() for x in re.sub(r' \+\d+$','',r.get('tags','')).split(',') if x.strip()]
 if k in index:
  site=index[k];site['sources'].append(source);site['tags']=list(dict.fromkeys(site['tags']+tags));site['image']=site['image'] or r.get('ogImage','')
 else:
  site={'title':re.sub(r' - Awwwards.*$','',r['title']),'url':url,'image':r.get('ogImage',''),'tags':tags,'sources':[source]};sites.append(site);index[k]=site;added+=1
p.write_text(json.dumps(sites,ensure_ascii=False,separators=(',',':')),encoding='utf8');print('Awwwards added',added,'total',len(sites))
