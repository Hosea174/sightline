import {test,expect} from 'bun:test';
import {sameInstagramPost,inspirationUrlKey,sameSource,colorDistance,matches,setTrash,displayUrl,groupSourcesByUrl,toggleFavorite,zoomAround,paginationPages,shuffled,shuffleRank,matchesIndustry,matchesReference,safeHttpUrl,sanitizeFolderName,sourceFolder,renameFolderReferences,CANVAS_MIN_ZOOM,CANVAS_MAX_ZOOM,clampCanvasZoom,computeCanvasGrid,wrapGridIndex,finiteGridIndex,clampFiniteCanvasView,getVisibleCellRange,pickPlayableCells,isFontFilename,parseFontFilenameMeta,buildGoogleFontsCss2Url,groupFontAssets} from './src/logic';

test('individual assets retain source notes and tags while matching their own context',()=>{
 const source={title:'Studio',url:'https://example.com',notes:'Editorial layout',tags:['Reference']};
 const asset={name:'Homepage',notes:'Interesting typography',tags:['Serif']};
 expect(matchesReference(source,asset,'Editorial',['Reference','Serif'])).toBe(true);
 expect(matchesReference(source,asset,'typography')).toBe(true);
 expect(matchesReference(source,asset,'Homepage')).toBe(true);
 expect(matchesReference(source,asset,'',['Missing'])).toBe(false);
 expect(matchesReference(source,undefined,'Studio')).toBe(true);
});
test('captures from different pages of one site group together, but social posts remain separate',()=>{
  expect(sameSource('https://www.example.com/a','https://example.com/b')).toBe(true);
  expect(sameSource('https://pinterest.com/pin/1','https://pinterest.com/pin/2')).toBe(false);
  expect(sameSource('https://x.com/a/status/1','https://x.com/a/status/1')).toBe(true);
  expect(sameSource('https://example.com','https://other.com')).toBe(false);
  expect(sameSource('invalid','https://other.com')).toBe(false);
});
test('search and color matching handle approximate input',()=>{
  expect(matches('Studio Freight','stdf')).toBe(true);
  expect(matches('Studio Freight','freight')).toBe(true);
  expect(matches('Studio Freight','xyz')).toBe(false);
  expect(colorDistance('#ffffff','#ffffff')).toBe(0);
  expect(colorDistance('#000000','#ffffff')).toBeGreaterThan(400);
});

test('trash and restore preserve source and asset records',()=>{
 const original:Array<{id:string;trashedAt?:string;assets:Array<{id:string;file:string;trashedAt?:string}>}>=[{id:'site',assets:[{id:'one',file:'image.webp'},{id:'two',file:'clip.mp4'}]}];
 const trashed=setTrash(original,'site','one','2026-11-08');
 expect(trashed[0].assets[0].trashedAt).toBe('2026-11-08');
 expect(trashed[0].assets[1].file).toBe('clip.mp4');
 expect(setTrash(trashed,'site','one',undefined)[0].assets[0].file).toBe('image.webp');
 expect(setTrash(original,'site',undefined,'2026-11-08')[0].assets).toEqual(original[0].assets);
});

test('canvas groups matching website URLs and displays a clean link',()=>{
 const input=[{url:'https://www.example.com/a',assets:[{id:'a'}]},{url:'https://example.com/b',assets:[{id:'b'}]},{url:'',assets:[{id:'c'}]},{url:'',assets:[{id:'d'}]},{url:'https://x.com/u/1',assets:[{id:'e'}]},{url:'https://x.com/u/2',assets:[{id:'f'}]}];
 const groups=groupSourcesByUrl(input);expect(groups.length).toBe(5);expect(groups[0].assets.map(a=>a.id)).toEqual(['a','b']);expect(input[0].assets.length).toBe(1);expect(displayUrl('https://www.example.com/a?q=1')).toBe('example.com/a?q=1');expect(displayUrl('https://www.revolut.com/')).toBe('revolut.com');
});

test('favorites are independently toggled without changing other items',()=>{
 const original:Array<{id:string;favorite?:boolean;assets:Array<{id:string;favorite?:boolean}>}>=[{id:'one',assets:[{id:'a'},{id:'b'}]}];
 const marked=toggleFavorite(original,'one','a');expect(marked[0].assets[0].favorite).toBe(true);expect(marked[0].favorite).toBeUndefined();expect(marked[0].assets[1].favorite).toBeUndefined();expect(toggleFavorite(marked,'one','a')[0].assets[0].favorite).toBe(false);expect(toggleFavorite(original,'one')[0].favorite).toBe(true);
});
test('pinch zoom keeps the point under the gesture fixed',()=>{
 const v={x:10,y:20,zoom:1},p={x:110,y:120},next=zoomAround(v,p,-30);expect(next.zoom).toBeGreaterThan(1);expect((p.x-next.x)/next.zoom).toBeCloseTo((p.x-v.x)/v.zoom);expect((p.y-next.y)/next.zoom).toBeCloseTo((p.y-v.y)/v.zoom);expect(zoomAround(v,p,-9999).zoom).toBe(4);
});

