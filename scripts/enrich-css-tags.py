import subprocess,json,shutil
from pathlib import Path
p=Path('scripts/css-seed.json');rows=json.loads(p.read_text(encoding='utf8'));cli=shutil.which('agent-browser')
for i in range(0,len(rows),30):
 paths=[x['sources'][0]['url'] for x in rows[i:i+30]]
 js='''(async()=>{let urls=URLS,out=[];for(let i=0;i<urls.length;i+=5){let batch=await Promise.all(urls.slice(i,i+5).map(async u=>{try{let r=await fetch(u);if(!r.ok)return null;let d=new DOMParser().parseFromString(await r.text(),'text/html');return [...new Set([...d.querySelectorAll('a[href^="/website-gallery?feature="],a[href^="/website-gallery?industry="]')].map(a=>a.textContent.trim()).filter(Boolean))]}catch{return null}}));out.push(...batch)}return out})()'''.replace('URLS',json.dumps(paths))
 try:
  result=subprocess.run([cli,'--session','sightline-research','eval','--stdin','--json'],input=js,text=True,capture_output=True,encoding='utf8',timeout=180);tags=json.loads(result.stdout)['data']['result']
  for row,t in zip(rows[i:i+30],tags):
   if t:row['tags']=t
  p.write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf8');print('tags',min(i+30,len(rows)),flush=True)
 except Exception as e:print('error',i,str(e),flush=True);break
