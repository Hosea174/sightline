import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
let listener;const messages=[],tabs=[];const handlers={message:[],disconnect:[]};const event=name=>({addListener:f=>handlers[name].push(f),removeListener:f=>{handlers[name]=handlers[name].filter(x=>x!==f)}});
const port={onMessage:event('message'),onDisconnect:event('disconnect'),postMessage(msg){messages.push(msg);queueMicrotask(()=>handlers.message.forEach(f=>f({ok:true})))},disconnect(){}};
const chrome={scripting:{executeScript:async()=>[{result:{fonts:[{name:'Inter',files:['https://example.com/inter.woff2']}],external:[]}}]},tabs:{query:async()=>[{id:7,windowId:1,title:'Example',url:'https://example.com/page'}],captureVisibleTab:async()=>'data:image/png;base64,YQ==',create:async x=>tabs.push(x)},storage:{local:{set:async()=>{}}},commands:{onCommand:{addListener:()=>{}}},runtime:{onMessage:{addListener:fn=>listener=fn},connectNative:name=>{assert.equal(name,'com.sightline.capture');return port},getURL:s=>s}};
vm.runInNewContext(fs.readFileSync(new URL('./extension/background.js',import.meta.url),'utf8'),{chrome,crypto:webcrypto,fetch:async()=>new Response(new Blob(['abc'])),console,Error,Promise,Uint8Array,Array,queueMicrotask,URL,setTimeout,clearTimeout});
const call=msg=>new Promise(resolve=>listener(msg,null,resolve));
assert.equal((await call({type:'save-clip',data:'blob:test',title:'Example',url:'https://example.com',tags:['motion'],category:'Web design',segments:[{start:1,end:2}]})).ok,true);assert.equal(messages[0].type,'begin');assert.deepEqual(messages[0].tags,['motion']);assert.deepEqual(messages[0].segments,[{start:1,end:2}]);assert.deepEqual(messages[1].data,[97,98,99]);assert.equal(messages[2].type,'end');
assert.equal((await call({type:'screenshot'})).ok,true);assert.equal(tabs[0].url,'crop.html');
// Legacy find-fonts result remains backward compatible
const legacyFound=await call({type:'find-fonts'});
assert.equal(legacyFound.fonts[0].name,'Inter');
assert.deepEqual(JSON.parse(JSON.stringify(legacyFound.fonts[0].files)),['https://example.com/inter.woff2']);
assert.equal(legacyFound.fonts[0].variants[0].ext,'woff2');
assert.equal(legacyFound.fonts[0].variants[0].isVariable,false);

// Structured find-fonts with @font-face static, italic, variable, format priority, unicode-range, and @import
let scriptResult={
  computed:[
    {name:'Space Grotesk',usedWeights:[400,700]},
    {name:'sans-serif',usedWeights:[400]},
    {name:'system-ui',usedWeights:[400]}
  ],
  inlineFaces:[
    {
      family:'"Space Grotesk"',
      weight:'400',
      style:'normal',
      unicodeRange:'',
      base:'https://example.com/page',
      src:'local("Space Grotesk"), url("/fonts/sg-400.woff") format("woff"), url("/fonts/sg-400.woff2") format("woff2")'
    },
    {
      family:'"Space Grotesk"',
      weight:'700',
      style:'italic',
      unicodeRange:'',
      base:'https://example.com/page',
      src:'url("https://cdn.example.com/font?id=700i") format("woff2")'
    },
    {
      family:'Plus Jakarta Sans',
      weight:'200 800',
      style:'normal',
      unicodeRange:'',
      base:'https://example.com/page',
      src:'url("/fonts/pjs-var.woff2") format("woff2-variations")'
    }
  ],
  external:['https://fonts.example.com/css2?family=Newsreader']
};

function makeWoff2(tag=''){
  const buf=new Uint8Array(64);
  buf[0]=0x77;buf[1]=0x4f;buf[2]=0x46;buf[3]=0x32;
  for(let i=0;i<tag.length&&i+16<buf.length;i++)buf[i+16]=tag.charCodeAt(i);
  return buf;
}
function makeEot(){
  const buf=new Uint8Array(64);
  buf[8]=0x01;buf[9]=0x00;buf[10]=0x02;buf[11]=0x00;
  buf[34]=0x4c;buf[35]=0x50;
  return buf;
}

