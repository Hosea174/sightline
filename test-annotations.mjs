import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const context={};runInNewContext(readFileSync('extension/annotations.js','utf8'),context);
const crop={x:.25,y:.25,w:.5,h:.5};
const items=[{id:'a',x:.3,y:.3,w:.2,h:.2,text:'Area',start:3,end:12},{id:'b',x:.1,y:.1,w:0,h:0,text:'Outside',start:3,end:4},{id:'c',x:.4,y:.4,w:0,h:0,text:'Trimmed',start:5,end:7}];
const clips=[{start:20,end:25,at:0},{start:40,end:45,at:8}];
const result=context.remapAnnotations(items,crop,clips);
assert.equal(result.length,2);assert.ok(Math.abs(result[0].x-.1)<1e-9);assert.ok(Math.abs(result[0].w-.4)<1e-9);assert.equal(result[0].start,3);assert.equal(result[0].end,5);assert.equal(result[1].start,5);assert.equal(result[1].end,9);assert.notEqual(result[0].id,result[1].id);
const legacy=context.remapAnnotations([{id:'old',x:.5,y:.5,w:0,h:0,text:'Old',time:42}],crop,clips);assert.equal(legacy.length,1);assert.equal(legacy[0].start,7);assert.equal(legacy[0].end,9);
console.log('Annotation crop, timeline cuts, and legacy timestamps passed.');

const clamped=context.clampAnnotationRange({start:6,end:8},{start:0,end:5});assert.ok(clamped.start<5);assert.equal(clamped.end,5);const short=context.clampAnnotationRange({start:0,end:2},{start:0,end:.04});assert.equal(short.end,.04);
