import {test,expect} from 'bun:test';
import {sameSource,colorDistance,matches,setTrash,displayUrl,groupSourcesByUrl,toggleFavorite,zoomAround} from './src/logic';
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
