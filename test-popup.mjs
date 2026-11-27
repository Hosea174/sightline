import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class Element {
  children=[]; disabled=false; attrs={}; textContent='';
  classList={toggle(){}};
  addEventListener(type,listener){this['on'+type]=listener}
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
assert.equal(save.textContent,'Installed');
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
assert.equal(sgRow.children[1].textContent,'Installed');
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
assert.equal(sgRow.children[2].textContent,'Installed');
assert.equal(sgRow.children[3].textContent,'Installed all');
assert.equal(savedPayloads.length,2);
assert.equal(savedPayloads[1].weight,700);
assert.equal(savedPayloads[1].style,'italic');
assert.equal(savedPayloads[1].extension,'woff2');

await interRow.children[1].onclick();
assert.equal(interRow.children[1].textContent,'Installed');
assert.equal(savedPayloads[2].isVariable,true);
assert.equal(savedPayloads[2].weightMin,200);
assert.equal(savedPayloads[2].weightMax,800);

// Partial font save (saved locally, Windows install failed) should not misreport Installed all
const chromeInstallErr={commands:{getAll:cb=>cb([])},tabs:{create(){}},runtime:{
  getURL:x=>x,
  async sendMessage(message){
    if(message.type==='recording-status')return {recording:false};
    if(message.type==='find-fonts')return {title:'Page',url:'https://example.com',fonts:[{name:'LocalErr',files:['https://cdn.example/a.woff2','https://cdn.example/b.woff2']}]};
    if(message.type==='save-font')return {ok:true,installError:'Bridge outdated'};
    return {};
  }
}};
const nodesErr=Object.fromEntries(ids.map(id=>[id,new Element()]));
nodesErr.record.parts={'.action-label':new Element(),small:new Element()};
const mainErr=new Element(),controlsErr=['record','screenshot','full-page','area','fonts','recordings'].map(id=>nodesErr[id]);
const docErr={getElementById:id=>nodesErr[id],querySelector:()=>mainErr,querySelectorAll:()=>controlsErr,createElement:()=>new Element()};
vm.runInNewContext(fs.readFileSync('extension/popup.js','utf8'),{document:docErr,chrome:chromeInstallErr,URL,listRecordings:async()=>[]});
await nodesErr.fonts.onclick();
const errRow=nodesErr.fontList.children[0];
await errRow.children[3].onclick();
assert.equal(errRow.children[1].textContent,'Saved');
assert.equal(errRow.children[2].textContent,'Saved');
assert.equal(errRow.children[3].textContent,'Saved all');
assert.equal(errRow.children[3].disabled,true);
assert.match(nodesErr.status.textContent,/installation failed/i);

// Cross-tab recording status identifies the recording tab instead of misleading about the active tab
const chromeOtherTab={commands:{getAll:cb=>cb([])},tabs:{create(){},query:async()=>[{id:1,title:'Current tab'}]},runtime:{
  getURL:x=>x,
  async sendMessage(message){
    if(message.type==='recording-status')return {recording:true,tabId:99,title:'Stripe'};
    return {};
  }
}};
const nodesOther=Object.fromEntries(ids.map(id=>[id,new Element()]));
nodesOther.record.parts={'.action-label':new Element(),small:new Element()};
const mainOther=new Element(),controlsOther=['record','screenshot','full-page','area','fonts','recordings'].map(id=>nodesOther[id]);
const docOther={getElementById:id=>nodesOther[id],querySelector:()=>mainOther,querySelectorAll:()=>controlsOther,createElement:()=>new Element()};
vm.runInNewContext(fs.readFileSync('extension/popup.js','utf8'),{document:docOther,chrome:chromeOtherTab,URL,listRecordings:async()=>[]});
await new Promise(setImmediate);
assert.equal(nodesOther.record.parts['.action-label'].textContent,'Stop recording');
assert.equal(nodesOther.record.parts.small.textContent,'Recording "Stripe"');
assert.equal(nodesOther.record.attrs['aria-label'],'Stop recording "Stripe"');

console.log('Popup font retry, busy recovery, multi-variant metadata, and recording controls passed.');
