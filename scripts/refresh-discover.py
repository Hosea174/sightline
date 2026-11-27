"""Incrementally merge public design listings into a Discover catalog.

The RSS feed is finite. If every entry is new, report that the older gap may
need a separate backfill; never treat the feed as a complete archive.
"""
import atexit, html, json, os, re, subprocess, sys, tempfile, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
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
original_count = len(rows)
def key(url):
    try:
        p=urllib.parse.urlsplit(url); host=(p.hostname or '').lower().removeprefix('www.')
        query=tuple(sorted((k,v) for k,v in urllib.parse.parse_qsl(p.query,keep_blank_values=True) if not (k.lower().startswith('utm_') or k.lower() in ('ref','fbclid','gclid','mc_cid','mc_eid'))))
        return (host,p.path.rstrip('/') or '/',query) if host and p.scheme in ('https','http') else None
    except ValueError:return None

def get(url, timeout=20, revalidate=False, extra_headers=None):
    headers = {'User-Agent': 'Sightline/1.0 personal visual research'}
    if revalidate:
        headers['Cache-Control'] = 'no-cache'
    if extra_headers:
        headers.update(extra_headers)
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=timeout) as r:return r.read(5_000_000).decode('utf8','replace')

known_sources={source.get('url','').rstrip('/') for row in rows for source in row.get('sources',[]) if source.get('name')=='Lapa Ninja'}
by_url={key(row.get('url','')):row for row in rows if key(row.get('url',''))}

def merge_listing_site(url, title, image, source, source_rows):
    """Keep the saved destination and attach each source page only once."""
    destination = key(url)
    source_url = source['url'].rstrip('/')
    row = source_rows.get(source_url) or by_url.get(destination)
    if row is None:
        row = {'title': title, 'url': url, 'image': image, 'tags': [], 'sources': [source]}
        rows.append(row)
        by_url[destination] = row
        source_rows[source_url] = row
        return 'added'
    if not row.get('image'):
        row['image'] = image
    if source_url in source_rows:
        saved = next(entry for entry in row['sources'] if entry['url'].rstrip('/') == source_url and entry['name'] == source['name'])
        if 'awards' not in source or 'Site of the Day' in saved.get('awards', []):
            return 'known'
        saved['awards'] = list(dict.fromkeys(saved.get('awards', []) + source['awards']))
        saved['date'] = source['date']
    else:
        row.setdefault('sources', []).append(source)
        source_rows[source_url] = row
    return 'merged'

def listings_by_source(name, award=None):
    return {source['url'].rstrip('/'): row for row in rows for source in row.get('sources', [])
            if source.get('name') == name and source.get('url') and (award is None or award in source.get('awards', []))}

def pixlpin_first_page(page):
    # Pixlpin embeds the first page of the Sites gallery in its server-rendered data.
    for match in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', page):
        chunk = json.loads(match[1])
        marker = '"initial":'
        offset = chunk.find(marker + '{"tiles":')
        if offset != -1:
            data = json.JSONDecoder().raw_decode(chunk[offset + len(marker):])[0]
            if data['tiles']:
                return data
    raise ValueError('no website tiles found')

def pixlpin_tiles(base):
    listing = base + '/designs/site'
    data = pixlpin_first_page(get(listing))
    seen = set()
    while True:
        yield from data['tiles']
        cursor = data['nextCursor']
        if cursor is None:
            return
        if not isinstance(cursor, str) or not cursor or cursor in seen:
            raise ValueError('invalid or repeated Pixlpin page cursor')
        seen.add(cursor)
        params = urllib.parse.urlencode({'category': 'site', 'cursor': cursor})
        try:
            data = json.loads(get(base + '/api/designs?' + params,
                                  extra_headers={'Accept': 'application/json', 'Referer': listing}))
        except urllib.error.HTTPError as e:
            if e.code == 401 and json.loads(e.read(4096)).get('walled') is True:
                return
            raise

def awwwards_cards(page):
    # Each preview link begins a card with its own outbound visit link and award date.
    cards = re.split(r'<a\s+aria-label="([^"]+)"\s+class="figure-rollover__link"\s+href="/sites/([\w-]+)"', page)
    winners = [(title, slug, card) for title, slug, card in zip(cards[1::3], cards[2::3], cards[3::3])
               if 'budget-tag--sotd"' in card]
    if not winners:
        raise ValueError('no Site of the Day cards found')
    return winners

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

awwwards_base = 'https://www.awwwards.com'
awwwards_listing = awwwards_base + '/websites/sites_of_the_day/'
awwwards_sources = listings_by_source('Awwwards')
known_awwwards = set(listings_by_source('Awwwards', 'Site of the Day'))
try:
    for page_number in range(1, 11):
        listing = f'{awwwards_listing}?page={page_number}'
        try:
            page = get(awwwards_listing if page_number == 1 else listing, timeout=12, revalidate=True)
        except OSError:
            page = get(listing, revalidate=True)
        overlap = False
        for title, slug, card in awwwards_cards(page):
            source_url = awwwards_base + '/sites/' + slug
            if source_url in known_awwwards:
                overlap = True
                continue
            try:
                visit = re.search(r'<a\s+[^>]*href="([^"]+)"[^>]*data-visit-count-identifier-value="' + re.escape(slug) + '"', card)
                preview = re.search(r'data-srcset="([^"\s]+)', card)
                award = card.split('budget-tag--sotd"', 1)[1].split('</div>', 1)[0]
                date = re.search(r'>([A-Z][a-z]{2} \d{1,2}, \d{4})<', award)
                url = html.unescape(visit[1]) if visit else ''
                if not key(url) or not preview or not date:
                    raise ValueError('website link, preview or award date missing')
                source = {'name': 'Awwwards', 'url': source_url,
                          'date': datetime.strptime(date[1], '%b %d, %Y').date().isoformat(),
                          'awards': ['Site of the Day']}
                if 'budget-tag--dev' in card:
                    source['awards'].append('Developer Award')
                result = merge_listing_site(url, html.unescape(title), html.unescape(preview[1]), source, awwwards_sources)
                index_added += result == 'added'
                index_merged += result == 'merged'
            except ValueError as e:
                index_errors += 1
                print('Awwwards card:', source_url, str(e), file=sys.stderr)
        if overlap or f'?page={page_number + 1}"' not in page:
            break
    else:
        raise ValueError('stopped after 10 pages without overlap')
