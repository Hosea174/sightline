async function saveCapture(url, extension, title, sourceUrl, name, tags=[], category="Web design", segments, crop, notes="", annotations=[]) {
  let blob=url;if(typeof url==='string'){const response=await fetch(url);if(!response.ok)throw Error('Could not read the capture.');blob=await response.blob()}
  const port=chrome.runtime.connectNative('com.sightline.capture');
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
    const id=crypto.randomUUID();await send({type:'begin',id,extension,title, url:sourceUrl,name,tags,category,segments,crop,notes,annotations});
    for(let offset=0;offset<blob.size;offset+=32768){const bytes=new Uint8Array(await blob.slice(offset,offset+32768).arrayBuffer());await send({type:'chunk',data:Array.from(bytes)})}
    await send({type:'end'});
  }finally{port.disconnect()}
}
const imageTypes={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/bmp':'bmp','image/avif':'avif','image/x-icon':'ico','image/vnd.microsoft.icon':'ico'};
async function notifyImageResult(tabId,message,failed=false){
 await chrome.action.setBadgeBackgroundColor({color:failed?'#b44940':'#f26628'}).catch(()=>{});await chrome.action.setBadgeText({text:failed?'!':'OK'}).catch(()=>{});await chrome.action.setTitle({title:`Sightline: ${message}`}).catch(()=>{});
 if(tabId)await chrome.scripting.executeScript({target:{tabId},func:(message,failed)=>{const el=document.createElement('div');el.textContent=`Sightline: ${message}`;el.style.cssText=`all:initial;position:fixed;z-index:2147483647;right:20px;top:20px;max-width:360px;padding:14px 18px;border-radius:8px;background:${failed?'#562d2b':'#29292c'};color:#fff;font:13px system-ui;box-shadow:0 8px 30px #0009`;document.documentElement.append(el);setTimeout(()=>el.remove(),5000)},args:[message,failed]}).catch(()=>{});
 setTimeout(()=>{chrome.action.setBadgeText({text:''}).catch(()=>{});chrome.action.setTitle({title:'Sightline Capture'}).catch(()=>{})},6000);
}
const makeCropId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function saveContextImage(info,tab){
 if(!info.srcUrl)throw Error('This image has no accessible source.');
 let imageUrl=info.srcUrl;
 if(imageUrl.startsWith('blob:')){if(!tab?.id)throw Error('Cannot access this image.');const result=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[info.frameId||0]},func:async url=>{const response=await fetch(url);if(!response.ok)throw Error('Could not read image');const blob=await response.blob();if(blob.size>134217728)throw Error('Image is too large');return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})},args:[imageUrl]});imageUrl=result[0]?.result;if(!imageUrl)throw Error('Could not read this image.');}
 const response=await fetch(imageUrl);if(!response.ok)throw Error('Could not download this image.');const blob=await response.blob();if(!blob.size||blob.size>134217728)throw Error('Image is empty or too large.');
 const type=(blob.type||'').split(';')[0].toLowerCase();let extension=imageTypes[type];if(!extension){try{const ext=new URL(info.srcUrl).pathname.split('.').pop().toLowerCase();if(['png','jpg','jpeg','webp','gif','svg','bmp','avif','ico'].includes(ext)&&(!type||type==='application/octet-stream'))extension=ext}catch{}}
 if(!extension)throw Error('This image format is not supported.');
 const pageUrl='';
 let name='Saved image';try{const filename=decodeURIComponent(new URL(info.srcUrl).pathname.split('/').pop()||'');if(filename)name=filename.slice(0,180)}catch{}
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
 await chrome.storage.local.set({cropId:makeCropId(),cropImage:data,cropTitle:tab?.title||'Saved image',cropUrl:pageUrl,cropFull:true,cropExtension:extension,cropName:name});
 await chrome.tabs.create({url:chrome.runtime.getURL('crop.html')});
}
if(chrome.contextMenus){chrome.runtime.onInstalled.addListener(()=>{chrome.contextMenus.create({id:'sightline-save-image',title:'Save image to Sightline',contexts:['image']})});chrome.contextMenus.onClicked.addListener((info,tab)=>{if(info.menuItemId!=='sightline-save-image')return;void saveContextImage(info,tab).catch(error=>notifyImageResult(tab?.id,error.message||String(error),true))})}
const capture = async () => {
  const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id)throw Error('No active tab');
  const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
  await chrome.storage.local.set({cropId:makeCropId(),cropImage:image,cropTitle:tab.title||'',cropUrl:tab.url||'',cropFull:true,cropExtension:'png',cropName:''});
  await chrome.tabs.create({url:chrome.runtime.getURL('crop.html')});
};

