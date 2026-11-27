import {test,expect} from 'bun:test';
import {sameInstagramPost,inspirationUrlKey,sameSource,colorDistance,matches,scoreTagMatch,filterTagSuggestions,filterDiscoverSites,setTrash,displayUrl,groupSourcesByUrl,toggleFavorite,zoomAround,paginationPages,shuffled,shuffleRank,matchesIndustry,matchesReference,safeHttpUrl,sanitizeFolderName,sourceFolder,renameFolderReferences,CANVAS_MIN_ZOOM,CANVAS_MAX_ZOOM,clampCanvasZoom,computeCanvasGrid,wrapGridIndex,finiteGridIndex,clampFiniteCanvasView,getVisibleCellRange,pickPlayableCells,isFontFilename,parseFontFilenameMeta,buildGoogleFontsCss2Url,groupFontAssets,capturedFontAssetFields,getFontFaceWeightDescriptor,getAvailableFontWeightPills} from './src/logic';

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

test('canvas buffer reuses cells for small pans and covers large jumps', async()=>{
 const {bufferCanvasRange,centerCanvasView}=await import('./src/logic');
 const previous={minCol:-2,maxCol:6,minRow:-2,maxRow:5};
 expect(bufferCanvasRange({minCol:1,maxCol:5,minRow:0,maxRow:3},previous,2)).toBe(previous);
 expect(bufferCanvasRange({minCol:20,maxCol:24,minRow:0,maxRow:3},previous,2)).toEqual({minCol:18,maxCol:26,minRow:-2,maxRow:5});
 const centered=centerCanvasView(.75,{width:1000,height:700},{cols:8,rows:6},340,200,20);
 expect(centered.x+(8*340-20)*centered.zoom/2).toBe(500);
 expect(centered.y+(6*200-20)*centered.zoom/2).toBe(350);
});


test('dragging library thumbnails persists order and makes the first visible asset the cover',async()=>{
 const {reorderSourceAssets}=await import('./src/logic');
 const source={coverId:'a',assets:[{id:'a',kind:'image'},{id:'b',kind:'video'},{id:'c',kind:'image'}]};
 const front=reorderSourceAssets(source,'c','a',false);
 expect(front.assets.map(a=>a.id)).toEqual(['c','a','b']);
 expect(front.coverId).toBe('c');
 const end=reorderSourceAssets(source,'a','c',true);
 expect(end.assets.map(a=>a.id)).toEqual(['b','c','a']);
 expect(end.coverId).toBe('b');
 expect(source.assets.map(a=>a.id)).toEqual(['a','b','c']);
 expect(reorderSourceAssets(source,'missing','a',false)).toBe(source);
});


test('saving an open annotation note preserves resized geometry and edited timing',async()=>{
 const {mergeAnnotationNote}=await import('./src/logic');
 const draft={id:'note',text:'Old',x:.1,y:.2,w:.2,h:.2,start:0,end:2};
 const resized={...draft,x:.3,y:.4,w:.5,h:.4,start:1,end:4};
 expect(mergeAnnotationNote([resized],draft,'New')).toEqual({...resized,text:'New'});
 expect(mergeAnnotationNote([],draft,'New')).toEqual({...draft,text:'New'});
});