except Exception as e:
    index_errors += 1
    print('Awwwards official listing:', str(e), file=sys.stderr)

if index_errors:
    try:
        headers={'User-Agent':'Sightline/1.0 personal visual research'}
        if index_state.get('etag'):headers['If-None-Match']=index_state['etag']
        request=urllib.request.Request('https://esirop.github.io/awwwards-sotd-index/data/sotd.js',headers=headers)
        fallback_errors=0
        try:
            with urllib.request.urlopen(request,timeout=30) as response:
                data=response.read(8_000_001)
                if len(data)>8_000_000:raise ValueError('Awwwards index exceeds size limit')
                etag=response.headers.get('ETag','')
            index=json.loads(data[data.index(b'{'):].rstrip(b';\n\r '))
            updated=index.get('updated','')
            try:index_stale=(datetime.now(timezone.utc)-datetime.fromisoformat(updated.replace('Z','+00:00'))).days>7
            except ValueError:index_stale=True
            latest=max((source.get('date') or '' for row in rows for source in row.get('sources',[])
                        if source.get('name')=='Awwwards' and 'Site of the Day' in source.get('awards', [])),default='')
            for site in index.get('sites',[]):
                date=site.get('d') or ''; url=site.get('u') or ''; slug=site.get('s') or ''
                if not date or date<latest or not key(url) or not slug:continue
                source_url=awwwards_base+'/sites/'+slug
                if source_url in known_awwwards:
                    continue
                image=site.get('i') or ''
                if not image:continue
                try:
                    if key(url) not in by_url:
                        req=urllib.request.Request(url,method='GET',headers={'User-Agent':'Sightline/1.0 personal visual research'})
                        with urllib.request.urlopen(req,timeout=12) as check:
                            if check.status!=200 or 'text/html' not in check.headers.get('Content-Type','').lower():raise ValueError('destination is not HTML')
                    source={'name':'Awwwards','url':source_url,'date':date,'awards':['Site of the Day']}
                    palette=[c.lower() for c in site.get('c',[]) if isinstance(c,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',c)][:2]
                    result=merge_listing_site(url,site.get('t') or 'Untitled',image,source,awwwards_sources)
                    if result=='added' and palette:by_url[key(url)].update(colors=palette,colorSource='awwwards')
                    index_added+=result=='added'
                    index_merged+=result=='merged'
                except Exception as e:
                    fallback_errors+=1;print('Awwwards destination:',url,str(e),file=sys.stderr)
            if not fallback_errors:pending_index_state={'etag':etag,'updated':updated}
        except urllib.error.HTTPError as e:
            if e.code!=304:raise
            try:index_stale=(datetime.now(timezone.utc)-datetime.fromisoformat(index_state.get('updated','').replace('Z','+00:00'))).days>7
            except ValueError:index_stale=True
    except Exception as e:
        index_errors+=1;print('Awwwards index:',str(e),file=sys.stderr)

pixlpin_added = pixlpin_merged = pixlpin_errors = 0
pixlpin_base = 'https://pixlpin.com'
try:
    pixlpin_sources = listings_by_source('Pixlpin')
    usable = 0
    for tile in pixlpin_tiles(pixlpin_base):
        url = tile.get('sourceUrl') or ''
        slug = tile.get('slug') or ''
        image = (tile.get('image') or {}).get('src') or ''
        if not key(url) or not key(image) or not re.fullmatch(r'[\w-]+', slug):
            continue
        host = key(url)[0]
        if host in {'pixlpin.com', 'x.com', 'twitter.com', 'instagram.com', 'dribbble.com', 'behance.net'}:
            continue
        usable += 1
        source = {'name': 'Pixlpin', 'url': pixlpin_base + '/d/' + slug, 'date': None}
        result = merge_listing_site(url, tile.get('title') or 'Untitled', image, source, pixlpin_sources)
        pixlpin_added += result == 'added'
        pixlpin_merged += result == 'merged'
    if not usable:
        raise ValueError('no tiles with a website and preview')
except Exception as e:
    pixlpin_errors += 1
    print('Pixlpin:', str(e), file=sys.stderr)

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

rows = rows[original_count:] + rows[:original_count]
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
print(json.dumps({'pixlpinAdded':pixlpin_added,'pixlpinMerged':pixlpin_merged,'pixlpinErrors':pixlpin_errors,'cssAdded':css_added,'cssMerged':css_merged,'cssErrors':css_errors,'cssStatus':css_status,'indexAdded':index_added,'indexMerged':index_merged,'indexErrors':index_errors,'indexStale':index_stale,'added':added,'merged':merged,'known':skipped,'feedCount':len(items),'possibleGap':bool(items) and skipped==0,'lapaFeedError':feed_error,'errors':errors,'bookmarkAdded':bookmark_added,'bookmarkMerged':bookmark_merged,'bookmarkErrors':bookmark_errors}))
