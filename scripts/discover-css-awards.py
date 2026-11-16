"""Collect CSS Design Awards winners newer than the latest seeded source."""
import argparse, json, os, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

BASE = 'https://www.cssdesignawards.com'
MAX_PAGES = 10


def source_url(row):
    return next((s.get('url', '') for s in row.get('sources', [])
                 if s.get('name') == 'CSS Design Awards'), '')


def browser_session():
    cli = shutil.which('agent-browser')
    if not cli:
        raise RuntimeError('agent-browser is not installed or not on PATH')
    return cli, 'sightline-css-' + uuid.uuid4().hex



def run_browser(cli, session, *args, input=None):
    result = subprocess.run([cli, '--session', session, '--json', *args], input=input,
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f'agent-browser exited {result.returncode}')
    response = json.loads(result.stdout)
    if not response.get('success'):
        raise RuntimeError(str(response.get('error') or 'agent-browser failed'))
    return response.get('data', {}).get('result')


def collect(seed, cli, session, runner=run_browser):
    latest = max((s.get('date', '') for row in seed for s in row.get('sources', [])
                  if s.get('name') == 'CSS Design Awards' and s.get('date')), default='')
    boundary = [source_url(row).rstrip('/') for row in seed
                if any(s.get('name') == 'CSS Design Awards' and s.get('date') == latest
                       for s in row.get('sources', []))]
    if not latest or not boundary:
        raise ValueError('seed has no dated CSS Design Awards source URL; refusing a historical crawl')

    runner(cli, session, 'open', BASE + '/wotd-award-winners')
    rows, errors, reached = [], [], False
    for page in range(1, MAX_PAGES + 1):
        js = r'''(async()=>{
const boundary=new Set(BOUNDARY.map(x=>new URL(x,location.origin).pathname.replace(/\/$/,'')));
const response=await fetch('/wotd-award-winners?page=PAGE');
if(!response.ok)throw new Error('listing HTTP '+response.status);
const doc=new DOMParser().parseFromString(await response.text(),'text/html');
const paths=[...new Set([...doc.querySelectorAll('a[href^="/sites/"]')].map(a=>new URL(a.href).pathname))];
const result=[],errors=[];let boundaryReached=false;
for(const path of paths){
 if(boundary.has(path.replace(/\/$/,''))){boundaryReached=true;break;}
 try{
  const r=await fetch(path);if(!r.ok)throw new Error('detail HTTP '+r.status);
  const d=new DOMParser().parseFromString(await r.text(),'text/html');
  const h=d.querySelector('h1')?.textContent.trim()||'';
  const m=h.match(/(20\d{2})\s+([A-Za-z]{3})\s+(\d{1,2})/);
  const a=d.querySelector('a.single-website__thumbnail');
  const image=d.querySelector('meta[property="og:image"]')?.content||'';
  if(!m||!a?.href||!image)throw new Error('missing date, destination, or preview image');
  const date=new Date(`${m[2]} ${m[3]}, ${m[1]} UTC`).toISOString().slice(0,10);
  if(date<DATE){boundaryReached=true;break;}
  result.push({title:d.querySelector('h2')?.textContent.trim()||'Untitled',url:a.href,image,
    tags:[...d.querySelectorAll('a[href*="/tags/"]')].map(x=>x.textContent.trim()).filter(Boolean),
    sources:[{name:'CSS Design Awards',url:new URL(path,location.origin).href,date,awards:['Website of the Day']}]});
 }catch(e){errors.push({url:new URL(path,location.origin).href,error:String(e)});}
}
return {result,errors,boundaryReached,pathCount:paths.length};})()'''
        js = js.replace('BOUNDARY', json.dumps(boundary)).replace('PAGE', str(page)).replace('DATE', json.dumps(latest))
        try:
            result = runner(cli, session, 'eval', '--stdin', input=js)
        except Exception as e:
            errors.append({'page': page, 'error': str(e)})
            break
        if not isinstance(result, dict):
            errors.append({'page': page, 'error': 'browser returned an invalid listing result'})
            break
        rows.extend(result.get('result', []))
        errors.extend(result.get('errors', []))
        if result.get('boundaryReached'):
            reached = True
            break
        if not result.get('pathCount'):
            errors.append({'page': page, 'error': 'listing page has no CSSDA entries'})
            break
    if not reached:
        errors.append({'error': f'known URL boundary not reached within {MAX_PAGES} pages; results may be incomplete'})
    return rows, errors, latest


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=path.stem + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as out:
            json.dump(value, out, ensure_ascii=False, separators=(',', ':'))
            out.flush()
        Path(temp).replace(path)
    finally:
        Path(temp).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=Path(globals().get('__file__', 'scripts/discover-css-awards.py')).with_name('css-seed.json'))
    parser.add_argument('--output', type=Path, default=Path(globals().get('__file__', 'scripts/discover-css-awards.py')).with_name('css-awards-candidates.json'))
    args = parser.parse_args(argv)
    seed = json.loads(args.seed.read_text(encoding='utf8'))
    cli, session = browser_session()
    try:
        rows, errors, latest = collect(seed, cli, session)
    finally:
        subprocess.run([cli, '--session', session, 'close'], capture_output=True, text=True, timeout=30)
    write_json(args.output, rows)
    for error in errors:
        print('CSS Design Awards:', json.dumps(error, ensure_ascii=False), file=sys.stderr)
    print(json.dumps({'added': len(rows), 'errors': len(errors), 'boundaryDate': latest,
                      'candidates': str(args.output)}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