const cssResponses={
  'https://fonts.example.com/css2?family=Newsreader':`@import url("https://fonts.example.com/newsreader-weights.css");`,
  'https://fonts.example.com/newsreader-weights.css':`
    /* cyrillic */
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      src: url(https://fonts.example.com/newsreader-400-cyr.woff2) format('woff2');
      unicode-range: U+0400-045F;
    }
    /* latin */
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      src: url(https://fonts.example.com/newsreader-400-lat.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131;
    }
    /* latin */
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 600;
      src: url(https://fonts.example.com/newsreader-600-lat.woff2) format('woff2');
      unicode-range: U+0000-00FF;
    }
  `,
  'https://cdn.example.com/font?id=700i':makeWoff2('700i')
};

let listener2;const messages2=[];const fetchCalls2=[];
const handlers2={message:[],disconnect:[]};const event2=name=>({addListener:f=>handlers2[name].push(f),removeListener:f=>{handlers2[name]=handlers2[name].filter(x=>x!==f)}});
const port2={onMessage:event2('message'),onDisconnect:event2('disconnect'),postMessage(msg){messages2.push(msg);queueMicrotask(()=>handlers2.message.forEach(f=>f({ok:true})))},disconnect(){}};
const chrome2={scripting:{executeScript:async()=>[{result:scriptResult}]},tabs:{query:async()=>[{id:7,windowId:1,title:'Example',url:'https://example.com/page'}]},storage:{local:{set:async()=>{}}},commands:{onCommand:{addListener:()=>{}}},runtime:{onMessage:{addListener:fn=>listener2=fn},connectNative:()=>port2,getURL:s=>s}};
vm.runInNewContext(fs.readFileSync(new URL('./extension/background.js',import.meta.url),'utf8'),{chrome:chrome2,crypto:webcrypto,fetch:async(u,init)=>{fetchCalls2.push({u,init});const v=cssResponses[u];return v instanceof Uint8Array?new Response(new Blob([v]),{headers:{'content-type':'font/woff2'}}):v!==undefined?new Response(v,{headers:{'content-type':'text/css'}}):new Response(new Blob([makeWoff2()]),{headers:{'content-type':'font/woff2'}});},console,Error,Promise,Uint8Array,Array,queueMicrotask,URL,setTimeout,clearTimeout});
const call2=msg=>new Promise(resolve=>listener2(msg,null,resolve));

const found=await call2({type:'find-fonts'});
assert.deepEqual(JSON.parse(JSON.stringify(found.fonts.map(f=>f.name))),['Space Grotesk','Plus Jakarta Sans','Newsreader']);
const sg=found.fonts[0];
assert.deepEqual(JSON.parse(JSON.stringify(sg.usedWeights)),[400,700]);
assert.equal(sg.variants.length,2);
assert.deepEqual(JSON.parse(JSON.stringify(sg.variants[0])),{file:'https://example.com/fonts/sg-400.woff2',ext:'woff2',weight:400,weightMin:400,weightMax:400,isVariable:false,style:'normal'});
assert.deepEqual(JSON.parse(JSON.stringify(sg.variants[1])),{file:'https://cdn.example.com/font?id=700i',ext:'woff2',weight:700,weightMin:700,weightMax:700,isVariable:false,style:'italic'});

const pjs=found.fonts[1];
assert.equal(pjs.variants[0].isVariable,true);
assert.equal(pjs.variants[0].weightMin,200);
assert.equal(pjs.variants[0].weightMax,800);
assert.equal(pjs.variants[0].weight,400);

const nr=found.fonts[2];
assert.equal(nr.variants.length,3);
assert.equal(nr.variants[0].file,'https://fonts.example.com/newsreader-400-lat.woff2');
assert.equal(nr.variants[0].subset,'latin');
assert.equal(nr.variants[1].file,'https://fonts.example.com/newsreader-400-cyr.woff2');
assert.equal(nr.variants[1].subset,'cyrillic');
assert.equal(nr.variants[2].weight,600);
assert.equal(nr.variants[2].subset,'latin');
assert.ok(fetchCalls2.every(c=>c.init?.credentials==='omit'));

