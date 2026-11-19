"""Incrementally merge recent public Lapa and Bookmarkify listings into a Discover catalog.

The RSS feed is finite. If every entry is new, report that the older gap may
need a separate backfill; never treat the feed as a complete archive.
"""
import atexit, html, json, os, re, subprocess, sys, tempfile, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

path=Path(sys.argv[1])
# Lock the same byte for the lifetime of this process, including across GUI and
# scheduled runs; the OS releases it if a process exits unexpectedly.
lock_file=open(path.with_suffix('.lock'),'a+b')
lock_file.seek(0);lock_file.write(b'0');lock_file.flush();lock_file.seek(0)
try:
    if os.name=='nt':
        import msvcrt
        msvcrt.locking(lock_file.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock_file,fcntl.LOCK_EX|fcntl.LOCK_NB)
except OSError:
    raise SystemExit('Another Discover refresh is already running')
atexit.register(lock_file.close)
rows=json.loads(path.read_text(encoding='utf8'))
def key(url):
    try:
        p=urllib.parse.urlsplit(url); host=(p.hostname or '').lower().removeprefix('www.')
        query=tuple(sorted((k,v) for k,v in urllib.parse.parse_qsl(p.query,keep_blank_values=True) if not (k.lower().startswith('utm_') or k.lower() in ('ref','fbclid','gclid','mc_cid','mc_eid'))))
        return (host,p.path.rstrip('/') or '/',query) if host and p.scheme in ('https','http') else None
    except ValueError:return None

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Sightline/1.0 personal visual research'})
    with urllib.request.urlopen(req,timeout=20) as r:return r.read(5_000_000).decode('utf8','replace')

known_sources={source.get('url','').rstrip('/') for row in rows for source in row.get('sources',[]) if source.get('name')=='Lapa Ninja'}
by_url={key(row.get('url','')):row for row in rows if key(row.get('url',''))}
added=merged=skipped=errors=0
feed_error=False
try:
    root=ET.fromstring(get('https://www.lapa.ninja/index.xml'));items=root.findall('./channel/item')
    if not items:raise ValueError('Lapa feed returned no items')
except Exception as e:
    items=[];feed_error=True;errors+=1
    print('Lapa feed:',str(e),file=sys.stderr)
for item in items:
    link=(item.findtext('link') or '').rstrip('/')
    if not link or link in known_sources:skipped+=1;continue
    try:
        page=get(link)
        destination=re.search(r'<a\s+[^>]*href="(https?[^" ]+)"[^>]*>\s*<span>Visit Website</span>',page,re.S)
        if not destination:raise ValueError('website link missing')
        url=html.unescape(destination.group(1)); k=key(url)
        if not k:raise ValueError('invalid website link')
        description=item.findtext('description') or ''
        match=re.search(r'<img[^>]+src="([^"]+)',description)
        image=html.unescape(match.group(1)) if match else ''
        date=parsedate_to_datetime(item.findtext('pubDate')).date().isoformat()
        source={'name':'Lapa Ninja','url':link+'/', 'date':date}
        if k in by_url:
            by_url[k].setdefault('sources',[]).append(source);merged+=1
            if not by_url[k].get('image'):by_url[k]['image']=image
        elif image:
            row={'title':item.findtext('title') or 'Untitled','url':url,'image':image,'tags':[],'sources':[source]};rows.append(row);by_url[k]=row;added+=1
        else:raise ValueError('preview image missing')
    except Exception as e:
        errors+=1;print('Skipped',link,str(e),file=sys.stderr)