test('webgl spherical lens warp is flat at 0% and cleanly inverts for raycast hit-testing',async()=>{
 const {warpCanvasPoint,unwarpCanvasPoint,screenToCanvasWorld,computeTileUvTransform}=await import('./src/logic');
 expect(warpCanvasPoint(0.6,-0.4,0,16/9,0,0)).toEqual({x:0.6,y:-0.4});
 const warped=warpCanvasPoint(0.65,-0.5,0.8,16/9,0.03,-0.02);
 const recovered=unwarpCanvasPoint(warped.x,warped.y,0.8,16/9,0.03,-0.02);
 expect(recovered.x).toBeCloseTo(0.65,3);
 expect(recovered.y).toBeCloseTo(-0.5,3);

 const cornerWarped=warpCanvasPoint(0.85,-0.85,1,16/9,0,0);
 const cornerRecovered=unwarpCanvasPoint(cornerWarped.x,cornerWarped.y,1,16/9,0,0);
 expect(cornerRecovered.x).toBeCloseTo(0.85,3);
 expect(cornerRecovered.y).toBeCloseTo(-0.85,3);

 const far=warpCanvasPoint(2.2,1.4,1,16/9,0,0);
 const near=warpCanvasPoint(1.1,0.7,1,16/9,0,0);
 expect(Math.hypot(far.x,far.y)).toBeGreaterThan(Math.hypot(near.x,near.y));

 const view={x:120,y:80,zoom:1.25};
 const vp={width:1280,height:720};
 const worldFlat=screenToCanvasWorld(640,360,view,vp,0);
 const worldWarpedCenter=screenToCanvasWorld(640,360,view,vp,0.75);
 expect(worldWarpedCenter.worldX).toBeCloseTo(worldFlat.worldX,4);
 expect(worldWarpedCenter.worldY).toBeCloseTo(worldFlat.worldY,4);

 const containWide=computeTileUvTransform(1600,400,320,180,'contain');
 expect(containWide.scaleX).toBe(1);
 expect(containWide.scaleY).toBeGreaterThan(1);

 const coverShort=computeTileUvTransform(800,1200,320,180,'cover-top',0);
 expect(coverShort.scrollable).toBe(false);
 expect(coverShort.offsetY).toBeGreaterThan(0);

 const coverTwoXTop=computeTileUvTransform(800,1600,320,180,'cover-top',0);
 const coverTwoXBottom=computeTileUvTransform(800,1600,320,180,'cover-top',1);
 expect(coverTwoXTop.offsetY).toBe(0);
 expect(coverTwoXBottom.offsetY).toBeGreaterThan(0);
 expect(coverTwoXTop.scrollable).toBe(true);
});


test('Discover filters combine color, source, visit status and unknown years',async()=>{
 const {filterDiscoverSites,getDiscoverFilterOptions}=await import('./src/logic');
 const sites=[
  {title:'Studio',url:'https://studio.test',tags:['design agencies'],colors:['#f00000'],sources:[{name:'Gallery',url:'https://gallery.test',date:'2024-05-01'}]},
  {title:'Other',url:'https://other.test',tags:['design agencies'],colors:['#0000f0'],sources:[{name:'Gallery',url:'https://gallery.test',date:null}]}
 ];
 const base={query:'',colors:[],years:[],sources:[],industries:[],tags:[],statuses:[],visited:{'https://studio.test':true},paletteSwatches:[{name:'Red',value:'#ff0000'},{name:'Blue',value:'#0000ff'}]};
 expect(filterDiscoverSites(sites,{...base,colors:['Red'],sources:['Gallery'],statuses:['Visited']}).map(s=>s.title)).toEqual(['Studio']);
 expect(filterDiscoverSites(sites,{...base,years:['Unknown'],statuses:['Unvisited']}).map(s=>s.title)).toEqual(['Other']);
 expect(getDiscoverFilterOptions(sites).hasUnknownYear).toBe(true);
});

