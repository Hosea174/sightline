import {test,expect} from 'bun:test';
import {sameSource,colorDistance,matches,setTrash} from './src/logic';
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
