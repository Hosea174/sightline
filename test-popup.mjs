import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class Element {
  children=[]; disabled=false; attrs={}; textContent='';
  classList={toggle(){}};
  append(child){this.children.push(child)}
  setAttribute(name,value){this.attrs[name]=value}
  querySelector(name){return this.parts[name]}
}
const ids=['status','fontList','record','screenshot','full-page','area','fonts','recordings','shortcuts'];
const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
nodes.record.parts={'.action-label':new Element(),small:new Element()};
const main=new Element(),controls=['record','screenshot','full-page','area','fonts','recordings'].map(id=>nodes[id]);
let failSave=true;
const chrome={commands:{getAll:cb=>cb([])},tabs:{create(){}},runtime:{
  getURL:x=>x,
  async sendMessage(message){
    if(message.type==='recording-status')return {recording:false};
    if(message.type==='find-fonts')return {fonts:[{name:'Example',files:['https://example.com/font.woff2']}],title:'Page',url:'https://example.com'};
    if(message.type==='save-font'&&failSave)throw Error('Bridge unavailable');
    return {};
  }
}};
const document={getElementById:id=>nodes[id],querySelector:()=>main,querySelectorAll:()=>controls,createElement:()=>new Element()};
vm.runInNewContext(fs.readFileSync('extension/popup.js','utf8'),{document,chrome,URL,listRecordings:async()=>[]});
await nodes.fonts.onclick();
assert.equal(main.attrs['aria-busy'],'false');
assert(controls.every(control=>!control.disabled));
const save=nodes.fontList.children[0].children[1];
await save.onclick();
assert.equal(save.disabled,false);
assert.match(nodes.status.textContent,/Bridge unavailable/);
failSave=false;
await save.onclick();
assert.equal(save.textContent,'Saved');
await nodes.record.onclick();
assert.equal(nodes.record.parts['.action-label'].textContent,'Stop recording');
await nodes.record.onclick();
assert.equal(nodes.record.parts['.action-label'].textContent,'Record tab');
assert(controls.every(control=>!control.disabled));
console.log('Popup font retry, busy recovery and recording controls passed.');
