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

// Multi-variant, variable font, extensionless URL, and Save all verification
const savedPayloads=[];
let findResponse=null;
let failUrl='';
const chrome2={commands:{getAll:cb=>cb([])},tabs:{create(){}},runtime:{
  getURL:x=>x,
  async sendMessage(message){
    if(message.type==='recording-status')return {recording:false};
    if(message.type==='find-fonts')return findResponse;
    if(message.type==='save-font'){
      if(failUrl&&message.file===failUrl)throw Error('Network error');
      savedPayloads.push(message);
      return {ok:true};
    }
    return {};
  }
}};
const nodes2=Object.fromEntries(ids.map(id=>[id,new Element()]));
nodes2.record.parts={'.action-label':new Element(),small:new Element()};
const main2=new Element(),controls2=['record','screenshot','full-page','area','fonts','recordings'].map(id=>nodes2[id]);
const doc2={getElementById:id=>nodes2[id],querySelector:()=>main2,querySelectorAll:()=>controls2,createElement:()=>new Element()};
vm.runInNewContext(fs.readFileSync('extension/popup.js','utf8'),{document:doc2,chrome:chrome2,URL,listRecordings:async()=>[]});

findResponse={
  title:'Design System',
  url:'https://design.example',
  fonts:[
    {
      name:'Space Grotesk',
      files:['https://cdn.example/sg-400.woff2','https://cdn.example/font?id=700i'],
      variants:[
        {file:'https://cdn.example/sg-400.woff2',ext:'woff2',weight:400,weightMin:400,weightMax:400,isVariable:false,style:'normal'},
        {file:'https://cdn.example/font?id=700i',ext:'woff2',weight:700,weightMin:700,weightMax:700,isVariable:false,style:'italic'}
      ]
    },
    {
      name:'Inter',
      files:['https://cdn.example/inter-var.woff2'],
      variants:[
        {file:'https://cdn.example/inter-var.woff2',ext:'woff2',weight:400,weightMin:200,weightMax:800,isVariable:true,style:'normal'}
      ]
    },
    {
      name:'System Fallback',
      files:[],
      variants:[]
    }
  ]
};

await nodes2.fonts.onclick();
assert.equal(nodes2.status.textContent,'3 font families found.');
assert.equal(nodes2.fontList.children.length,3);

const sgRow=nodes2.fontList.children[0];
assert.equal(sgRow.children[0].textContent,'Space Grotesk');
assert.equal(sgRow.children[1].textContent,'400 Regular · WOFF2');
assert.equal(sgRow.children[2].textContent,'700 Bold Italic · WOFF2');
assert.equal(sgRow.children[3].textContent,'Save all (2)');

const interRow=nodes2.fontList.children[1];
assert.equal(interRow.children[1].textContent,'Variable 200–800 · WOFF2');

const unavailableRow=nodes2.fontList.children[2];
assert.equal(unavailableRow.children[1].textContent,'File unavailable');

// Save single variant first, then Save all should fail cleanly on failing 700i and recover on retry
await sgRow.children[1].onclick();
assert.equal(sgRow.children[1].textContent,'Saved');
assert.deepEqual(JSON.parse(JSON.stringify(savedPayloads[0])),{
  type:'save-font',
  file:'https://cdn.example/sg-400.woff2',
  extension:'woff2',
  name:'Space Grotesk 400',
  family:'Space Grotesk',
  weight:400,
  weightMin:400,
  weightMax:400,
  isVariable:false,
  style:'normal',
  fontSource:'capture',
  title:'Design System',
  url:'https://design.example'
});

failUrl='https://cdn.example/font?id=700i';
await sgRow.children[3].onclick();
assert.equal(sgRow.children[2].disabled,false);
assert.equal(sgRow.children[3].disabled,false);
assert.equal(savedPayloads.length,1);

failUrl='';
await sgRow.children[3].onclick();
assert.equal(sgRow.children[2].textContent,'Saved');
assert.equal(sgRow.children[3].textContent,'Saved all');
assert.equal(savedPayloads.length,2);
assert.equal(savedPayloads[1].weight,700);
assert.equal(savedPayloads[1].style,'italic');
assert.equal(savedPayloads[1].extension,'woff2');

await interRow.children[1].onclick();
assert.equal(interRow.children[1].textContent,'Saved');
assert.equal(savedPayloads[2].isVariable,true);
assert.equal(savedPayloads[2].weightMin,200);
assert.equal(savedPayloads[2].weightMax,800);

console.log('Popup font retry, busy recovery, multi-variant metadata, and recording controls passed.');