# The unofficial SOTD index is conditionally fetched. Its source timestamp
# can lag the live awards, so report staleness and only add newer verified URLs.
index_state_path=path.with_name('discover-awwwards-state.json')
try:index_state=json.loads(index_state_path.read_text(encoding='utf8'))
except (OSError,ValueError):index_state={}
index_added=index_merged=index_errors=0
index_stale=False;pending_index_state=None
try:
    headers={'User-Agent':'Sightline/1.0 personal visual research'}
    if index_state.get('etag'):headers['If-None-Match']=index_state['etag']
    request=urllib.request.Request('https://esirop.github.io/awwwards-sotd-index/data/sotd.js',headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            data=response.read(8_000_001)
            if len(data)>8_000_000:raise ValueError('Awwwards index exceeds size limit')
            etag=response.headers.get('ETag','')
        index=json.loads(data[data.index(b'{'):].rstrip(b';\n\r '))
        import datetime
        updated=index.get('updated','')
        try:index_stale=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(updated.replace('Z','+00:00'))).days>7
        except ValueError:index_stale=True
        latest=max((source.get('date') or '' for row in rows for source in row.get('sources',[]) if source.get('name')=='Awwwards'),default='')
        for site in index.get('sites',[]):
            date=site.get('d') or ''; url=site.get('u') or ''; slug=site.get('s') or ''
            if not date or date<latest or not key(url) or not slug:continue
            k=key(url);source_url='https://www.awwwards.com/sites/'+slug
            if k in by_url:
                row=by_url[k]
                if not any(x.get('name')=='Awwwards' and x.get('url','').rstrip('/')==source_url for x in row.get('sources',[])):
                    row.setdefault('sources',[]).append({'name':'Awwwards','url':source_url,'date':date,'awards':['Site of the Day']});index_merged+=1
                continue
            image=site.get('i') or ''
            if not image:continue
            try:
                req=urllib.request.Request(url,method='GET',headers={'User-Agent':'Sightline/1.0 personal visual research'})
                with urllib.request.urlopen(req,timeout=12) as check:
                    if check.status!=200 or 'text/html' not in check.headers.get('Content-Type','').lower():raise ValueError('destination is not HTML')
                    check.read(2048)
                source={'name':'Awwwards','url':source_url,'date':date,'awards':['Site of the Day']}
                palette=[c.lower() for c in site.get('c',[]) if isinstance(c,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',c)][:2]
                row={'title':site.get('t') or 'Untitled','url':url,'image':image,'tags':[],'sources':[source]}
                if palette:row.update(colors=palette,colorSource='awwwards')
                rows.append(row);by_url[k]=row;index_added+=1
            except Exception as e:
                index_errors+=1;print('Awwwards destination:',url,str(e),file=sys.stderr)
        if not index_errors:pending_index_state={'etag':etag,'updated':updated}
    except urllib.error.HTTPError as e:
        if e.code!=304:raise
        import datetime
        try:index_stale=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(index_state.get('updated','').replace('Z','+00:00'))).days>7
        except ValueError:index_stale=True
except Exception as e:
    index_errors+=1;print('Awwwards index:',str(e),file=sys.stderr)

# Bookmarkify publishes a reverse chronological card listing. Only continue
# past the first page if it has no overlap with our saved destinations.
bookmark_added=bookmark_merged=bookmark_errors=0
try:
    for page_number in range(1, 11):
        listing='https://www.bookmarkify.io/inspiration'+(f'?e4246f2c_page={page_number}' if page_number>1 else '')
        page=get(listing)
        cards=re.findall(r'<a\s+href="(https?[^" ]+)"[^>]*>((?:(?!</a>).)*?<div class="text-inspiration">(.*?)</div>(?:(?!</a>).)*)</a>',page,re.S)
        if not cards:raise ValueError('no website cards found')
        overlap=0
        for raw_url,body,raw_title in cards:
            url=html.unescape(raw_url);k=key(url)
            if not k:continue
            img=re.search(r'<img[^>]+src="([^"]+)',body)
            image=html.unescape(img.group(1)) if img else ''
            source={'name':'Bookmarkify','url':'https://www.bookmarkify.io/inspiration','date':None}
            if k in by_url:
                overlap+=1
                row=by_url[k]
                if not any(x.get('name')=='Bookmarkify' for x in row.get('sources',[])):
                    row.setdefault('sources',[]).append(source);bookmark_merged+=1
                if not row.get('image') and image:row['image']=image
            elif image:
                title=html.unescape(re.sub('<[^>]*>','',raw_title)).strip()
                row={'title':title or 'Untitled','url':url,'image':image,'tags':[],'sources':[source]}
                rows.append(row);by_url[k]=row;bookmark_added+=1
        if overlap or 'e4246f2c_page=' + str(page_number+1) not in page:break
    else:
        print('Bookmarkify: stopped after 10 pages without overlap',file=sys.stderr)
        bookmark_errors+=1
except Exception as e:
    bookmark_errors+=1;print('Bookmarkify:',str(e),file=sys.stderr)

# CSS Design Awards requires browser rendering on this source. The collector
# stops at the latest known source URL and reports an incomplete scan explicitly.
css_added=css_merged=css_errors=0
css_status='unavailable'
collector=os.environ.get('SIGHTLINE_CSS_COLLECTOR')
if collector:
    fd,css_file=tempfile.mkstemp(dir=path.parent,prefix='discover-css-',suffix='.json');os.close(fd)
    try:
        process=subprocess.run([sys.executable,'-c',collector,'--seed',str(path),'--output',css_file],capture_output=True,text=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8'},timeout=240,creationflags=0x08000000 if os.name=='nt' else 0)
        try:candidates=json.loads(Path(css_file).read_text(encoding='utf8'))
        except (ValueError,OSError):candidates=[]
        for row in candidates:
            k=key(row.get('url',''))
            if not k or not row.get('image') or not isinstance(row.get('sources'),list):continue
            if k in by_url:
                current=by_url[k]
                for source in row['sources']:
                    if not any(x.get('name')==source.get('name') and x.get('url','').rstrip('/')==source.get('url','').rstrip('/') for x in current.get('sources',[])):
                        current.setdefault('sources',[]).append(source);css_merged+=1
                current['tags']=list(dict.fromkeys(current.get('tags',[])+row.get('tags',[])))
            else:rows.append(row);by_url[k]=row;css_added+=1
        css_status='complete' if process.returncode==0 else 'incomplete'
        if process.returncode:css_errors=1;print('CSS Design Awards incomplete:',process.stderr[-600:],file=sys.stderr)
    except (OSError,subprocess.TimeoutExpired) as e:
        css_errors=1;css_status='incomplete';print('CSS Design Awards:',str(e),file=sys.stderr)
    finally:
        try:os.unlink(css_file)
        except OSError:pass

fd,temp=tempfile.mkstemp(dir=path.parent,prefix='discover-sites.',suffix='.tmp')
try:
    with os.fdopen(fd,'w',encoding='utf8') as out:json.dump(rows,out,ensure_ascii=False,separators=(',',':'));out.flush();os.fsync(out.fileno())
    os.replace(temp,path)
finally:
    if os.path.exists(temp):os.unlink(temp)
if pending_index_state is not None:
    fd,state_temp=tempfile.mkstemp(dir=path.parent,prefix='discover-awwwards-',suffix='.tmp')
    try:
        with os.fdopen(fd,'w',encoding='utf8') as state_file:json.dump(pending_index_state,state_file);state_file.flush();os.fsync(state_file.fileno())
        os.replace(state_temp,index_state_path)
    finally:
        if os.path.exists(state_temp):os.unlink(state_temp)
print(json.dumps({'cssAdded':css_added,'cssMerged':css_merged,'cssErrors':css_errors,'cssStatus':css_status,'indexAdded':index_added,'indexMerged':index_merged,'indexErrors':index_errors,'indexStale':index_stale,'added':added,'merged':merged,'known':skipped,'feedCount':len(items),'possibleGap':bool(items) and skipped==0,'lapaFeedError':feed_error,'errors':errors,'bookmarkAdded':bookmark_added,'bookmarkMerged':bookmark_merged,'bookmarkErrors':bookmark_errors}))
