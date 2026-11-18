import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const events={};
class ClassList{constructor(){this.set=new Set()}toggle(k,f){if(f===undefined){if(this.set.has(k)){this.set.delete(k);return false}this.set.add(k);return true}if(f)this.set.add(k);else this.set.delete(k);return f}contains(k){return this.set.has(k)}}
class El{constructor(id=''){this.id=id;this.style={};this.dataset={};this.value='';this.children=[];this._text='';this.paused=true;this.currentTime=0;this.playbackRate=1;this.duration=10;this.videoWidth=160;this.videoHeight=90;this.tagName='DIV';this.attrs={};this.listeners={};this.classList=new ClassList()}set textContent(value){this._text=value;this.children=[]}get textContent(){return this._text}append(el){this.children.push(el)}setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}addEventListener(type, listener){this.listeners[type]=listener}setPointerCapture(){}getBoundingClientRect(){return {left:0,width:100,height:210}}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}}
const nodes={};const panel=new El('timeline-panel');
const doc={getElementById(id){return nodes[id]??=new El(id)},createElement(){return new El()},querySelector(s){if(s==='.timeline-panel')return panel;return null}};
let crop={x:0,y:0,w:1,h:1},cropCommit,cropActive=false,savedPayload=null,retimedCalls=0,showToastArgs=null;
const context={
 createAnnotations:()=>({renderTimeline(){},renderMarks(){},shiftTiming(){},setDrawing(){},snapshot:()=>[],restore(){},hasOmitted:()=>false,export:()=>[]}),
 createCropEditor:(_el,onChange,commit)=>{cropCommit=commit;return {get:()=>({...crop}),set:v=>{crop={...v};onChange?.(crop,{active:cropActive,full:crop.x===0&&crop.y===0&&crop.w===1&&crop.h===1})},reset:()=>{crop={x:0,y:0,w:1,h:1};cropActive=false;onChange?.(crop,{active:false,full:true})},setActive:v=>{cropActive=Boolean(v);onChange?.(crop,{active:cropActive,full:crop.x===0&&crop.y===0&&crop.w===1&&crop.h===1})},isActive:()=>cropActive,isFull:()=>crop.x===0&&crop.y===0&&crop.w===1&&crop.h===1}},
 renderSpeedAdjustedWebm:async(_url,segs)=>{retimedCalls++;const dur=segs.reduce((s,x)=>s+(x.end-x.start)/(x.speed||1),0);return {blob:new Blob(['retimed']),duration:dur}},
 showToast:(...a)=>{showToastArgs=a},
 document:doc,
 window:{addEventListener:(name,fn)=>events[name]=fn,captureTags:{values:()=>[]},innerHeight:900,dispatchEvent(){}},
 location:{href:'https://extension/review.html?id=test'},
 URL:class extends URL{static createObjectURL(){return 'blob:test'}static revokeObjectURL(){}},
 readRecording:async()=>({title:'Test',url:'https://example.com',blob:new Blob(['abc'])}),
 deleteRecording:async()=>{},
 Blob,Error,Promise,Math,Number,String,Array,CustomEvent:class{constructor(t){this.type=t}},requestAnimationFrame:()=>{},cancelAnimationFrame:()=>{},confirm:()=>false,console,
 chrome:{runtime:{sendMessage:async m=>{savedPayload=m;return {ok:true}}}}
};
vm.runInNewContext(fs.readFileSync(new URL('./extension/review.js',import.meta.url),'utf8'),context);
await new Promise(r=>setTimeout(r,10));
const timelineStyle={};
nodes.track.parentElement={style:{setProperty:(key,value)=>timelineStyle[key]=value}};
nodes.video.onloadedmetadata();
assert.equal(nodes.duration.textContent,'00:10.00 · 1 clip');
assert.equal(nodes['crop-toggle'].getAttribute('aria-pressed'),'false');
assert.equal(nodes['reset-crop'].disabled,true);
function key(code,extras={}){events.keydown({code,key:code,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,target:{tagName:'DIV'},preventDefault(){},...extras})}
function pointer(x,target={dataset:{},closest:()=>null}){return {clientX:x,pointerId:1,target,preventDefault(){},stopPropagation(){}}}
nodes.playhead.onpointerdown(pointer(50));events.pointerup();assert.equal(nodes.clock.textContent,'00:05.00 / 00:10.00');
key('KeyB',{ctrlKey:true,altKey:true});assert.equal(nodes.duration.textContent,'00:10.00 · 2 clips');
key('Delete',{key:'Delete'});assert.equal(nodes.duration.textContent,'00:10.00 · 1 clip · out 00:05.00');
key('KeyZ',{ctrlKey:true});assert.equal(nodes.duration.textContent,'00:10.00 · 2 clips');
cropCommit({...crop});crop={x:0.1,y:0.1,w:0.8,h:0.8};key('KeyZ',{ctrlKey:true});assert.equal(crop.x,0);key('KeyY',{ctrlKey:true});assert.equal(crop.x,0.1);
key('KeyC');assert.equal(cropActive,true);assert.equal(nodes['crop-toggle'].getAttribute('aria-pressed'),'true');
key('KeyC');assert.equal(cropActive,false);
nodes.clips.children[0].onpointerdown(pointer(0,{dataset:{},closest:()=>null}));events.pointerup();
nodes.playhead.onpointerdown(pointer(20));events.pointerup();
key('KeyQ');assert.match(nodes.clips.children[0].getAttribute('aria-label'),/source 00:02\.00 to 00:05\.00, timeline 00:00\.00/);assert.equal(nodes.clock.textContent,'00:00.00 / 00:08.00');
nodes.reset.listeners.click();
nodes.playhead.onpointerdown(pointer(60));events.pointerup();
key('KeyW');
assert.equal(nodes.clips.children[0].style.width,'60%');
assert.equal(nodes.ruler.children.at(-1).textContent,'00:10.00');
nodes.clips.children[0].onpointerdown(pointer(0,{dataset:{},closest:()=>null}));nodes.track.onpointermove(pointer(20));events.pointerup();
assert.match(nodes.clips.children[0].getAttribute('aria-label'),/timeline 00:02\.00/);
key('ArrowRight',{key:'ArrowRight',ctrlKey:true,altKey:true});assert.equal(nodes.clock.textContent,'00:08.00 / 00:08.00');
nodes.play.listeners.click();assert.equal(nodes.clock.textContent,'00:02.00 / 00:08.00');
nodes.video.pause();
key('ArrowLeft',{key:'ArrowLeft',ctrlKey:true,altKey:true});assert.equal(nodes.clock.textContent,'00:02.00 / 00:08.00');
key('End',{key:'End'});assert.equal(nodes.clock.textContent,'00:08.00 / 00:08.00');
key('Home',{key:'Home'});assert.equal(nodes.clock.textContent,'00:02.00 / 00:08.00');
// Speed adjustment & export
nodes.reset.listeners.click();
nodes.speed.value='2';nodes.speed.onchange();
assert.equal(nodes.duration.textContent,'00:10.00 · 1 clip · out 00:05.00');
assert.equal(nodes.video.playbackRate,2);
await nodes.save.onclick();
assert.equal(retimedCalls,1);
assert.equal(JSON.stringify(savedPayload.segments),JSON.stringify([{start:0,end:5}]));
// The two upper corners shorten the same source segment when dragged inward.
for(const [side,from,to] of [['speed-left',0,50],['speed-right',100,50]]){
 nodes.reset.listeners.click();
 const clip=nodes.clips.children[0];
 assert.match(clip.innerHTML,/data-side="speed-left"/);
 assert.match(clip.innerHTML,/data-side="speed-right"/);
 clip.onpointerdown(pointer(from,{dataset:{side}}));
 nodes.track.onpointermove(pointer(to));
 events.pointerup();
 assert.equal(nodes.clips.children[0].style.width,'50%');
 assert.match(nodes.clips.children[0].getAttribute('aria-label'),/source 00:00\.00 to 00:10\.00/);
 assert.equal(nodes.ruler.children.at(-1).textContent,'00:10.00');
}
nodes.speed.value='0.5';nodes.speed.onchange();
assert.equal(nodes.ruler.children.at(-1).textContent,'00:20.00');
assert.equal(nodes.ruler.children.find(tick=>tick.textContent==='00:10.00').style.left,'50%');
assert.equal(timelineStyle['--timeline-content-width'],'200%');
// Ctrl+` minimize/restore timeline
key('Backquote',{ctrlKey:true});assert.equal(panel.classList.contains('minimized'),true);
key('Backquote',{ctrlKey:true});assert.equal(panel.classList.contains('minimized'),false);
console.log('Timeline drag, trim, split, undo, opt-in crop, speed export, minimize and boundary shortcuts passed.');
