import os,tempfile,subprocess,json,struct,pathlib,uuid
exe=pathlib.Path('src-tauri/target/release/sightline-bridge.exe').resolve()
with tempfile.TemporaryDirectory(prefix='sightline-bridge-test-') as d:
 root=pathlib.Path(d);cfg=root/'com.sightline.app';cfg.mkdir();library=root/'library';library.mkdir();inbox=root/'inbox';(cfg/'library-path.txt').write_text(str(library));(cfg/'capture-inbox.txt').write_text(str(inbox));(library/'library.json').write_text(json.dumps([{'url':'https://example.com/a','category':'Illustration','tags':['Motion','SaaS']},{'tags':['motion','Editorial']}]))
 env=os.environ.copy();env['APPDATA']=str(root)
 def start():return subprocess.Popen([str(exe)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env=env)
 def send(proc,value):
  raw=json.dumps(value).encode();proc.stdin.write(struct.pack('<I',len(raw))+raw);proc.stdin.flush();header=proc.stdout.read(4);assert len(header)==4;return json.loads(proc.stdout.read(struct.unpack('<I',header)[0]))
 missing_env=env.copy();missing_env['APPDATA']=str(root/'missing');missing=subprocess.Popen([str(exe)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env=missing_env);header=missing.stdout.read(4);error=json.loads(missing.stdout.read(struct.unpack('<I',header)[0]));assert 'choose a library' in error['error'];missing.wait()
 proc=start();assert send(proc,{'type':'tags'})['tags']==['Editorial','Motion','SaaS'];proc.stdin.close();assert proc.wait()==0
 proc=start();matched=send(proc,{'type':'tags','url':'https://www.example.com/b'});assert matched['source']['tags']==['Motion','SaaS'] and matched['source']['category']=='Illustration';proc.stdin.close();assert proc.wait()==0
 source=root/'original.webm';subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=20','-t','3','-c:v','libvpx-vp9',str(source)],check=True)
 proc=start();id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':id,'extension':'webm','title':'Test','url':'https://example.com','tags':['Motion'],'category':'Web design','segments':[{'start':0.2,'end':1.2},{'start':1.8,'end':2.4}]})['ok']
 raw=source.read_bytes()
 for i in range(0,len(raw),32768):assert send(proc,{'type':'chunk','data':list(raw[i:i+32768])})['ok']
 assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0
 rendered=inbox/(id+'.mp4');assert rendered.is_file();meta=json.loads((inbox/(id+'.json')).read_text());assert meta['tags']==['Motion'] and meta['file']==rendered.name
 result=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(rendered)],check=True,text=True,capture_output=True);length=float(result.stdout);assert 1.45<=length<=1.8,length
 assert source.exists()
print('Native bridge tags, clip rendering, metadata, and original preservation passed.')
