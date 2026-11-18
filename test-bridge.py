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
 proc=start();image_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':image_id,'extension':'gif','title':'Image source','url':'https://example.com/page','name':'animated.gif'})['ok'];assert send(proc,{'type':'chunk','data':list(b'GIF89a-test')})['ok'];assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0;image_meta=json.loads((inbox/(image_id+'.json')).read_text());assert image_meta['kind']=='image' and image_meta['name']=='animated.gif' and (inbox/(image_id+'.gif')).read_bytes()==b'GIF89a-test'
 source=root/'original.webm';subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=20','-t','3','-c:v','libvpx-vp9',str(source)],check=True)
 proc=start();id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':id,'extension':'webm','title':'Test','url':'https://example.com','tags':['Motion'],'category':'Web design','crop':{'x':0.25,'y':0.2,'w':0.5,'h':0.6},'segments':[{'start':0.2,'end':1.2},{'start':1.8,'end':2.4}]})['ok']
 raw=source.read_bytes()
 for i in range(0,len(raw),32768):assert send(proc,{'type':'chunk','data':list(raw[i:i+32768])})['ok']
 assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0
 opener=start()
 assert send(opener,{'type':'open-asset','id':id})['ok']
 opener.stdin.close()
 assert opener.wait()==0 and (inbox/(id+'.open')).is_file()
 rendered=inbox/(id+'.mp4');assert rendered.is_file();meta=json.loads((inbox/(id+'.json')).read_text());assert meta['tags']==['Motion'] and meta['file']==rendered.name
 result=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(rendered)],check=True,text=True,capture_output=True);length=float(result.stdout);assert 1.45<=length<=1.8,length
 dimensions=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0:s=x',str(rendered)],check=True,text=True,capture_output=True).stdout.strip();assert dimensions=='80x54',dimensions
 assert source.exists()
 static_woff2=b'wOF2-static'+(b'\x00'*(48-len(b'wOF2-static')))
 proc=start();static_font_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':static_font_id,'extension':'woff2','title':'Type site','url':'https://example.com/type','name':'Satoshi 700 Italic','family':'Satoshi','weight':700,'weightMin':700,'weightMax':700,'isVariable':False,'style':'italic','fontSource':'capture'})['ok'];assert send(proc,{'type':'chunk','data':list(static_woff2)})['ok'];assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0
 static_meta=json.loads((inbox/(static_font_id+'.json')).read_text());assert static_meta['kind']=='font' and static_meta['family']=='Satoshi' and static_meta['weight']==700 and static_meta['weightMin']==700 and static_meta['weightMax']==700 and static_meta['isVariable']==False and static_meta['style']=='italic' and static_meta['fontSource']=='capture' and (inbox/(static_font_id+'.woff2')).read_bytes()==static_woff2
 var_woff2=b'wOF2-var'+(b'\x00'*(48-len(b'wOF2-var')))
 proc=start();var_font_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':var_font_id,'extension':'woff2','title':'Type site','url':'https://example.com/type','name':'Inter 200-800','family':'Inter','weightMin':200,'weightMax':800,'style':'normal'})['ok'];assert send(proc,{'type':'chunk','data':list(var_woff2)})['ok'];assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0
 var_meta=json.loads((inbox/(var_font_id+'.json')).read_text());assert var_meta['kind']=='font' and var_meta['weight']==400 and var_meta['weightMin']==200 and var_meta['weightMax']==800 and var_meta['isVariable']==True and var_meta['fontSource']=='capture'
 # Fractional weights round cleanly and out-of-range weights are dropped instead of clamped to 1
 proc=start();frac_font_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':frac_font_id,'extension':'woff2','title':'Type site','url':'https://example.com/type','name':'Frac','family':'Frac','weight':450.6,'weightMin':199.4,'weightMax':800.2,'fontSource':'https://evil.test'})['ok'];assert send(proc,{'type':'chunk','data':list(var_woff2)})['ok'];assert send(proc,{'type':'end'})['ok'];proc.stdin.close();assert proc.wait()==0
 frac_meta=json.loads((inbox/(frac_font_id+'.json')).read_text());assert frac_meta['weight']==451 and frac_meta['weightMin']==199 and frac_meta['weightMax']==800 and frac_meta['isVariable']==True and frac_meta['fontSource']=='capture'
 # Invalid font payload returns error and leaves no .part or .woff2/.json files
 proc=start();bad_font_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':bad_font_id,'extension':'woff2','title':'Bad','url':'https://example.com','family':'Bad'})['ok'];assert send(proc,{'type':'chunk','data':list(b'<html>not-a-font</html>')})['ok'];bad_res=send(proc,{'type':'end'});assert 'error' in bad_res;proc.stdin.close();proc.wait()
 assert not (inbox/(bad_font_id+'.part')).exists() and not (inbox/(bad_font_id+'.woff2')).exists() and not (inbox/(bad_font_id+'.json')).exists()
 # Premature EOF after begin + chunk cleans up .part file
 proc=start();aborted_id=str(uuid.uuid4());assert send(proc,{'type':'begin','id':aborted_id,'extension':'png','title':'Aborted','url':'https://example.com'})['ok'];assert send(proc,{'type':'chunk','data':[0x89,0x50,0x4e,0x47]})['ok'];proc.stdin.close();proc.wait()
 assert not (inbox/(aborted_id+'.part')).exists() and not (inbox/(aborted_id+'.png')).exists()
print('Native bridge tags, clip rendering, open request, font metadata, validation, cleanup, and original preservation passed.')