async function captureFullPage(tabOverride=null,region=null){
 const tab=tabOverride||(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)throw Error('No active tab');
 const execute=async(func,args=[])=>{const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func,args});return result[0].result};
 const info=await execute(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,total:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)}));
 const box=region||{left:info.x,top:0,width:info.width,height:info.total};
 if(box.width<2||box.height<2||box.width>info.width||box.left<info.x||box.left+box.width>info.x+info.width+1||box.height>16000||box.width>8000)throw Error('The selected area is too large or extends beyond the visible page width.');
 const endY=Math.min(info.total,box.top+box.height);let canvas,ctx,scale=1,lastBottom=box.top,hidden=false;
 try{
  await execute(()=>{window.__sightlineCaptureStyle=document.createElement('style');window.__sightlineCaptureStyle.textContent='html{scroll-behavior:auto!important}';document.documentElement.append(window.__sightlineCaptureStyle)});
  for(let requested=region&&box.top>=info.y&&box.top<info.y+info.height?info.y:box.top;requested<endY;requested+=info.height){
   const active=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(active?.id!==tab.id)throw Error('Capture stopped because the active tab changed.');
   const y=await execute((y,x)=>{scrollTo(x,y);return scrollY},[requested,info.x]);
   await new Promise(resolve=>setTimeout(resolve,650));
   const stillActive=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(stillActive?.id!==tab.id)throw Error('Capture stopped because the active tab changed.');
   const data=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});const bitmap=await createImageBitmap(await (await fetch(data)).blob());
   if(!canvas){scale=bitmap.width/info.width;const w=Math.round(box.width*scale),h=Math.ceil(box.height*scale);if(h>32000||w*h>120000000)throw Error('This selection is too large to capture at the current screen resolution.');canvas=new OffscreenCanvas(w,h);ctx=canvas.getContext('2d')}
   const start=Math.max(lastBottom,y),bottom=Math.min(endY,y+info.height);if(bottom>start){const sx=Math.max(0,Math.round((box.left-info.x)*scale)),sy=Math.max(0,Math.round((start-y)*scale)),dy=Math.round((start-box.top)*scale),w=Math.min(bitmap.width-sx,canvas.width),h=Math.min(bitmap.height-sy,Math.round((bottom-start)*scale));if(w>0&&h>0)ctx.drawImage(bitmap,sx,sy,w,h,0,dy,w,h);lastBottom=bottom}bitmap.close();
   if(!hidden && lastBottom<endY){hidden=true;await execute(()=>{window.__sightlineHidden=[...document.querySelectorAll('body *')].filter(el=>{const pos=getComputedStyle(el).position;const r=el.getBoundingClientRect();return (pos==='fixed'||pos==='sticky')&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0}).map(el=>{const value=el.style.getPropertyValue('visibility'),priority=el.style.getPropertyPriority('visibility');el.style.setProperty('visibility','hidden','important');return {el,value,priority}})});}
   if(lastBottom>=endY)break;
   if(y===0&&requested>box.top)throw Error('This page cannot be scrolled for capture.');
  }
  if(lastBottom<endY-2)throw Error('The page changed during capture. Please try again.');
  const blob=await canvas.convertToBlob({type:'image/png'});const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
  await chrome.storage.local.set({cropId:makeCropId(),cropImage:data,cropTitle:tab.title||'',cropUrl:tab.url||'',cropFull:true,cropExtension:'png',cropName:''});
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
 const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)throw Error('No active tab');
 const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>new Promise(resolve=>{
  if(document.getElementById('__sightline_selector')){resolve(null);return}
  const host=document.createElement('div');host.id='__sightline_selector';host.style.cssText='all:initial;display:block;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;';
  const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML=`<style>:host{all:initial}.box{position:fixed;border:2px solid #f26628;box-sizing:border-box;background:#f2662810;box-shadow:0 0 0 9999px #0007;pointer-events:none;display:none}.hint{position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:7px;background:#242426;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 4px 20px #0008;pointer-events:none}</style><div class="box"></div><div class="hint">Drag to select. Hold near an edge to scroll. Esc to cancel.</div>`;
  const box=shadow.querySelector('.box');document.documentElement.append(host);let origin=null,point=null,frame=0;
  const update=()=>{if(!origin||!point)return;const x=point.x+scrollX,y=point.y+scrollY,left=Math.min(origin.x,x),top=Math.min(origin.y,y),right=Math.max(origin.x,x),bottom=Math.max(origin.y,y);box.style.display='block';box.style.left=(left-scrollX)+'px';box.style.top=(top-scrollY)+'px';box.style.width=(right-left)+'px';box.style.height=(bottom-top)+'px'};
  const tick=()=>{if(!origin||!point)return;const speed=point.y<=0?-14:point.y>=innerHeight-1?14:0;if(speed){window.scrollBy(0,speed);update()}frame=requestAnimationFrame(tick)};
  const cleanup=value=>{cancelAnimationFrame(frame);window.removeEventListener('keydown',onKey,true);window.removeEventListener('scroll',update,true);host.remove();resolve(value)};
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cleanup(null)}};window.addEventListener('keydown',onKey,true);window.addEventListener('scroll',update,true);
  host.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();origin={x:e.clientX+scrollX,y:e.clientY+scrollY};point={x:e.clientX,y:e.clientY};host.setPointerCapture(e.pointerId);update();frame=requestAnimationFrame(tick)});
  host.addEventListener('pointermove',e=>{if(!origin)return;e.preventDefault();point={x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))};update()});
  host.addEventListener('pointerup',e=>{if(!origin)return;e.preventDefault();e.stopPropagation();const x=point.x+scrollX,y=point.y+scrollY;const selection={left:Math.min(origin.x,x),top:Math.min(origin.y,y),width:Math.abs(x-origin.x),height:Math.abs(y-origin.y)};cleanup(selection.width>=2&&selection.height>=2?selection:null)});
  host.addEventListener('pointercancel',()=>cleanup(null));
 })});
 const region=result[0]?.result;if(!region)return;
 try{await captureFullPage(tab,region)}catch(error){await chrome.scripting.executeScript({target:{tabId:tab.id},func:message=>{const notice=document.createElement('div');notice.textContent=`Sightline: ${message}`;notice.style.cssText='all:initial;position:fixed;z-index:2147483647;right:20px;top:20px;max-width:360px;padding:14px 18px;border-radius:8px;background:#29292c;color:#fff;font:13px system-ui;box-shadow:0 8px 30px #0009';document.documentElement.append(notice);setTimeout(()=>notice.remove(),7000)},args:[error.message||String(error)]}).catch(()=>{});throw error}

}

