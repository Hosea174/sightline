import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
let listener,stopCount=0,opened='',instance;const records=new Map(),chunks=[];
const track={stop(){stopCount++}};const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
class FakeRecorder{constructor(){instance=this;this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['video'])});void this.onstop()}}
const chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async m=>{opened=`review.html?id=${m.id}`;return {ok:true}}}};
const context={chrome,crypto:webcrypto,MediaRecorder:FakeRecorder,navigator:{mediaDevices:{getUserMedia:async()=>stream}},storeRecording:async(id,value)=>records.set(id,value),storeChunk:async(id,index,blob)=>chunks.push({id,index,blob}),console,Promise};
vm.runInNewContext(fs.readFileSync(new URL('./extension/recorder.js',import.meta.url),'utf8'),context);
const send=type=>new Promise(resolve=>listener({type,stream:'stream',title:'Example',url:'https://example.com'},null,resolve));
assert.equal((await send('start')).ok,true);assert.equal((await send('start')).error,'Error: A recording is already running or finishing.');assert.equal(stopCount,0);
assert.equal((await send('stop-recording')).ok,true);await new Promise(r=>setTimeout(r,10));
assert.equal(chunks.length,1);assert.equal(await chunks[0].blob.text(),'video');assert.equal([...records.values()][0].state,'ready');assert.match(opened,/^review\.html\?id=/);assert.equal(stopCount,1);
console.log('Recording lifecycle, concurrent-start safety and chunk persistence passed.');
