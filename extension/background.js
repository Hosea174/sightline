async function saveCapture(url, extension, title, sourceUrl, name, tags=[], category="Web design", segments) {
  const response=await fetch(url);if(!response.ok)throw Error('Could not read the capture.');
  const blob=await response.blob(),port=chrome.runtime.connectNative('com.sightline.capture');
  let failure=null;port.onDisconnect.addListener(()=>{failure=chrome.runtime.lastError?.message||'Sightline bridge disconnected.'});
  const send=message=>new Promise((resolve,reject)=>{
    if(failure){reject(Error(failure));return}
    const onMessage=result=>{cleanup();result.error?reject(Error(result.error)):resolve(result)};
    const onDisconnect=()=>{cleanup();reject(Error(chrome.runtime.lastError?.message||'Sightline bridge disconnected. Open Sightline and check bridge installation.'))};
    const timeout=setTimeout(()=>{cleanup();reject(Error(message.type==='end'?'Rendering took too long. Your original recording is still available.':'Sightline bridge timed out. Open Sightline and check the library.'))},message.type==='end'?300000:30000);
    const cleanup=()=>{clearTimeout(timeout);port.onMessage.removeListener(onMessage);port.onDisconnect.removeListener(onDisconnect)};
    port.onMessage.addListener(onMessage);port.onDisconnect.addListener(onDisconnect);try{port.postMessage(message)}catch(e){cleanup();reject(e)}
  });
  try{
    const id=crypto.randomUUID();await send({type:'begin',id,extension,title, url:sourceUrl,name,tags,category,segments});
    for(let offset=0;offset<blob.size;offset+=32768){const bytes=new Uint8Array(await blob.slice(offset,offset+32768).arrayBuffer());await send({type:'chunk',data:Array.from(bytes)})}
    await send({type:'end'});
  }finally{port.disconnect()}
}
const capture = async () => {
  const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id)throw Error('No active tab');
  const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
  await chrome.storage.local.set({cropImage:image,cropTitle:tab.title||'',cropUrl:tab.url||'',cropFull:true});
  await chrome.tabs.create({url:chrome.runtime.getURL('crop.html')});
};

async function captureFullPage(){
 const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)throw Error('No active tab');
 const execute=async(func,args=[])=>{const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func,args});return result[0].result};
 const info=await execute(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,total:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)}));
 if(info.total>16000||info.width>8000)throw Error('This page is too large to capture as one image. Use an area capture instead.');
 let canvas,ctx,scale=1,lastBottom=0;
 try{
  await execute(()=>{window.__sightlineCaptureStyle=document.createElement('style');window.__sightlineCaptureStyle.textContent='html{scroll-behavior:auto!important}';document.documentElement.append(window.__sightlineCaptureStyle)});
  for(let requested=0;requested<info.total;requested+=info.height){
   const active=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(active?.id!==tab.id)throw Error('Capture stopped because the active tab changed.');
   const y=await execute(y=>{scrollTo(0,y);return scrollY},[requested]);
   await new Promise(resolve=>setTimeout(resolve,650));
   const stillActive=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(stillActive?.id!==tab.id)throw Error('Capture stopped because the active tab changed.');
   const data=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});const bitmap=await createImageBitmap(await (await fetch(data)).blob());
   if(!canvas){scale=bitmap.width/info.width;if(Math.ceil(info.total*scale)>32000||bitmap.width*Math.ceil(info.total*scale)>120000000)throw Error('This page is too large to capture at the current screen resolution.');canvas=new OffscreenCanvas(bitmap.width,Math.ceil(info.total*scale));ctx=canvas.getContext('2d')}
   const start=Math.max(lastBottom,y),bottom=Math.min(info.total,y+info.height);if(bottom>start){const sy=Math.round((start-y)*scale),dy=Math.round(start*scale),h=Math.min(bitmap.height-sy,Math.round((bottom-start)*scale));ctx.drawImage(bitmap,0,sy,bitmap.width,h,0,dy,bitmap.width,h);lastBottom=bottom}bitmap.close();
   if(requested===0 && info.total>info.height)await execute(()=>{window.__sightlineHidden=[...document.querySelectorAll('body *')].filter(el=>{const pos=getComputedStyle(el).position;const r=el.getBoundingClientRect();return (pos==='fixed'||pos==='sticky')&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0}).map(el=>{const value=el.style.getPropertyValue('visibility'),priority=el.style.getPropertyPriority('visibility');el.style.setProperty('visibility','hidden','important');return {el,value,priority}})});
   if(lastBottom>=info.total)break;
   if(y===0&&requested>0)throw Error('This page cannot be scrolled for capture.');
  }
  if(lastBottom<info.total-2)throw Error('The page changed during capture. Please try again.');
  const blob=await canvas.convertToBlob({type:'image/png'});const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
  await chrome.storage.local.set({cropImage:data,cropTitle:tab.title||'',cropUrl:tab.url||'',cropFull:true});
 }finally{await execute((x,y)=>{(window.__sightlineHidden||[]).forEach(({el,value,priority})=>value?el.style.setProperty('visibility',value,priority):el.style.removeProperty('visibility'));delete window.__sightlineHidden;window.__sightlineCaptureStyle?.remove();delete window.__sightlineCaptureStyle;scrollTo(x,y)},[info.x,info.y]).catch(()=>{})}
 await chrome.tabs.create({url:chrome.runtime.getURL('crop.html')});
}