async function record(){const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)return;const existing=await chrome.offscreen.hasDocument();if(!existing)await chrome.offscreen.createDocument({url:'recorder.html',reasons:['USER_MEDIA'],justification:'Record the current browser tab'});const stream=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});const result=await chrome.runtime.sendMessage({type:'start',stream,title:tab.title,url:tab.url});if(result?.error)throw Error(result.error);}
chrome.commands.onCommand.addListener(async c=>{try{if(c==='capture-visible')await capture();if(c==='record-tab'){const exists=await chrome.offscreen.hasDocument();const state=exists?await chrome.runtime.sendMessage({type:'get-recorder-status'}):null;if(state?.recording)await chrome.runtime.sendMessage({type:'stop-recording'});else await record()}if(c==='capture-area')await captureArea()}catch(e){const [tab]=await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[]);await notifyImageResult(tab?.id,e?.message||String(e),true)}});
chrome.runtime.onMessage.addListener((msg,_sender,send)=>{if(msg.type==='library-tags'){const port=chrome.runtime.connectNative('com.sightline.capture');port.onMessage.addListener(result=>{send(result);port.disconnect()});port.onDisconnect.addListener(()=>{if(chrome.runtime.lastError)send({error:chrome.runtime.lastError.message})});port.postMessage({type:'tags',url:msg.url||''});return true}if(msg.type==='recording-status'){chrome.offscreen.hasDocument().then(exists=>exists?chrome.runtime.sendMessage({type:'get-recorder-status'}):{recording:false}).then(send).catch(()=>send({recording:false}));return true}if(msg.type==='recording-ready'){chrome.tabs.create({url:chrome.runtime.getURL(`review.html?id=${encodeURIComponent(msg.id)}`)}).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='find-fonts'){inspectFonts().then(value=>send(value)).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-font'){const extension=msg.extension;if(!['woff','woff2','ttf','otf'].includes(extension)){send({error:'Unsupported font format'});return}saveCapture(msg.file,extension,msg.title,msg.url,msg.name).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-area'){saveCapture(msg.data,msg.extension||'png',msg.title,msg.url,msg.name||'',msg.tags,msg.category,undefined,undefined,msg.notes,msg.annotations).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='area'){captureArea().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-clip'){saveCapture(msg.data,'webm',msg.title,msg.url,'',msg.tags,msg.category,msg.segments,msg.crop,msg.notes,msg.annotations).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='full-page'){captureFullPage().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='screenshot'){capture().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='record'){record().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='stop'){chrome.runtime.sendMessage({type:'stop-recording'}).then(result=>send(result)).catch(e=>send({error:String(e)}));return true}});