test('capturedFontAssetFields preserves static and variable capture metadata and falls back for legacy captures',()=>{
 expect(capturedFontAssetFields({
  name:'Inter 700 Italic',
  file:'abc.woff2',
  family:'Inter',
  weight:700,
  style:'italic',
  fontSource:'capture',
 })).toEqual({
  family:'Inter',
  weight:700,
  weightMin:700,
  weightMax:700,
  isVariable:false,
  style:'italic',
  fontSource:'capture',
 });

 expect(capturedFontAssetFields({
  name:'Plus Jakarta Sans 200-800',
  file:'pjs.woff2',
  family:'Plus Jakarta Sans',
  weightMin:200,
  weightMax:800,
  isVariable:true,
  style:'normal',
 })).toEqual({
  family:'Plus Jakarta Sans',
  weight:400,
  weightMin:200,
  weightMax:800,
  isVariable:true,
  style:'normal',
  fontSource:'capture',
 });

 expect(capturedFontAssetFields({
  name:'Plus Jakarta Sans 500-800',
  file:'pjs-heavy.woff2',
  family:'Plus Jakarta Sans',
  weightMin:500,
  weightMax:800,
 })).toEqual({
  family:'Plus Jakarta Sans',
  weight:500,
  weightMin:500,
  weightMax:800,
  isVariable:true,
  style:'normal',
  fontSource:'capture',
 });

 expect(capturedFontAssetFields({
  name:'Satoshi-SemiBoldItalic.woff2',
  file:'Satoshi-SemiBoldItalic.woff2',
 })).toEqual({
  family:'Satoshi',
  weight:600,
  weightMin:600,
  weightMax:600,
  isVariable:false,
  style:'italic',
  fontSource:'capture',
 });

 // Invalid weights, fractional weights, invalid fontSource, and out-of-range nominal weight
 expect(capturedFontAssetFields({
  name:'Broken-Bold.woff2',
  file:'Broken-Bold.woff2',
  family:'Broken',
  weight:0,
  weightMin:-10,
  weightMax:1500,
  fontSource:'https://evil.test' as any,
 })).toEqual({
  family:'Broken',
  weight:700,
  weightMin:700,
  weightMax:700,
  isVariable:false,
  style:'normal',
  fontSource:'capture',
 });

 expect(capturedFontAssetFields({
  name:'Fractional.woff2',
  file:'Fractional.woff2',
  family:'Fractional',
  weight:450.6,
  weightMin:199.4,
  weightMax:800.2,
  fontSource:'google',
 })).toEqual({
  family:'Fractional',
  weight:451,
  weightMin:199,
  weightMax:800,
  isVariable:true,
  style:'normal',
  fontSource:'google',
 });

 expect(capturedFontAssetFields({
  name:'NarrowVar.woff2',
  file:'NarrowVar.woff2',
  family:'NarrowVar',
  weight:100,
  weightMin:500,
  weightMax:800,
 })).toEqual({
  family:'NarrowVar',
  weight:500,
  weightMin:500,
  weightMax:800,
  isVariable:true,
  style:'normal',
  fontSource:'capture',
 });
});