async function inspectFonts() {
  const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id) throw new Error('No active tab');
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
    const families=new Map(), external=[];
    for(const el of Array.from(document.querySelectorAll('body *')).slice(0,4000)){
      if(!el.textContent?.trim())continue;
      for(const family of getComputedStyle(el).fontFamily.split(',')){
        const name=family.trim().replace(/^["']|["']$/g,'');
        if(name&&!families.has(name))families.set(name,{name,files:[]});
      }
    }
    const scan=(rules,base)=>{for(const rule of Array.from(rules)){
      if(rule.type===CSSRule.FONT_FACE_RULE){
        const name=rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g,'');
        const src=rule.style.getPropertyValue('src');const files=[];const regex=/url\(["']?([^"')]+)["']?\)/g;let match;
        while((match=regex.exec(src))){try{const url=new URL(match[1],base).href;if(/^https?:/.test(url))files.push(url)}catch{}}
        if(name){const item=families.get(name)||{name,files:[]};item.files=[...new Set([...item.files,...files])];families.set(name,item)}
      }else if(rule.cssRules){try{scan(rule.cssRules,base)}catch{}}
    }};
    for(const sheet of Array.from(document.styleSheets)){try{scan(sheet.cssRules,sheet.href||document.baseURI)}catch{if(sheet.href)external.push(sheet.href)}}
    return {fonts:Array.from(families.values()).filter(v=>!['serif','sans-serif','monospace','system-ui','inherit'].includes(v.name.toLowerCase())),external};
  }});
  const inspected=result[0]?.result||{fonts:[],external:[]};
  const fonts=inspected.fonts;
  for(const stylesheet of inspected.external.slice(0,20)){
    try{
      const response=await fetch(stylesheet);if(!response.ok)continue;
      const css=await response.text();
      for(const block of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)){
        const family=block[1].match(/font-family\s*:\s*([^;]+)/i)?.[1]?.trim().replace(/^["']|["']$/g,'');
        if(!family)continue;
        const item=fonts.find(f=>f.name.toLowerCase()===family.toLowerCase())||{name:family,files:[]};
        if(!fonts.includes(item))fonts.push(item);
        for(const file of block[1].matchAll(/url\(["']?([^"')]+)["']?\)/g)){const url=new URL(file[1],stylesheet).href;if(/^https?:/.test(url)&&!item.files.includes(url))item.files.push(url)}
      }
    }catch{}
  }
  return {fonts,title:tab.title||'',url:tab.url||''};
}
async function captureArea() {
  const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if (!tab?.id) throw new Error('No active tab');
  const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
  await chrome.storage.local.set({cropImage:image,cropTitle:tab.title||'',cropUrl:tab.url||'',cropFull:false});
  await chrome.tabs.create({url:chrome.runtime.getURL('crop.html')});
}

async function record(){const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)return;const existing=await chrome.offscreen.hasDocument();if(!existing)await chrome.offscreen.createDocument({url:'recorder.html',reasons:['USER_MEDIA'],justification:'Record the current browser tab'});const stream=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});const result=await chrome.runtime.sendMessage({type:'start',stream,title:tab.title,url:tab.url});if(result?.error)throw Error(result.error);}
chrome.commands.onCommand.addListener(async c=>{if(c==='capture-visible')await capture();if(c==='record-tab'){const exists=await chrome.offscreen.hasDocument();const state=exists?await chrome.runtime.sendMessage({type:'get-recorder-status'}):null;if(state?.recording)await chrome.runtime.sendMessage({type:'stop-recording'});else await record()}if(c==='capture-area')await captureArea()});
chrome.runtime.onMessage.addListener((msg,_sender,send)=>{if(msg.type==='library-tags'){const port=chrome.runtime.connectNative('com.sightline.capture');port.onMessage.addListener(result=>{send(result);port.disconnect()});port.onDisconnect.addListener(()=>{if(chrome.runtime.lastError)send({error:chrome.runtime.lastError.message})});port.postMessage({type:'tags',url:msg.url||''});return true}if(msg.type==='recording-status'){chrome.offscreen.hasDocument().then(exists=>exists?chrome.runtime.sendMessage({type:'get-recorder-status'}):{recording:false}).then(send).catch(()=>send({recording:false}));return true}if(msg.type==='recording-ready'){chrome.tabs.create({url:chrome.runtime.getURL(`review.html?id=${encodeURIComponent(msg.id)}`)}).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='find-fonts'){inspectFonts().then(value=>send(value)).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-font'){const extension=msg.extension;if(!['woff','woff2','ttf','otf'].includes(extension)){send({error:'Unsupported font format'});return}saveCapture(msg.file,extension,msg.title,msg.url,msg.name).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-area'){saveCapture(msg.data,'png',msg.title,msg.url,'',msg.tags,msg.category).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='area'){captureArea().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-clip'){saveCapture(msg.data,'webm',msg.title,msg.url,'',msg.tags,msg.category,msg.segments).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='full-page'){captureFullPage().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='screenshot'){capture().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='record'){record().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='stop'){chrome.runtime.sendMessage({type:'stop-recording'}).then(result=>send(result)).catch(e=>send({error:String(e)}));return true}});
