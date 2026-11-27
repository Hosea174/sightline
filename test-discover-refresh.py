"""Exercise catalog refresh with fixed feeds, including overlap and failure."""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parent/'scripts'/'refresh-discover.py'
CHILD=r'''
import io, json, os, runpy, sys, urllib.error, urllib.request
feed="""<rss><channel><item><title>New</title><link>https://www.lapa.ninja/post/new/</link><pubDate>Thu, 12 Nov 2026 16:45:47 +0000</pubDate><description>&lt;img src="https://images.test/new.png"&gt;</description></item></channel></rss>"""
listing="""<a href="https://example.test/?utm_source=x"><img src="https://images.test/a.png"><div class="text-inspiration">Example</div></a>"""
def award(slug, url):
 return f'<a aria-label="{slug}" class="figure-rollover__link" href="/sites/{slug}"><img data-srcset="https://images.test/award.png 1x"></a><a href="{url}" data-visit-count-identifier-value="{slug}">Visit</a><span class="budget-tag--sotd">SOTD</span><div><span>Nov 20, 2026</span></div>'
tiles=[
 {'slug':'shared','sourceUrl':'https://www.winner.test/#top'},
 {'slug':'new-pixl','sourceUrl':'https://pixl.test'},
 {'slug':'same-pixl','sourceUrl':'http://www.pixl.test/?utm_source=gallery'},
 {'slug':'social-post','sourceUrl':'https://x.com/example/status/123'},
]
def pixlpin_page(tiles, cursor):
 return json.dumps({'tiles':[{**tile,'image':{'src':'https://images.test/pixl.webp'}} for tile in tiles],
                    'nextCursor':cursor},separators=(',',':'))
pixlpin='<script>self.__next_f.push([1,'+json.dumps('{"initial":'+pixlpin_page(tiles,'page+2')+'}')+'])</script>'
class Response:
 def __init__(self,body): self.body=body.encode()
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def read(self,n): return self.body

def fake(request,timeout=0):
 url=request.full_url
 if 'index.xml' in url:
  if os.environ.get('FAIL_FEED'):raise OSError('offline')
  return Response(feed)
 if 'lapa.ninja/post' in url:return Response('<a href="https://new.test/"><span>Visit Website</span></a>')
 if 'bookmarkify' in url:return Response(listing)
 if 'sites_of_the_day' in url:
  if os.environ.get('FAIL_FEED'):raise OSError('offline')
  if 'page=2' in url:return Response(award('existing','https://example.test/'))
  return Response(award('winner','https://winner.test/?utm_source=awwwards')+'<a href="?page=2">Next</a>')
 if 'pixlpin.com/designs/site' in url:return Response(pixlpin)
 if url=='https://pixlpin.com/api/designs?category=site&cursor=page%2B2':
  return Response(pixlpin_page([tiles[0], {'slug':'scroll-result','sourceUrl':'https://scroll.test'}], 'page-3'))
 if url=='https://pixlpin.com/api/designs?category=site&cursor=page-3':
  raise urllib.error.HTTPError(url,401,'Unauthorized',None,io.BytesIO(b'{"walled":true}'))
 if 'esirop.github.io' in url:
  raise urllib.error.HTTPError(url,304,'Not Modified',None,None)
 raise AssertionError(url)
urllib.request.urlopen=fake
sys.argv=[sys.argv[1],sys.argv[2]]
runpy.run_path(sys.argv[0],run_name='__main__')
'''
class RefreshTest(unittest.TestCase):
 def test_incremental_merge_and_independent_failure(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'sites.json'
   path.write_text(json.dumps([{'title':'Example','url':'https://example.test','image':'a','tags':[],
    'sources':[{'name':'Awwwards','url':'https://www.awwwards.com/sites/existing','date':'2026-11-19','awards':['Honorable Mention']}]}]))
   def run(fail=False):
    env=os.environ.copy()
    if fail:env['FAIL_FEED']='1'
    process=subprocess.run([sys.executable,'-c',CHILD,str(SCRIPT),str(path)],capture_output=True,text=True,env=env,check=True)
    return json.loads(process.stdout)
   first=run();self.assertEqual((first['added'],first['bookmarkMerged']),(1,1))
   self.assertEqual((first['indexAdded'], first['indexErrors'], first['pixlpinAdded'], first['pixlpinMerged'], first['pixlpinErrors']), (1,0,2,2,0))
   self.assertEqual(first['indexMerged'], 1)
   second=run();self.assertEqual((second['added'],second['bookmarkMerged']),(0,0))
   self.assertEqual((second['indexAdded'],second['pixlpinAdded'],second['pixlpinMerged']),(0,0,0))
   failed=run(True);self.assertTrue(failed['lapaFeedError']);self.assertFalse(failed['bookmarkErrors'])
   self.assertEqual((failed['indexErrors'],failed['pixlpinErrors']),(1,0))
   records=json.loads(path.read_text(encoding='utf8'));self.assertEqual(len(records),5)
   self.assertEqual(sum(row['url']=='https://scroll.test' for row in records),1)
   winner=next(row for row in records if 'winner.test' in row['url'])
   self.assertEqual([source['name'] for source in winner['sources']],['Awwwards','Pixlpin'])
   self.assertEqual(winner['sources'][0]['date'],'2026-11-20')
   existing=next(row for row in records if 'example.test' in row['url'])
   self.assertEqual(existing['sources'][0]['awards'],['Honorable Mention','Site of the Day'])
   self.assertEqual(existing['sources'][0]['date'],'2026-11-20')
if __name__=='__main__':unittest.main()