test('getFontFaceWeightDescriptor and getAvailableFontWeightPills only expose supported static or bounded variable weights',()=>{
 expect(getFontFaceWeightDescriptor({weight:600})).toBe('600');
 expect(getFontFaceWeightDescriptor({weight:400,weightMin:300,weightMax:700,isVariable:true})).toBe('300 700');
 expect(getFontFaceWeightDescriptor({weight:400,weightMin:800,weightMax:200,isVariable:true})).toBe('200 800');
 expect(getFontFaceWeightDescriptor({weight:500,weightMin:500,weightMax:500,isVariable:false})).toBe('500');
 expect(getFontFaceWeightDescriptor({weight:0})).toBe('400');

 const singleStatic=groupFontAssets([
  {sourceId:'s1',asset:{id:'f1',name:'Editorial 400',file:'Editorial/reg.woff2',family:'Editorial',weight:400,weightMin:400,weightMax:400,isVariable:false,style:'normal'}},
 ]);
 expect(getAvailableFontWeightPills(singleStatic[0].variants).map(p=>p.key)).toEqual(['400-normal']);

 const multiStatic=groupFontAssets([
  {sourceId:'s1',asset:{id:'f1',name:'Satoshi 700 Italic',file:'Satoshi/700i.woff2',family:'Satoshi',weight:700,style:'italic'}},
  {sourceId:'s1',asset:{id:'f2',name:'Satoshi 400',file:'Satoshi/400.woff2',family:'Satoshi',weight:400,style:'normal'}},
  {sourceId:'s1',asset:{id:'f3',name:'Satoshi 700',file:'Satoshi/700.woff2',family:'Satoshi',weight:700,style:'normal'}},
 ]);
 expect(getAvailableFontWeightPills(multiStatic[0].variants).map(p=>({key:p.key,assetId:p.asset.id,isVariable:p.isVariable}))).toEqual([
  {key:'400-normal',assetId:'f2',isVariable:false},
  {key:'700-normal',assetId:'f3',isVariable:false},
  {key:'700-italic',assetId:'f1',isVariable:false},
 ]);

 const boundedVariable=groupFontAssets([
  {sourceId:'s1',asset:{id:'v1',name:'Inter 250-700',file:'Inter/var.woff2',family:'Inter',weight:400,weightMin:250,weightMax:700,isVariable:true,style:'normal'}},
  {sourceId:'s1',asset:{id:'v2',name:'Inter 700 Italic',file:'Inter/700i.woff2',family:'Inter',weight:700,style:'italic'}},
 ]);
 expect(boundedVariable[0].primaryAsset.id).toBe('v1');
 expect(getAvailableFontWeightPills(boundedVariable[0].variants).map(p=>p.key)).toEqual([
  '250-normal',
  '300-normal',
  '400-normal',
  '500-normal',
  '600-normal',
  '700-normal',
  '700-italic',
 ]);

 // Full 100..1000 variable range includes 1000, and custom endpoints/nominal weights are exposed
 const fullRange=groupFontAssets([
  {sourceId:'s1',asset:{id:'full',name:'FullVar',file:'Full/var.woff2',family:'FullVar',weight:425,weightMin:50,weightMax:1000,isVariable:true,style:'normal'}},
 ]);
 expect(getAvailableFontWeightPills(fullRange[0].variants).map(p=>p.weight)).toEqual([50,100,200,300,400,425,500,600,700,800,900,1000]);

 // Dedicated static file and narrower variable range beat wider variable file regardless of order
 const mixed=groupFontAssets([
  {sourceId:'s1',asset:{id:'wide-var',name:'Mix 100-900',file:'Mix/wide.woff2',family:'Mix',weight:400,weightMin:100,weightMax:900,isVariable:true,style:'normal'}},
  {sourceId:'s1',asset:{id:'narrow-var',name:'Mix 300-500',file:'Mix/narrow.woff2',family:'Mix',weight:400,weightMin:300,weightMax:500,isVariable:true,style:'normal'}},
  {sourceId:'s1',asset:{id:'static-400',name:'Mix 400',file:'Mix/400.woff2',family:'Mix',weight:400,weightMin:400,weightMax:400,isVariable:false,style:'normal'}},
 ]);
 expect(mixed[0].primaryAsset.id).toBe('static-400');
 const mixedPills=new Map(getAvailableFontWeightPills(mixed[0].variants).map(p=>[p.key,p]));
 expect(mixedPills.get('400-normal')?.asset.id).toBe('static-400');
 expect(mixedPills.get('400-normal')?.isVariable).toBe(false);
 expect(mixedPills.get('500-normal')?.asset.id).toBe('narrow-var');
 expect(mixedPills.get('800-normal')?.asset.id).toBe('wide-var');
});

