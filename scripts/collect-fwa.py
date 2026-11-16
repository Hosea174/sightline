import requests,json,time
from pathlib import Path
p=Path('scripts/fwa-archive.json');all=json.loads(p.read_text(encoding='utf8')) if p.exists() else []
for year in range(2025,2027):
 for offset in range(0,1000,100):
  try:
   r=requests.get('https://legacy.thefwa.com/api/cases/',params={'offset':offset,'limit':100,'year':year},timeout=35);r.raise_for_status();data=r.json();cases=data.get('cases',[])
  except Exception as e:print('error',year,offset,str(e),flush=True);break
  for x in cases:
   awards=[a for a in x.get('awards',[]) if a.get('awardedDate','')>='2023-01-01']
   if awards:all.append({'title':x.get('title'),'slug':x.get('slug'),'url':x.get('url'),'image':'https://legacy.thefwa.com'+x.get('thumbnail',{}).get('958',{}).get('span5',''),'awards':awards})
  print(year,offset,len(cases),flush=True);p.write_text(json.dumps(all,ensure_ascii=False,separators=(',',':')),encoding='utf8')
  if len(cases)<100 or not any(a.get('awardedDate','').startswith(str(year)) for x in cases for a in x.get('awards',[])):break
print('total',len(all),flush=True)