assert.equal((await call2({
  type:'save-font',
  file:'https://cdn.example.com/font?id=700i',
  extension:'woff2',
  name:'Space Grotesk 700 Italic',
  family:'Space Grotesk',
  weight:700,
  weightMin:700,
  weightMax:700,
  isVariable:false,
  style:'italic',
  fontSource:'capture',
  title:'Example',
  url:'https://example.com/page'
})).ok,true);
assert.equal(messages2[0].type,'begin');
assert.equal(messages2[0].family,'Space Grotesk');
assert.equal(messages2[0].weight,700);
assert.equal(messages2[0].weightMin,700);
assert.equal(messages2[0].weightMax,700);
assert.equal(messages2[0].isVariable,false);
assert.equal(messages2[0].style,'italic');
assert.equal(messages2[0].fontSource,'capture');

// Regression: EOT mislabeling, multiline @import, CSS comments, font-stretch, non-Latin subsets, and invalid/unsafe saves
const edgeCss={
  'https://edge.example.com/entry.css':`
    /* multiline import with comments */
    @import /* lead */
      url(
        "https://edge.example.com/imported.css"
      );
  `,
  'https://edge.example.com/imported.css':`
    /* arabic */
    @font-face {
      font-family: /* comment */ 'Edge Sans';
      font-weight: /* min */ 300 /* max */ 700;
      font-stretch: condensed;
      font-style: normal;
      src: url('/edge-ar.eot?#iefix') format('embedded-opentype'),
           url('/edge-ar.woff2') format('woff2');
      unicode-range: U+0600-06FF;
    }
    @font-face {
      font-family: 'Edge EOT Only';
      font-weight: 400;
      src: url('/only.eot') format('embedded-opentype');
    }
  `,
};
const edgeScriptResult={
  computed:[{name:'Edge Sans',usedWeights:[400]}],
  inlineFaces:[
    {
      family:'"Edge Sans"',
      weight:'400',
      style:'normal',
      stretch:'normal',
      unicodeRange:'U+0000-00FF',
      base:'https://edge.example.com/page',
      src:'url("/edge-lat-normal.woff2") format("woff2")',
    },
    {
      family:'"Edge Sans"',
      weight:'400',
      style:'normal',
      stretch:'condensed',
      unicodeRange:'U+0000-00FF',
      base:'https://edge.example.com/page',
      src:'url("/edge-lat-condensed.woff2") format("woff2")',
    },
  ],
  external:['https://edge.example.com/entry.css'],
};

let listener3;const messages3=[];const fetchCalls3=[];
const handlers3={message:[],disconnect:[]};const event3=name=>({addListener:f=>handlers3[name].push(f),removeListener:f=>{handlers3[name]=handlers3[name].filter(x=>x!==f)}});
const port3={onMessage:event3('message'),onDisconnect:event3('disconnect'),postMessage(msg){messages3.push(msg);queueMicrotask(()=>handlers3.message.forEach(f=>f({ok:true})))},disconnect(){}};
const chrome3={scripting:{executeScript:async()=>[{result:edgeScriptResult}]},tabs:{query:async()=>[{id:8,windowId:1,title:'Edge',url:'https://edge.example.com/page'}]},storage:{local:{set:async()=>{}}},commands:{onCommand:{addListener:()=>{}}},runtime:{onMessage:{addListener:fn=>listener3=fn},connectNative:()=>port3,getURL:s=>s}};
const mockFetch3=async(u,init)=>{
  fetchCalls3.push({u,init});
  if(edgeCss[u]!==undefined)return new Response(edgeCss[u],{headers:{'content-type':'text/css'}});
  if(u==='https://edge.example.com/html-font.woff2')return new Response('<html>oops</html>',{headers:{'content-type':'text/html'}});
  if(u==='https://edge.example.com/eot-disguised.otf')return new Response(new Blob([makeEot()]),{headers:{'content-type':'application/octet-stream'}});
  if(u==='https://edge.example.com/truncated.woff2')return new Response(new Blob([new Uint8Array([0x77,0x4f,0x46,0x32,1,2,3])]));
  if(u==='https://edge.example.com/oversized.woff2')return new Response(new Blob([makeWoff2()]),{headers:{'content-length':String(40*1024*1024)}});
  if(u==='https://edge.example.com/timeout.woff2')return await new Promise(()=>{});
  return new Response(new Blob([makeWoff2('ok')]),{headers:{'content-type':'font/woff2'}});
};
vm.runInNewContext(fs.readFileSync(new URL('./extension/background.js',import.meta.url),'utf8'),{chrome:chrome3,crypto:webcrypto,fetch:mockFetch3,console,Error,Promise,Uint8Array,Array,queueMicrotask,URL,setTimeout,clearTimeout,AbortController,TextDecoder});
const call3=msg=>new Promise(resolve=>listener3(msg,null,resolve));

