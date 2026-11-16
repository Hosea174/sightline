import concurrent.futures,hashlib,json,mimetypes,os,sys,tempfile,urllib.request
from pathlib import Path

catalog=Path(sys.argv[1]); images=catalog.parent/'discover-images'; images.mkdir(exist_ok=True)
retry='--retry' in sys.argv[2:]
rows=json.loads(catalog.read_text(encoding='utf8')); downloaded=failed=0
def fetch(row):
    if row.get('imageDownloadFailed') and not retry: return row,False
    image=row.get('image','')
    if not isinstance(image,str) or not image: return row,False
    if image.startswith('local:'):
        if (images/image[6:]).is_file(): return row,False
        image=row.get('imageUrl','')
    if not image.startswith(('http://','https://')): return row,False
    try:
        req=urllib.request.Request(image,headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36','Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'})
        with urllib.request.urlopen(req,timeout=30) as response:
            mime=response.headers.get_content_type(); chunks=[]; size=0
            while True:
                chunk=response.read(65536)
                if not chunk: break
                size+=len(chunk)
                if size>8_000_000: raise ValueError('image exceeds 8 MB limit')
                chunks.append(chunk)
        data=b''.join(chunks)
        if not mime.startswith('image/'): raise ValueError('not a supported image')
        ext=mimetypes.guess_extension(mime) or '.img'; name=hashlib.sha256(image.encode()).hexdigest()+ext
        target=images/name
        if not target.exists():
            fd,tmp=tempfile.mkstemp(dir=images,suffix='.part'); os.close(fd)
            try: Path(tmp).write_bytes(data); os.replace(tmp,target)
            finally:
                if os.path.exists(tmp): os.unlink(tmp)
        row['imageUrl']=image; row['image']='local:'+name; row.pop('imageDownloadFailed',None); return row,True
    except Exception as exc:
        row['imageUrl']=image; row['imageDownloadFailed']=True
        print(f"{image}: {exc}",file=sys.stderr); return row,False
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for i,(row,ok) in enumerate(pool.map(fetch,rows),1):
        rows[i-1]=row; downloaded+=ok; failed+=bool(row.get('image') and not str(row['image']).startswith('local:'))
        if i%100==0:
            checkpoint=catalog.with_suffix('.tmp'); checkpoint.write_text(json.dumps(rows,separators=(',',':')),encoding='utf8'); os.replace(checkpoint,catalog)
            print(f"Processed {i}/{len(rows)} previews",file=sys.stderr)
tmp=catalog.with_suffix('.tmp'); tmp.write_text(json.dumps(rows,separators=(',',':')),encoding='utf8'); os.replace(tmp,catalog)
print(json.dumps({'downloaded':downloaded,'failed':failed,'total':len(rows)}))