test('trash timestamp parsing and 30-day expiration handle boundaries, timezones, and invalid dates safely',async()=>{
  const {
    TRASH_RETENTION_DAYS,
    TRASH_RETENTION_MS,
    parseTrashTimestamp,
    isTrashExpired,
    trashDaysRemaining,
  }=await import('./src/logic');

  const t0=parseTrashTimestamp('2026-10-01T12:00:00.000Z');
  expect(t0).not.toBeNull();
  expect(parseTrashTimestamp('2026-10-01T15:00:00+03:00')).toBe(t0);
  expect(parseTrashTimestamp('2026-10-01T07:00:00-05:00')).toBe(t0);
  expect(parseTrashTimestamp('2026-10-01')).toBe(Date.UTC(2026,9,1,0,0,0,0));

  expect(parseTrashTimestamp('2024-02-29T00:00:00Z')).not.toBeNull();
  expect(parseTrashTimestamp('2025-02-29T00:00:00Z')).toBeNull();
  expect(parseTrashTimestamp('2026-04-31T00:00:00Z')).toBeNull();
  expect(parseTrashTimestamp('not-a-date')).toBeNull();
  expect(parseTrashTimestamp('')).toBeNull();

  expect(isTrashExpired('2026-10-01T12:00:00Z',(t0 as number)+TRASH_RETENTION_MS-1)).toBe(false);
  expect(isTrashExpired('2026-10-01T12:00:00Z',(t0 as number)+TRASH_RETENTION_MS)).toBe(true);
  expect(isTrashExpired('2026-10-10T12:00:00Z',t0 as number)).toBe(false);
  expect(isTrashExpired('2025-02-29T00:00:00Z',(t0 as number)+TRASH_RETENTION_MS*10)).toBe(false);

  expect(trashDaysRemaining('2026-10-01T12:00:00Z',t0 as number)).toBe(TRASH_RETENTION_DAYS);
  expect(trashDaysRemaining('2026-10-01T12:00:00Z',(t0 as number)+TRASH_RETENTION_MS-60_000)).toBe(1);
  expect(trashDaysRemaining('2026-10-01T12:00:00Z',(t0 as number)+TRASH_RETENTION_MS)).toBe(0);
  expect(trashDaysRemaining('bad-date',t0 as number)).toBeNull();
});

test('pure trash deletion, clear, and 30-day purge preserve active items and clear stale covers',async()=>{
  const {removeTrashedItem,clearAllTrash,purgeExpiredTrash}=await import('./src/logic');
  const library=[
    {
      id:'s-active',
      coverId:'a-trashed',
      assets:[
        {id:'a-keep',file:'Active/keep.webp'},
        {id:'a-trashed',file:'Active/old.webp',trashedAt:'2026-10-01T00:00:00Z'},
        {id:'a-recent',file:'Active/recent.webp',trashedAt:'2026-11-10T00:00:00Z'},
      ],
    },
    {
      id:'s-trashed-old',
      trashedAt:'2026-10-05T00:00:00Z',
      assets:[{id:'old-1',file:'Old/1.webp'}],
    },
    {
      id:'s-trashed-fresh',
      trashedAt:'2026-11-12T00:00:00Z',
      assets:[{id:'fresh-1',file:'Fresh/1.webp'}],
    },
  ];

  // Refuses active source/asset removal
  expect(removeTrashedItem(library,'s-active')).toEqual(library);
  expect(removeTrashedItem(library,'s-active','a-keep')).toEqual(library);

  // Removes trashed asset and clears matching coverId
  const afterSingle=removeTrashedItem(library,'s-active','a-trashed');
  expect(afterSingle[0].assets.map(a=>a.id)).toEqual(['a-keep','a-recent']);
  expect(afterSingle[0].coverId).toBeUndefined();

  // 30-day purge removes expired source & asset while preserving recent trash
  const now=Date.UTC(2026,10,17,0,0,0,0);
  const purged=purgeExpiredTrash(library,now);
  expect(purged.removedSources).toBe(1);
  expect(purged.removedAssets).toBe(2);
  expect(purged.sources.map(s=>s.id)).toEqual(['s-active','s-trashed-fresh']);
  expect(purged.sources[0].assets.map(a=>a.id)).toEqual(['a-keep','a-recent']);
  expect(purged.sources[0].coverId).toBeUndefined();

  // Clear all removes remaining trashed source & trashed asset
  const cleared=clearAllTrash(library);
  expect(cleared.map(s=>s.id)).toEqual(['s-active']);
  expect(cleared[0].assets.map(a=>a.id)).toEqual(['a-keep']);
  expect(cleared[0].coverId).toBeUndefined();
});