const edgeFound=await call3({type:'find-fonts'});
const unsupported=edgeFound.fonts.find(font=>font.name==='Edge EOT Only');
assert.equal(unsupported?.variants?.length ?? 0,0);
const edge=edgeFound.fonts.find(font=>font.name==='Edge Sans');
assert.equal(edge.name,'Edge Sans');
assert.equal(edge.variants.length,3);
// Normal stretch comes before condensed stretch, and both Arabic imported via multiline @import and Latin are kept
assert.deepEqual(edge.variants.map(v=>({file:v.file,ext:v.ext,stretch:v.stretch||'normal',subset:v.subset,weightMin:v.weightMin,weightMax:v.weightMax})),[
  {file:'https://edge.example.com/edge-lat-normal.woff2',ext:'woff2',stretch:'normal',subset:'latin',weightMin:400,weightMax:400},
  {file:'https://edge.example.com/edge-ar.woff2',ext:'woff2',stretch:'condensed',subset:'arabic',weightMin:300,weightMax:700},
  {file:'https://edge.example.com/edge-lat-condensed.woff2',ext:'woff2',stretch:'condensed',subset:'latin',weightMin:400,weightMax:400},
]);
assert.ok(fetchCalls3.every(c=>c.init?.credentials==='omit'));

// Metadata sanitization in save-font (fractional rounded, out-of-range ignored, invalid fontSource -> capture)
assert.equal((await call3({
  type:'save-font',
  file:'https://edge.example.com/edge-ar.woff2',
  extension:'woff2',
  name:'Edge Fractional',
  family:'Edge Sans',
  weight:450.6,
  weightMin:199.4,
  weightMax:800.2,
  fontSource:'https://bad.source',
  title:'Edge',
  url:'https://edge.example.com/page',
})).ok,true);
assert.equal(messages3[0].weight,451);
assert.equal(messages3[0].weightMin,199);
assert.equal(messages3[0].weightMax,800);
assert.equal(messages3[0].isVariable,true);
assert.equal(messages3[0].fontSource,'capture');

messages3.length=0;
assert.equal((await call3({
  type:'save-font',
  file:'https://edge.example.com/edge-lat-normal.woff2',
  extension:'woff2',
  name:'Edge Bad Weight',
  family:'Edge Sans',
  weight:0,
  weightMin:-5,
  weightMax:1500,
  title:'Edge',
  url:'https://edge.example.com/page',
})).ok,true);
assert.equal(messages3[0].weight,undefined);
assert.equal(messages3[0].weightMin,undefined);
assert.equal(messages3[0].weightMax,undefined);

// Reject unsafe URLs, HTML content-type, EOT magic bytes, truncated font, and oversized Content-Length
for(const badReq of [
  {type:'save-font',file:'file:///etc/passwd',extension:'woff2',name:'x',title:'t',url:'https://edge.example.com'},
  {type:'save-font',file:'https://user:pass@edge.example.com/a.woff2',extension:'woff2',name:'x',title:'t',url:'https://edge.example.com'},
  {type:'save-font',file:'https://edge.example.com/html-font.woff2',extension:'woff2',name:'x',title:'t',url:'https://edge.example.com'},
  {type:'save-font',file:'https://edge.example.com/eot-disguised.otf',extension:'otf',name:'x',title:'t',url:'https://edge.example.com'},
  {type:'save-font',file:'https://edge.example.com/truncated.woff2',extension:'woff2',name:'x',title:'t',url:'https://edge.example.com'},
  {type:'save-font',file:'https://edge.example.com/oversized.woff2',extension:'woff2',name:'x',title:'t',url:'https://edge.example.com'},
]){
  const res=await call3(badReq);
  assert.ok(res.error, `Expected error for ${badReq.file}`);
}

console.log('Native capture handoff, font CSS inspection, safety checks, and screenshot review passed.');
