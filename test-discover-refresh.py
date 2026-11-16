"""Exercise catalog refresh with fixed feeds, including overlap and failure."""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parent/'scripts'/'refresh-discover.py'
CHILD=r'''
import io, os, runpy, sys, urllib.request
feed="""<rss><channel><item><title>New</title><link>https://www.lapa.ninja/post/new/</link><pubDate>Thu, 12 Nov 2026 16:45:47 +0000</pubDate><description>&lt;img src="https://images.test/new.png"&gt;</description></item></channel></rss>"""
listing="""<a href="https://example.test/?utm_source=x"><img src="https://images.test/a.png"><div class="text-inspiration">Example</div></a>"""
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
 if 'esirop.github.io' in url:
  import urllib.error
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
   path.write_text(json.dumps([{'title':'Example','url':'https://example.test','image':'a','tags':[],'sources':[]}]))
   def run(fail=False):
    env=os.environ.copy()
    if fail:env['FAIL_FEED']='1'
    process=subprocess.run([sys.executable,'-c',CHILD,str(SCRIPT),str(path)],capture_output=True,text=True,env=env,check=True)
    return json.loads(process.stdout)
   first=run();self.assertEqual((first['added'],first['bookmarkMerged']),(1,1))
   second=run();self.assertEqual((second['added'],second['bookmarkMerged']),(0,0))
   failed=run(True);self.assertTrue(failed['lapaFeedError']);self.assertFalse(failed['bookmarkErrors'])
   records=json.loads(path.read_text(encoding='utf8'));self.assertEqual(len(records),2)
   self.assertEqual(len(records[0]['sources']),1)
if __name__=='__main__':unittest.main()