test('trash storage path detection respects shared references across active and trashed entries',async()=>{
  const {isFileInTrashStorage,isThumbnailInTrashStorage,isPreviewInTrashStorage}=await import('./src/logic');
  const sources=[
    {
      trashedAt:'2026-11-10T00:00:00Z',
      assets:[
        {file:'Shared/inter.woff2'},
        {file:'Trashed/clip.mp4',thumbnail:'clip-t1500.jpg',previewVideo:'clip.v2.mp4'},
      ],
    },
    {
      assets:[
        {file:'Shared\\inter.woff2'},
        {file:'Active/keep.mp4',thumbnail:'keep.jpg',previewVideo:'keep.v2.mp4'},
        {file:'Active/removed.webp',thumbnail:'removed.jpg',trashedAt:'2026-11-11T00:00:00Z'},
      ],
    },
  ];

  expect(isFileInTrashStorage(sources,'Shared/inter.woff2')).toBe(false);
  expect(isFileInTrashStorage(sources,'Trashed/clip.mp4')).toBe(true);
  expect(isFileInTrashStorage(sources,'Active/removed.webp')).toBe(true);
  expect(isFileInTrashStorage(sources,'Active/keep.mp4')).toBe(false);

  expect(isThumbnailInTrashStorage(sources,'clip-t1500.jpg','Trashed/clip.mp4')).toBe(true);
  expect(isThumbnailInTrashStorage(sources,'clip.jpg','Trashed/clip.mp4')).toBe(true);
  expect(isThumbnailInTrashStorage(sources,'removed.jpg','Active/removed.webp')).toBe(true);
  expect(isThumbnailInTrashStorage(sources,'keep.jpg','Active/keep.mp4')).toBe(false);

  expect(isPreviewInTrashStorage(sources,'clip.v2.mp4','Trashed/clip.mp4')).toBe(true);
  expect(isPreviewInTrashStorage(sources,'keep.v2.mp4','Active/keep.mp4')).toBe(false);
});

