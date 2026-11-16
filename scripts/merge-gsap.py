import json,urllib.parse
from pathlib import Path
p=Path('public/study-sites.json');sites=json.loads(p.read_text(encoding='utf8'))
def key(u):
 x=urllib.parse.urlsplit(u);return (x.hostname.lower().removeprefix('www.'),x.path.rstrip('/') or '/')
idx={key(s['url']):s for s in sites}
for title,url,date,source in [
 ('Khanh Nguyen Portfolio','https://khanhnguyen.design/','2026-09-21','https://bsky.app/profile/gsap-greensock.bsky.social/post/3mvzb27ry2c25'),
 ('HOLM','https://byholm.co/','2026-11-06','https://gsap.com/showcase/'),
 ('Deriva','https://derivamusic.com/welcome','2026-11-05','https://gsap.com/showcase/'),
 ('Relevo & Vinco','https://relevovinco.com/','2026-11-04','https://gsap.com/showcase/'),
 ('Overworld Audio','https://overworldaudio.com/','2026-11-03','https://gsap.com/showcase/')]:
 meta={'name':'GSAP','url':source,'date':date,'awards':['Site of the Day']};k=key(url)
 if k in idx:idx[k]['sources'].append(meta)
 else:sites.append({'title':title,'url':url,'image':'','tags':['Animation','GSAP'],'sources':[meta]})
p.write_text(json.dumps(sites,ensure_ascii=False,separators=(',',':')),encoding='utf8')
