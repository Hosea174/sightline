import requests,re,json,html,xml.etree.ElementTree as ET
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
base='https://godly.design'; sitemap=requests.get(base+'/sitemap.xml',timeout=25).text
urls=re.findall(r'<loc>(https://godly\.design/website/[^<]+)</loc>',sitemap)
def get(u):
 try:
  r=requests.get(u,timeout=20);r.encoding='utf-8';s=r.text
  dst=re.search(r'<a href="(https?://[^" ]+)" target="_blank" rel="nofollow noopener"',s)
  name=re.search(r'<title>(.*?)</title>',s,re.S)
  image=re.search(r'<meta property="og:image" content="([^"]+)',s)
  if not image:image=re.search(r'<meta content="([^"]+)" property="og:image"',s)
  if not image:
   m=re.search(r'<script type="application/ld\+json">(.*?)</script>',s,re.S)
   for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>',s,re.S):
    try:
     j=json.loads(raw)
     if j.get('image'):
      image=type('Match',(),{'group':lambda self,n:j['image']})()
      break
    except:pass
  tag=re.search(r'>Industry</div><div[^>]*>([^<]+)',s)
  if dst and name:
   return {'title':html.unescape(re.sub(r'\s*[—–-]\s*Godly.*','',name.group(1))), 'url':html.unescape(dst.group(1)),'image':html.unescape(image.group(1)) if image else '', 'tags':[html.unescape(tag.group(1))] if tag else [],'sources':[{'name':'Godly','url':u,'date':None}]}
 except Exception:return None
with ThreadPoolExecutor(max_workers=4) as ex: rows=[x for x in ex.map(get,urls) if x]
Path('scripts/godly-seed.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8');print('Godly entries',len(rows),'of',len(urls))