test('trashService resolves trash URLs, supports browser fallback, and flushes writes before native invoke',async()=>{
  const {
    trashItems,
    restoreFromTrash,
    permanentlyDeleteTrashed,
    clearTrash,
    purgeExpiredLibraryTrash,
    resolveAssetDiskUrl,
    resolveThumbDiskUrl,
    resolvePreviewVideoDiskUrl,
    revealAssetFile,
    getAssetDiskPath,
    copyAssetImageToClipboard,
    formatTrashExpiryLabel,
  }=await import('./src/lib/trashService');
  const initial: Array<import('./src/types').Source>=[
    {
      id:'s1',
      title:'Studio',
      url:'',
      category:'Web design',
      tags:[],
      notes:'',
      coverId:'a1',
      x:0,
      y:0,
      created:'2026-10-01T00:00:00Z',
      assets:[
        {id:'a1',name:'Clip',file:'Studio/clip.mp4',kind:'video',thumbnail:'clip.jpg',previewVideo:'clip.v2.mp4'},
        {id:'a2',name:'Shot',file:'Studio/shot.webp',kind:'image'},
      ],
    },
  ];

  // Browser fallback lifecycle: trash -> resolve URL -> restore -> re-trash -> delete -> clear
  const trashed=await trashItems([{sourceId:'s1',assetId:'a1'}],initial,{now:'2026-11-01T00:00:00.000Z'});
  expect(trashed.result.trashedCount).toBe(1);
  expect(trashed.sources[0].coverId).toBeUndefined();
  expect(trashed.sources[0].assets[0].trashedAt).toBe('2026-11-01T00:00:00.000Z');

  const id=(p:string)=>p;
  expect(resolveAssetDiskUrl('C:\\Lib','Studio/clip.mp4',trashed.sources,id)).toBe('C:\\Lib\\trash\\assets\\Studio\\clip.mp4');
  expect(resolveAssetDiskUrl('C:\\Lib','Studio/shot.webp',trashed.sources,id)).toBe('C:\\Lib\\assets\\Studio\\shot.webp');
  expect(resolveThumbDiskUrl('C:\\Lib','clip.jpg',trashed.sources,'Studio/clip.mp4',id)).toBe('C:\\Lib\\trash\\thumbnails\\clip.jpg');
  expect(resolvePreviewVideoDiskUrl('C:\\Lib',{file:'Studio/clip.mp4',previewVideo:'clip.v2.mp4'},trashed.sources,id)).toBe('C:\\Lib\\trash\\previews\\clip.v2.mp4');

  const restored=await restoreFromTrash([{sourceId:'s1',assetId:'a1'}],trashed.sources);
  expect(restored.result.restoredCount).toBe(1);
  expect(restored.sources[0].assets[0].trashedAt).toBeUndefined();
  expect(resolveAssetDiskUrl('C:\\Lib','Studio/clip.mp4',restored.sources,id)).toBe('C:\\Lib\\assets\\Studio\\clip.mp4');

  const trashedOld=await trashItems([{sourceId:'s1',assetId:'a1'}],restored.sources,{now:'2026-10-01T00:00:00.000Z'});
  const purged=await purgeExpiredLibraryTrash(trashedOld.sources,{now:'2026-11-17T00:00:00.000Z'});
  expect(purged.result.deletedAssets).toBe(1);
  expect(purged.sources[0].assets.map(a=>a.id)).toEqual(['a2']);

  const trashedTwo=await trashItems([{sourceId:'s1'}],purged.sources,{now:'2026-11-10T00:00:00.000Z'});
  const deleted=await permanentlyDeleteTrashed([{sourceId:'s1'}],trashedTwo.sources);
  expect(deleted.result.deletedSources).toBe(1);
  expect(deleted.sources).toEqual([]);

  const cleared=await clearTrash(trashedTwo.sources);
  expect(cleared.result.deletedSources).toBe(1);
  expect(cleared.sources).toEqual([]);

  // Native invoke path: flushes writes before invoking commands
  const calls:Array<{cmd:string;args?:Record<string,unknown>}>=[];
  let flushed=false;
  const mockInvoke=async <R,>(cmd:string,args?:Record<string,unknown>):Promise<R>=>{
    calls.push({cmd,args});
    if(cmd==='get_asset_path')return 'C:\\Lib\\trash\\assets\\Studio\\clip.mp4' as R;
    if(cmd==='reveal_asset_file'||cmd==='copy_image_to_clipboard')return undefined as R;
    return {
      library:JSON.stringify(trashed.sources),
      trashedCount:1,
      restoredCount:0,
      deletedSources:0,
      deletedAssets:0,
      deletedFiles:0,
      movedToTrash:1,
      restoredFromTrash:0,
      warnings:[],
    } as R;
  };
  const nativeRes=await trashItems([{sourceId:'s1',assetId:'a1'}],initial,{
    now:'2026-11-01T00:00:00.000Z',
    flushPendingWrites:async()=>{flushed=true;return true},
    invokeFn:mockInvoke,
  });
  expect(flushed).toBe(true);
  expect(nativeRes.result.movedToTrash).toBe(1);
  expect(calls[0]).toEqual({
    cmd:'trash_items',
    args:{targets:[{sourceId:'s1',assetId:'a1'}],nowIso:'2026-11-01T00:00:00.000Z'},
  });

  await expect(clearTrash(initial,{
    flushPendingWrites:async()=>false,
    invokeFn:mockInvoke,
  })).rejects.toThrow('flush pending library changes');

  await revealAssetFile('Studio/clip.mp4',true,{invokeFn:mockInvoke});
  expect(await getAssetDiskPath('Studio/clip.mp4',true,{invokeFn:mockInvoke})).toBe('C:\\Lib\\trash\\assets\\Studio\\clip.mp4');
  await copyAssetImageToClipboard({file:'Studio/shot.webp',trashed:true},{invokeFn:mockInvoke});
  expect(calls.slice(-3)).toEqual([
    {cmd:'reveal_asset_file',args:{file:'Studio/clip.mp4',trashed:true}},
    {cmd:'get_asset_path',args:{file:'Studio/clip.mp4',trashed:true}},
    {cmd:'copy_image_to_clipboard',args:{file:'Studio/shot.webp',pngBytes:null,trashed:true}},
  ]);

  const tBase=Date.UTC(2026,10,1,0,0,0,0);
  expect(formatTrashExpiryLabel('2026-11-01T00:00:00Z',tBase)).toBe('30 days left');
  expect(formatTrashExpiryLabel('2026-11-01T00:00:00Z',tBase+29*86_400_000+1_000)).toBe('1 day left');
  expect(formatTrashExpiryLabel('2026-11-01T00:00:00Z',tBase+30*86_400_000)).toBe('Expires today');
});

