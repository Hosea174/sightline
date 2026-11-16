import importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
path=Path(__file__).resolve().parent/'scripts'/'sightline-instagram-sync.py'
spec=importlib.util.spec_from_file_location('instagram_sync',path);sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class InstagramSyncTest(unittest.TestCase):
 def test_owner_metadata_updates_imported_post_without_storing_unrelated_fields(self):
  raw=json.dumps([[3,'https://cdn.test/x',{'post_id':'42','shortcode':'abc','username':'artist.name','sessionid':'secret'}],[3,'https://cdn.test/y',{'post_id':'42','shortcode':'abc'}]])
  found,errors=sync.parse_dump(raw,include_owner=True)
  self.assertEqual(found,{'42':{'url':'https://www.instagram.com/p/abc/','username':'artist.name'}});self.assertFalse(errors)
  with tempfile.TemporaryDirectory() as d:
   state=Path(d)/'queue.json';url='https://www.instagram.com/u/saved/x/1';args=['sync','--state',str(state),'--collection',f'post-ideas=Post Ideas={url}']
   state.write_text(json.dumps({'posts':{'42:Post Ideas':{'url':found['42']['url'],'status':'imported'}},'collections':{}}),encoding='utf8')
   with patch.object(sys,'argv',args),patch.object(sync,'scan',return_value=(found,None)):sync.main()
   data=state.read_text(encoding='utf8');post=json.loads(data)['posts']['42:Post Ideas'];self.assertEqual(post['username'],'artist.name');self.assertEqual(post['status'],'imported');self.assertNotIn('secret',data)
 def test_two_categories_deduplicate_and_failure_preserves_queue(self):
  with tempfile.TemporaryDirectory() as d:
   state=Path(d)/'queue.json';url='https://www.instagram.com/user/saved/ideas/123';url2='https://www.instagram.com/user/saved/web/456'
   args=['sync','--state',str(state),'--collection',f'post-ideas=Post Ideas={url}','--collection',f'web-design=Web design={url2}']
   with patch.object(sys,'argv',args),patch.object(sync,'scan',return_value=({'42':'https://www.instagram.com/p/abc/'},None)):sync.main()
   result=json.loads(state.read_text(encoding='utf8'));self.assertEqual(set(result['posts']),{'42:Post Ideas','42:Web design'})
   result['posts']['42:Post Ideas']['status']='imported';state.write_text(json.dumps(result),encoding='utf8')
   with patch.object(sys,'argv',args),patch.object(sync,'scan',return_value=({},'authentication failed')):sync.main()
   again=json.loads(state.read_text(encoding='utf8'));self.assertEqual(again['posts']['42:Post Ideas']['status'],'imported');self.assertEqual(again['collections']['post-ideas']['status'],'incomplete')
   self.assertEqual(state.with_suffix('.lock').stat().st_size,0)
 def test_locked_queue_is_not_modified(self):
  import os
  with tempfile.TemporaryDirectory() as d:
   state=Path(d)/'queue.json';state.write_text('{"posts":{},"collections":{}}',encoding='utf8')
   args=['sync','--state',str(state),'--collection','post-ideas=Post Ideas=https://www.instagram.com/u/saved/x/1']
   with open(state.with_suffix('.lock'),'a+b') as lock:
    if os.name=='nt':
     import msvcrt
     msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
     import fcntl
     fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    with patch.object(sys,'argv',args),self.assertRaises(SystemExit):sync.main()
   self.assertEqual(json.loads(state.read_text(encoding='utf8'))['posts'],{})
 def test_recent_scan_stops_at_known_post_or_falls_back_for_a_gap(self):
  from types import SimpleNamespace
  def payload(ids):return json.dumps([[2,{'post_id':str(i),'post_shortcode':'P'+str(i)}] for i in ids])
  calls=[]
  def fake(command,**kwargs):
   calls.append(command)
   return SimpleNamespace(stdout=payload(range(50)),returncode=0)
  with patch.object(sync.subprocess,'run',side_effect=fake):
   found,error=sync.scan('https://www.instagram.com/u/saved/x/1',0,1,'brave',{'10'})
  self.assertIsNone(error);self.assertEqual(len(calls),1);self.assertIn('--post-range',calls[0])
  calls.clear()
  with patch.object(sync.subprocess,'run',side_effect=fake):
   found,error=sync.scan('https://www.instagram.com/u/saved/x/1',0,1,'brave',{'missing'})
  self.assertIsNone(error);self.assertEqual(len(calls),2);self.assertNotIn('--post-range',calls[1])

if __name__=='__main__':unittest.main()
