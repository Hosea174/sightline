import requests,re,json,html,concurrent.futures,urllib.parse,time,os
from html.parser import HTMLParser
from pathlib import Path
out=Path('public/study-sites.json')
records={}
def norm(url):
 try:
  u=urllib.parse.urlsplit(url); host=u.hostname.lower().removeprefix('www.'); q=urllib.parse.parse_qsl(u.query,keep_blank_values=True); q=[(k,v) for k,v in q if not (k.lower().startswith('utm_') or k.lower() in ('ref','fbclid','gclid'))]; return urllib.parse.urlunsplit(('https',host,u.path.rstrip('/') or '/',urllib.parse.urlencode(q),''))
 except: return ''
def add(x):
 key=norm(x['url'])
 if not key:return
 x['url']=key
 if key in records:
  a=records[key];a['sources']+= [s for s in x['sources'] if s not in a['sources']];a['tags']=list(dict.fromkeys(a['tags']+x['tags']));a['image']=a['image'] or x['image']
 else:records[key]=x
def get(url):
 for i in range(3):
  try:
   r=requests.get(url,timeout=18,headers={'User-Agent':'Sightline personal research catalog/1.0'});r.raise_for_status();return r.text
  except Exception:time.sleep(i+1)
 return ''
def save():out.write_text(json.dumps(list(records.values()),ensure_ascii=False,separators=(',',':')),encoding='utf8')
class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[];self.active=None;self.depth=0
 def handle_starttag(self,t,attrs):
  d=dict(attrs)
  if t=='a' and d.get('href','').startswith(('http://','https://')):
   self.active={'href':d['href'],'text':'','img':''};self.depth=1
  elif self.active:
   self.depth+=1
   if t=='img' and not self.active['img']:self.active['img']=d.get('src','')
 def handle_endtag(self,t):
  if self.active:
   if t=='a':self.links.append(self.active);self.active=None
   elif t not in ('img','br','input','meta','link'):self.depth-=1
 def handle_data(self,d):
  if self.active:self.active['text']+=d

if out.exists():
 for x in json.loads(out.read_text(encoding='utf8')):add(x)
print('Bookmarkify',flush=True)
for page in range(1,1):
 s=get('https://www.bookmarkify.io/inspiration'+(f'?e4246f2c_page={page}' if page>1 else ''))
 if not s:break
 # Cards use text-inspiration within the destination anchor.
 cards=re.findall(r'<a\s+href="(https?[^" ]+)"[^>]*>(?:(?!</a>).)*?<div class="text-inspiration">(.*?)</div>(?:(?!</a>).)*?</a>',s,re.S)
 before=len(records)
 for url,title in cards:
  chunk=next((z for z in re.findall(r'<a\s+href="'+re.escape(url)+r'"[^>]*>.*?</a>',s,re.S) if 'text-inspiration' in z),''); img=re.search(r'<img[^>]+src="([^"]+)',chunk)
  add(dict(title=html.unescape(re.sub('<[^>]*>','',title)).strip(),url=html.unescape(url),image=html.unescape(img.group(1)) if img else '',tags=[],sources=[{'name':'Bookmarkify','url':'https://www.bookmarkify.io/inspiration','date':None}]))
 print(page,len(cards),len(records),flush=True);save()
 if not cards or len(records)==before or 'aria-label="Next Page"' not in s:break
print('Lapa lists',flush=True)
items={}
for year in range(2023,2027):
 for page in range(1,100):
  u=f'https://www.lapa.ninja/year/{year}/'+(f'page/{page}/' if page>1 else '')
  s=get(u)
  if not s:break
  found=[]
  for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>',s,re.S):
   try:
    j=json.loads(raw);found=j.get('mainEntity',{}).get('itemListElement',[])
    if found:break
   except:pass
  found=[{'url':'https://www.lapa.ninja'+url,'name':html.unescape(title)} for title,url in re.findall(r'<a title="([^"]+)" class="line-clamp-2" href="(/post/[^"]+)"',s)]
  if not found:break
  added=0
  for a in found:
   if a['url'] not in items:items[a['url']]=(a['name'],year);added+=1
  print(year,page,len(found),len(items),flush=True)
  if not added or 'rel="next"' not in s and not re.search(r'>Next<',s):break
print('Lapa details',len(items),flush=True)
def detail(pair):
 url,(title,year)=pair;s=get(url)
 if not s:return None
 try:
  data=next(json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>',s,re.S) if 'CreativeWork' in x)
  match=re.search(r'<a\s+[^>]*href="(https?[^" ]+)"[^>]*>\s*<span>Visit Website</span>',s,re.S)
  if not match:return None
  return dict(title=title,url=html.unescape(match.group(1)),image=data.get('thumbnailUrl',''),tags=[data['genre']] if data.get('genre') else [],sources=[{'name':'Lapa Ninja','url':url,'date':data.get('dateCreated',str(year))}])
 except Exception:return None
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
 for n,x in enumerate(ex.map(detail,items.items()),1):
  if x:add(x)
  if n%50==0:save();print('details',n,'unique',len(records),flush=True)
save();print('DONE',len(records),flush=True)