import {fixMojibake,fixMojibakeDeep} from './src/lib/mojibake';
import {pageSizeOptions,snapPageSize,gridColumnsCss} from './src/lib/gridColumns';
test('fixMojibake repairs layered mojibake and leaves real text alone',()=>{
  expect(fixMojibake('Exp\u00c3\u0192\u00c2\u00a9rience')).toBe('Exp\u00e9rience');
  expect(fixMojibake('Odyss\u00c3\u00a9e')).toBe('Odyss\u00e9e');
  expect(fixMojibake('Oak\u00e2me')).toBe('Oak\u00e2me');
  expect(fixMojibake('Th\u00e9\u00e2tre')).toBe('Th\u00e9\u00e2tre');
  expect(fixMojibake('plain')).toBe('plain');
  const rows=[{title:'ok',tags:['a']}];expect(fixMojibakeDeep(rows)).toBe(rows);
  expect(fixMojibakeDeep([{title:'Caf\u00c3\u00a9'}])).toEqual([{title:'Caf\u00e9'}]);
});
test('page sizes are whole rows for the view columns',()=>{
  for(const c of [1,2,3,4,5,6,7,8])for(const n of pageSizeOptions(c))expect(n%c).toBe(0);
  expect(snapPageSize(30,6)).toBe(30);expect(snapPageSize(30,7)).toBe(28);expect(snapPageSize(102,6)).toBe(102);
  expect(gridColumnsCss('compact')).toContain('/6)');expect(gridColumnsCss('list')).toBeUndefined();
});

test('tag autocomplete and discover search match hyphenated tags when hyphens are omitted',()=>{
  expect(matches('e-commerce','ecommerce')).toBe(true);
  expect(matches('case-study','case study')).toBe(true);
  expect(matches('micro-interactions','mcintr')).toBe(true);

  const known=['ecommerce-ui','e-commerce','case-study','micro-interactions','Editorial'];
  expect(filterTagSuggestions(known,'ecommerce')).toEqual(['e-commerce','ecommerce-ui']);
  expect(filterTagSuggestions(known,'ecommerce',['e-commerce'])).toEqual(['ecommerce-ui']);
  expect(filterTagSuggestions(known,'casestudy')).toEqual(['case-study']);
  expect(filterTagSuggestions(known,'case study')).toEqual(['case-study']);
  expect(filterTagSuggestions(known,'mcintr')).toEqual(['micro-interactions']);
  expect(filterTagSuggestions(known,'   ')).toEqual([]);
  expect(scoreTagMatch('e-commerce','ecommerce')).toBeGreaterThan(scoreTagMatch('ecommerce-ui','ecommerce'));

  const sites=[
    {title:'Storefront',url:'https://store.example',tags:['e-commerce'],sources:[{name:'Awwwards',date:'2026-01-01'}]},
    {title:'Portfolio',url:'https://studio.example',tags:['case-study'],sources:[{name:'Lapa',date:'2026-01-01'}]},
  ];
  const filtered=filterDiscoverSites(sites,{
    query:'ecommerce',
    colors:[],
    years:[],
    sources:[],
    industries:[],
    tags:[],
    statuses:[],
    visited:{},
    paletteSwatches:[],
  });
  expect(filtered.map(s=>s.title)).toEqual(['Storefront']);
});