test('pagination keeps boundary and nearby pages visible',()=>{
 expect(paginationPages(1,1)).toEqual([1]);expect(paginationPages(1,10)).toEqual([1,2,'ellipsis',10]);expect(paginationPages(5,10)).toEqual([1,'ellipsis',4,5,6,'ellipsis',10]);expect(paginationPages(99,4)).toEqual([1,2,3,4]);
});

test('shuffle creates a permutation without changing the original',()=>{ const input=[1,2,3,4]; const result=shuffled(input,()=>0); expect(result).toEqual([2,3,4,1]); expect(input).toEqual([1,2,3,4]); expect(shuffled([])).toEqual([]); });

test('inspiration links normalize host and trailing slashes while keeping distinct paths',()=>{
 expect(inspirationUrlKey('https://www.example.com/page/')).toBe(inspirationUrlKey('https://example.com/page'));
 expect(inspirationUrlKey('https://example.com/other')).not.toBe(inspirationUrlKey('https://example.com/page'));
 expect(inspirationUrlKey('invalid')).toBe('');
});

test('Instagram post identity matches reel and post links only on Instagram',()=>{
 expect(sameInstagramPost('https://instagram.com/reel/AbC/','https://www.instagram.com/p/AbC/?x=1')).toBe(true);
 expect(sameInstagramPost('https://example.com/reel/AbC/','https://www.instagram.com/p/AbC/')).toBe(false);
 expect(sameInstagramPost('https://instagram.com/p/one/','https://instagram.com/p/two/')).toBe(false);
});

test('shuffle order survives reloads and industry filters use exact catalog tags',()=>{
 const sites=['one','two','three','four'];const order=(values:string[],seed:number)=>[...values].sort((a,b)=>shuffleRank(a,seed)-shuffleRank(b,seed));
 expect(order(sites,123)).toEqual(order([...sites].reverse(),123));
 expect(order(sites,123)).not.toEqual(order(sites,456));
 expect(matchesIndustry(['animated','Technology'],'Technology')).toBe(true);
 expect(matchesIndustry(['animated','Typography'],'Technology')).toBe(false);
 expect(matchesIndustry(['food/drink'],'Food & drink')).toBe(true);
});

test('safeHttpUrl accepts only http and https links',()=>{
 expect(safeHttpUrl(' https://example.com/path ')).toBe('https://example.com/path');
 expect(safeHttpUrl('http://localhost:3000')).toBe('http://localhost:3000/');
 expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
 expect(safeHttpUrl('file:///etc/passwd')).toBeNull();
 expect(safeHttpUrl('')).toBeNull();
 expect(safeHttpUrl('not a url')).toBeNull();
});

test('source folders sanitize unsafe names and disambiguate duplicates',()=>{
 expect(sanitizeFolderName('Extrafazant | Social Content: Video?')).toBe('Extrafazant Social Content Video');
 expect(sanitizeFolderName('CON')).toBe('CON source');
 expect(sanitizeFolderName('...   ...')).toBe('Untitled');
 const first={id:'2be6ae60-b409',title:'Instagram post',url:'https://instagram.com/reel/1/',assets:[]};
 const second={id:'bc273f66-185c',title:'Instagram post',url:'https://instagram.com/p/2/',assets:[]};
 expect(sourceFolder(first,[first,second])).toBe('Instagram post');
 expect(sourceFolder(second,[first,second])).toBe('Instagram post (bc273f)');
 const existing={id:'abc',title:'Renamed',url:'',assets:[{file:'Original Folder/1.webp'}]};
 expect(sourceFolder(existing,[existing])).toBe('Original Folder');
 const renamed=renameFolderReferences([
  {id:'abc',folder:'Original Folder',assets:[{file:'Original Folder/1.webp'},{file:'Original Folder/f.woff2'}]},
  {id:'other',folder:'Other',assets:[{file:'Original Folder/f.woff2'},{file:'Other/x.png'}]}
 ],'abc','Original Folder','New Name');
 expect(renamed[0].folder).toBe('New Name');
 expect(renamed[0].assets.map(a=>a.file)).toEqual(['New Name/1.webp','New Name/f.woff2']);
 expect(renamed[1].assets.map(a=>a.file)).toEqual(['New Name/f.woff2','Other/x.png']);
});

test('canvas zoom clamps cleanly within allowed bounds',()=>{
  expect(clampCanvasZoom(0.05)).toBe(CANVAS_MIN_ZOOM);
  expect(clampCanvasZoom(1.5)).toBe(1.5);
  expect(clampCanvasZoom(10)).toBe(CANVAS_MAX_ZOOM);
});

test('canvas grid dimensions cover all items cleanly',()=>{
  expect(computeCanvasGrid(0)).toEqual({cols:0,rows:0});
  const small=computeCanvasGrid(5);
  expect(small.cols*small.rows).toBeGreaterThanOrEqual(5);
  const large=computeCanvasGrid(4261);
  expect(large.cols*large.rows).toBeGreaterThanOrEqual(4261);
  expect(large.cols).toBeGreaterThan(1);
});

