import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
let listener,command,stored,opened,restored=false,scrolls=[],draws=0,hidden=false,area=false,dimensions=[],targets=[],notices=[],badgeCalls=[],permissionDenied=false;
const chrome={runtime:{onMessage:{addListener:f=>listener=f}},commands:{onCommand:{addListener:f=>command=f}},action:{setBadgeBackgroundColor:async v=>{badgeCalls.push(['bg',v])},setBadgeText:async v=>{badgeCalls.push(['text',v])},setTitle:async v=>{badgeCalls.push(['title',v])}},tabs:{query:async({windowId})=>[{id:windowId===3?7:1,windowId:windowId||2,title:'Example',url:'https://example.com'}],captureVisibleTab:async()=>{
 if(permissionDenied)throw Error("Either the '<all_urls>' or 'activeTab' permission is required.");
 return 'data:image/png;base64,AA==';
},create:async a=>{opened=a.url}},storage:{local:{set:async v=>{stored=v}}},scripting:{executeScript:async({target,func,args=[]})=>{targets.push(target.tabId);const text=func.toString();if(text.includes("el.textContent="))notices.push(args[0]);if(text.includes('__sightline_selector'))return [{result:area===true?{left:10,top:80,width:50,height:140}:area||null}];if(text.includes('total:Math.max'))return [{result:{x:0,y:100,width:100,height:100,total:250}}];if(text.includes('scrollTo(x,y);return scrollY')){const y=Math.min(args[0],150);scrolls.push(y);return [{result:y}]}if(text.includes('__sightlineHidden=['))hidden=true;if(text.includes('scrollTo(x,y)'))restored=true;return [{result:undefined}]}}};
chrome.runtime.getURL=x=>x;class Canvas{constructor(w,h){this.width=w;this.height=h;dimensions.push([w,h])}getContext(){return {drawImage(){draws++}}}async convertToBlob(){return new Blob(['x'])}}class Reader{readAsDataURL(){this.result='data:image/png;base64,eA==';this.onload()}}
const context={chrome,OffscreenCanvas:Canvas,FileReader:Reader,createImageBitmap:async()=>({width:100,height:100,close(){}}),fetch:async()=>({blob:async()=>new Blob(['x'])}),setTimeout:f=>{queueMicrotask(f);return 1},clearTimeout(){},Promise,URL,Uint8Array,Array,Error,console};vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),context);const result=await new Promise(resolve=>listener({type:'full-page'},null,resolve));assert.equal(result.ok,true);assert.deepEqual(scrolls,[0,100,150]);assert.equal(draws,3);assert.ok(hidden&&restored);assert.equal(stored.cropFull,true);assert.equal(opened,'crop.html');area=true;scrolls=[];draws=0;restored=false;opened=null;const selected=await new Promise(resolve=>listener({type:'area'},null,resolve));assert.equal(selected.ok,true);assert.deepEqual(scrolls,[80,150]);assert.equal(draws,2);assert.deepEqual(dimensions.at(-1),[50,140]);assert.ok(restored);assert.equal(opened,'crop.html');area={left:10,top:120,width:50,height:40};scrolls=[];draws=0;const visible=await new Promise(resolve=>listener({type:'area'},null,resolve));assert.equal(visible.ok,true);assert.deepEqual(scrolls,[100]);assert.equal(draws,1);const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
assert.ok(manifest.host_permissions.includes('<all_urls>'));
assert.ok(manifest.permissions.includes('activeTab'));
const sourceTab={id:7,windowId:3,title:'Original tab',url:'https://capture.example'};
targets=[];
assert.equal((await new Promise(resolve=>listener({type:'area'},{tab:sourceTab},resolve))).ok,true);
assert.ok(targets.length>0&&targets.every(id=>id===7));
assert.equal(stored.cropTitle,'Original tab');
permissionDenied=true;
targets=[];
await command('capture-area',sourceTab);
assert.ok(targets.every(id=>id===7));
assert.equal(notices.length,1);
assert.match(notices[0],/needs site access/);
assert.ok(badgeCalls.length>0&&badgeCalls.every(([,arg])=>arg.tabId===7));
console.log('Full-page and area capture restore scrolling, keep the source tab, and report permission failures once.');
