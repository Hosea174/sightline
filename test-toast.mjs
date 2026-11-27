import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
 children=[];
 attrs={};
 className='';
 value='';
 style={setProperty:(key,value)=>{this.style[key]=value}};
 classList={
  contains:name=>this.className.split(' ').includes(name),
  add:name=>this.classList.toggle(name,true),
  toggle:(name,on)=>{
   const classes=new Set(this.className.split(' ').filter(Boolean));
   if(on)classes.add(name);
   else classes.delete(name);
   this.className=[...classes].join(' ');
  },
 };
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 addEventListener(){}
 setAttribute(key,value){this.attrs[key]=value}
 getContext(){return {drawImage(){}}}
}

const nodes=new Map(),listeners=new Map(),timers=new Map();
const document={
 hidden:true,
 querySelector:()=>null,
 getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)},
 createElement:()=>new Element(),
 addEventListener:(name,fn)=>listeners.set(name,fn),
 removeEventListener:name=>listeners.delete(name),
};
let now=0,timerId=0,closed=0,saves=0,fail=false,confirmations=0,image,opened;
const window={close:()=>closed++,addEventListener(){},captureTags:{values:()=>[]}};
const context=vm.createContext({
 document,window,performance:{now:()=>now},
 setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},
 clearTimeout:id=>timers.delete(id),
 confirm:()=>{confirmations++;return false},
 Image:class{constructor(){image=this}},
 createCropEditor:()=>({get:()=>({x:0,y:0,w:1,h:1}),reset(){},isFull:()=>true}),
 createAnnotations:()=>({export:()=>[],hasOmitted:()=>false}),
 chrome:{
  storage:{local:{get:async()=>({cropId:'crop',cropImage:'data:image/png;base64,AA=='}),remove:async()=>{}}},
  runtime:{sendMessage:async message=>{
   if(message.type==='open-asset'){opened=message.id;return {ok:true}}
   saves++;
   return fail?{error:'Save failed'}:{ok:true,id:'saved-image'};
  }},
 },
});
for(const file of ['brand.js','crop.js']){
 vm.runInContext(fs.readFileSync(new URL(`./extension/${file}`,import.meta.url),'utf8'),context);
}
await new Promise(setImmediate);
image.onload();
const [initializationTimer]=timers.keys();
timers.get(initializationTimer).fn();
timers.delete(initializationTimer);
const toast=nodes.get('toast')||document.getElementById('toast');
const save=()=>nodes.get('save').onclick();
const title=()=>toast.children[0].children[0].textContent;
const buttons=()=>toast.children[0].children[2].children;
function fireTimer(delay){
 const [id,timer]=[...timers].find(([,timer])=>timer.delay===delay);
 timers.delete(id);
 timer.fn();
}

await save();
assert.equal(title(),'Capture saved');
assert.equal(toast.classList.contains('visible'),false);
assert.equal(toast.children[2].children[0].className,'toast-progress-bar');
assert.equal(timers.size,0);
document.hidden=false;
listeners.get('visibilitychange')();
assert.ok(toast.classList.contains('visible'));
assert.equal(toast.style['--toast-duration'],'5000ms');
now=2500;
toast.onpointerenter();
assert.ok(toast.classList.contains('paused'));
assert.equal(timers.size,0);
now=15000;
toast.onpointerleave();
fireTimer(2500);
assert.ok(toast.classList.contains('closing'));
fireTimer(180);
assert.equal(toast.className,'');

await save();
assert.equal(confirmations,1);
assert.equal(saves,1);
assert.equal(title(),'Already saved');
assert.ok(toast.classList.contains('tone-warning'));
buttons()[1].onclick();
assert.equal(closed,1);
await buttons()[0].onclick();
assert.equal(opened,'saved-image');

nodes.get('title').value='Edited capture';
fail=true;
await save();
assert.equal(toast.attrs.role,'alert');
assert.equal(title(),'Could not save capture');
fail=false;
await save();
assert.equal(confirmations,1);
assert.equal(saves,3);
assert.equal(title(),'Capture saved');
assert.equal(toast.children[0].children[1].textContent,'Edited capture');
assert.ok(toast.classList.contains('visible'));
document.hidden=true;
listeners.get('visibilitychange')();
assert.equal(toast.className,'');
assert.equal(timers.size,0);
console.log('Screenshot save, duplicate warning, tab actions, failure recovery, and toast countdown passed.');