test('canvas wrapping and finite indexing map negative and out-of-bounds cells properly',()=>{
  expect(wrapGridIndex(0,0,3,2,5)).toBe(0);
  expect(wrapGridIndex(-1,0,3,2,5)).toBe(2);
  expect(wrapGridIndex(0,-1,3,2,5)).toBe(3);
  expect(wrapGridIndex(3,2,3,2,5)).toBe(0);

  expect(finiteGridIndex(0,0,3,5)).toBe(0);
  expect(finiteGridIndex(2,0,3,5)).toBe(2);
  expect(finiteGridIndex(1,1,3,5)).toBe(4);
  expect(finiteGridIndex(2,1,3,5)).toBeNull();
  expect(finiteGridIndex(-1,0,3,5)).toBeNull();
  expect(finiteGridIndex(3,0,3,5)).toBeNull();
});

test('finite canvas view clamps pan within viewport margins and calculates visible cells',()=>{
  const clamped=clampFiniteCanvasView({x:-99999,y:99999,zoom:1},{width:1000,height:800},{cols:4,rows:3},320,232,20);
  expect(clamped.x).toBeGreaterThan(-99999);
  expect(clamped.y).toBeLessThan(99999);

  const range=getVisibleCellRange({x:0,y:0,zoom:1},{width:640,height:464},320,232,1);
  expect(range.minCol).toBe(-1);
  expect(range.maxCol).toBe(3);
  expect(range.minRow).toBe(-1);
  expect(range.maxRow).toBe(3);
});

test('font extension recognition and filename metadata parsing handle weights, styles, and formats',()=>{
  for(const ext of ['ttf','otf','woff','woff2','eot','ttc','dfont','pfb']){
    expect(isFontFilename(`TestFont.${ext}`)).toBe(true);
  }
  expect(isFontFilename('photo.webp')).toBe(false);

  expect(parseFontFilenameMeta('Satoshi-SemiBoldItalic.woff2')).toEqual({family:'Satoshi',weight:600,style:'italic'});
  expect(parseFontFilenameMeta('PP_Neue_Montreal_Light.otf')).toEqual({family:'PP Neue Montreal',weight:300,style:'normal'});
  expect(parseFontFilenameMeta('Inter-700.ttf')).toEqual({family:'Inter',weight:700,style:'normal'});
  expect(parseFontFilenameMeta('Editorial-Regular.eot')).toEqual({family:'Editorial',weight:400,style:'normal'});
});

test('google fonts css2 url sorts weights and formats italic tuples cleanly',()=>{
  expect(buildGoogleFontsCss2Url('Playfair Display',['700','400'])).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap');
  expect(buildGoogleFontsCss2Url('Inter',['700i','400','400i'])).toBe('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,400;1,700&display=swap');
});

test('groupFontAssets merges multiple weight and style files into one font family group',()=>{
  const groups=groupFontAssets([
    {sourceId:'s1',asset:{id:'f1',name:'Satoshi-Bold.woff2',file:'Satoshi/bold.woff2',family:'Satoshi',weight:700,style:'normal'}},
    {sourceId:'s1',asset:{id:'f2',name:'Satoshi-Regular.woff2',file:'Satoshi/reg.woff2',family:'Satoshi',weight:400,style:'normal'}},
    {sourceId:'s2',asset:{id:'f3',name:'Satoshi-Italic.otf',file:'Other/ital.otf',family:'Satoshi',weight:400,style:'italic'}},
    {sourceId:'s3',asset:{id:'f4',name:'Mono.ttf',file:'Mono/reg.ttf'}},
  ]);
  expect(groups.length).toBe(2);
  expect(groups[0].family).toBe('Satoshi');
  expect(groups[0].linkedSources).toBe(2);
  expect(groups[0].primaryAsset.id).toBe('f2');
  expect(groups[0].variants.map(v=>`${v.weight}-${v.style}`)).toEqual(['400-normal','700-normal','400-italic']);
  expect(groups[0].formats).toEqual(['WOFF2','OTF']);
});




test('canvas zoom floor is 35%',()=>{expect(CANVAS_MIN_ZOOM).toBe(0.35);expect(clampCanvasZoom(0.1)).toBe(0.35)});
test('pickPlayableCells caps videos, skips off-screen cells and prefers the centre',()=>{
  const view={x:0,y:0,zoom:1};const vp={width:900,height:700};
  const cells=[] as {id:string;col:number;row:number;video:boolean}[];
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)cells.push({id:`${c},${r}`,col:c,row:r,video:true});
  cells.push({id:'img',col:1,row:1,video:false});
  const ids=pickPlayableCells(cells,view,vp,340,200,320,180,4);
  expect(ids.length).toBe(4);
  expect(ids).not.toContain('img');
  const all=pickPlayableCells(cells,view,{width:1100,height:700},340,200,320,180,100);expect(all.length).toBe(9);expect(pickPlayableCells(cells,view,{width:600,height:700},340,200,320,180,100)).not.toContain('2,0');
  expect(ids[0]).toBe('1,1');
  expect(pickPlayableCells(cells,view,vp,340,200,320,180,0)).toEqual([]);
});