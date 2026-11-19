const FONT_CAPTURE_MAX_BYTES = 32 * 1024 * 1024;
const GENERAL_CAPTURE_MAX_BYTES = 256 * 1024 * 1024;
const IMAGE_CAPTURE_MAX_BYTES = 134217728;
const CSS_FETCH_MAX_BYTES = 2 * 1024 * 1024;

function isAllowedFetchUrl(rawUrl, allowedProtocols) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (!allowedProtocols.includes(parsed.protocol)) return null;
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.username || parsed.password)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function readResponseBytesWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw Error('Downloaded file exceeds the allowed size limit.');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.byteLength) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw Error('Downloaded file exceeds the allowed size limit.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw Error('Downloaded file exceeds the allowed size limit.');
  }
  return new Uint8Array(buffer);
}

async function fetchWithLimits(rawUrl, { maxBytes, timeoutMs = 15000, allowedProtocols = ['https:', 'http:'], rejectContentTypes = [] } = {}) {
  const parsed = isAllowedFetchUrl(rawUrl, allowedProtocols);
  if (!parsed) throw Error('Unsupported or unsafe URL.');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(Error('Request timed out.'));
    }, timeoutMs);
  });
  try {
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const init = isHttp
      ? { credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) }
      : controller
        ? { signal: controller.signal }
        : undefined;
    const response = await Promise.race([fetch(parsed.href, init), timeoutPromise]);
    if (!response.ok) throw Error(`Request failed (${response.status || 'network error'}).`);
    const contentType = (response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && rejectContentTypes.some((prefix) => contentType === prefix || contentType.startsWith(prefix))) {
      throw Error(`Unexpected content type (${contentType}).`);
    }
    const bytes = await Promise.race([readResponseBytesWithLimit(response, maxBytes), timeoutPromise]);
    return { bytes, contentType };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function isEotHeader(bytes) {
  if (!bytes || bytes.byteLength < 36) return false;
  if (bytes[34] !== 0x4c || bytes[35] !== 0x50) return false;
  const v0 = bytes[8], v1 = bytes[9], v2 = bytes[10], v3 = bytes[11];
  return (
    (v0 === 0x00 && v1 === 0x00 && v2 === 0x01 && v3 === 0x00) ||
    (v0 === 0x01 && v1 === 0x00 && v2 === 0x02 && v3 === 0x00) ||
    (v0 === 0x02 && v1 === 0x00 && v2 === 0x02 && v3 === 0x00)
  );
}

function sniffFontExtension(bytes) {
  if (!bytes || bytes.byteLength < 12) return null;
  if (isEotHeader(bytes)) return null;
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  // wOF2
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x32) {
    return bytes.byteLength >= 48 ? 'woff2' : null;
  }
  // wOFF
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x46) {
    return bytes.byteLength >= 44 ? 'woff' : null;
  }
  // ttcf (TrueType collection)
  if (b0 === 0x74 && b1 === 0x74 && b2 === 0x63 && b3 === 0x66) {
    return bytes.byteLength >= 12 ? 'ttf' : null;
  }
  const hasValidSfntDirectory = () => {
    const numTables = (bytes[4] << 8) | bytes[5];
    return numTables >= 1 && numTables <= 512 && 12 + numTables * 16 <= bytes.byteLength;
  };
  // OTTO (OpenType CFF)
  if (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f) {
    return hasValidSfntDirectory() ? 'otf' : null;
  }
  // 0x00010000, 'true', 'typ1' (TrueType / SFNT)
  if (
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) ||
    (b0 === 0x74 && b1 === 0x79 && b2 === 0x70 && b3 === 0x31)
  ) {
    return hasValidSfntDirectory() ? 'ttf' : null;
  }
  return null;
}

async function saveCapture(url, extension, title, sourceUrl, name, tags=[], category="Web design", segments, crop, notes="", annotations=[], extra={}) {
  const isFontCapture = extra?.fontSource !== undefined || ['woff', 'woff2', 'ttf', 'otf'].includes(extension);
  let resolvedExt = extension;
  let payloadBytes = null;
  let blob = url;
  if (typeof url === 'string') {
    const { bytes } = await fetchWithLimits(url, {
      maxBytes: isFontCapture ? FONT_CAPTURE_MAX_BYTES : GENERAL_CAPTURE_MAX_BYTES,
      timeoutMs: isFontCapture ? 20000 : 30000,
      allowedProtocols: ['https:', 'http:', 'data:', 'blob:'],
      rejectContentTypes: isFontCapture
        ? ['text/html', 'application/xhtml+xml', 'application/json', 'text/xml', 'application/xml', 'image/svg+xml']
        : [],
    });
    payloadBytes = bytes;
  } else if (blob && typeof blob.arrayBuffer === 'function') {
    if (blob.size > (isFontCapture ? FONT_CAPTURE_MAX_BYTES : GENERAL_CAPTURE_MAX_BYTES)) {
      throw Error('Capture exceeds the allowed size limit.');
    }
    payloadBytes = new Uint8Array(await blob.arrayBuffer());
  }
  if (!payloadBytes || payloadBytes.byteLength === 0) {
    throw Error('Could not read the capture.');
  }
  if (isFontCapture) {
    const sniffed = sniffFontExtension(payloadBytes);
    if (!sniffed) {
      throw Error('Downloaded file is not a valid WOFF2, WOFF, TTF, or OTF font.');
    }
    if (sniffed === 'woff2' || sniffed === 'woff' || sniffed === 'otf') {
      resolvedExt = sniffed;
    } else if (resolvedExt !== 'otf' && resolvedExt !== 'ttf') {
      resolvedExt = 'ttf';
    }
  }
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
    const id=crypto.randomUUID();
    const begin={type:'begin',id,extension:resolvedExt,title,url:sourceUrl,name,tags,category,segments,crop,notes,annotations};
    if(extra&&typeof extra==='object'){
      for(const key of ['family','weight','weightMin','weightMax','isVariable','style','fontSource']){
        if(extra[key]!==undefined)begin[key]=extra[key];
      }
    }
    await send(begin);
    for(let offset=0;offset<payloadBytes.byteLength;offset+=32768){const bytes=payloadBytes.subarray(offset,offset+32768);await send({type:'chunk',data:Array.from(bytes)})}
    await send({type:'end'});
    return id;
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
 const { bytes, contentType: type } = await fetchWithLimits(imageUrl, {
   maxBytes: IMAGE_CAPTURE_MAX_BYTES,
   timeoutMs: 20000,
   allowedProtocols: ['https:', 'http:', 'data:'],
 });
 if (!bytes.byteLength) throw Error('Image is empty or too large.');
 const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
 let extension=imageTypes[type];if(!extension){try{const ext=new URL(info.srcUrl).pathname.split('.').pop().toLowerCase();if(['png','jpg','jpeg','webp','gif','svg','bmp','avif','ico'].includes(ext)&&(!type||type==='application/octet-stream'))extension=ext}catch{}}
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

const SUPPORTED_FONT_EXTENSIONS = ['woff2', 'woff', 'otf', 'ttf'];
const FONT_FORMAT_RANK = { woff2: 4, woff: 3, otf: 2, ttf: 1 };
const GENERIC_FONT_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math',
  'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
  '-apple-system', 'blinkmacsystemfont',
]);

function cleanFontFamilyName(raw) {
  return String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

function isGenericFontFamily(name) {
  const key = cleanFontFamilyName(name).toLowerCase();
  return !key || GENERIC_FONT_FAMILIES.has(key);
}

function parseSingleCssWeight(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'normal') return 400;
  if (t === 'bold') return 700;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || n > 1000) return null;
  return Math.round(n);
}

function normalizeFontWeightNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 1 || value > 1000) return null;
  return Math.round(value);
}

function parseCssFontWeight(raw, filenameFallback = '') {
  const cleaned = String(raw || '').trim();
  if (cleaned) {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length === 2) {
      const a = parseSingleCssWeight(tokens[0]);
      const b = parseSingleCssWeight(tokens[1]);
      if (a !== null && b !== null) {
        const weightMin = Math.min(a, b);
        const weightMax = Math.max(a, b);
        const isVariable = weightMax > weightMin;
        const weight = isVariable ? (weightMin <= 400 && weightMax >= 400 ? 400 : weightMin) : weightMin;
        return { weight, weightMin, weightMax, isVariable, explicit: true };
      }
    }
    if (tokens.length === 1) {
      const w = parseSingleCssWeight(tokens[0]);
      if (w !== null) {
        return { weight: w, weightMin: w, weightMax: w, isVariable: false, explicit: true };
      }
    }
  }
  const hinted = inferWeightFromFilename(filenameFallback);
  const weight = hinted || 400;
  return { weight, weightMin: weight, weightMax: weight, isVariable: false, explicit: false };
}

function inferWeightFromFilename(fileUrl) {
  const raw = String(fileUrl || '');
  const base = raw.split('?')[0].split('#')[0].split('/').pop() || '';
  const lower = base.toLowerCase();
  const numMatch = lower.match(/(?:^|[-_.\s])([1-9]00|950)(?:[-_.\s]|$|i(?:talic)?)/i);
  if (numMatch) return Number(numMatch[1]);
  const table = [
    ['extrablack', 950], ['ultrablack', 950], ['heavy', 900], ['black', 900],
    ['extrabold', 800], ['ultrabold', 800], ['semibold', 600], ['demibold', 600],
    ['bold', 700], ['medium', 500], ['regular', 400], ['book', 400],
    ['semilight', 350], ['extralight', 200], ['ultralight', 200], ['light', 300],
    ['hairline', 100], ['thin', 100],
  ];
  for (const [token, w] of table) {
    if (new RegExp(`(?:^|[-_.])${token}(?:italic|oblique)?(?:[-_.]|$)`, 'i').test(lower)) return w;
  }
  return null;
}

function normalizeCssFontStyle(raw, filenameFallback = '') {
  const s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('italic') || s.startsWith('oblique')) return 'italic';
  if (!s && filenameFallback) {
    const base = String(filenameFallback).split('?')[0].split('/').pop() || '';
    if (/(?:^|[-_.])(italic|oblique)(?:[-_.]|$)/i.test(base)) return 'italic';
  }
  return 'normal';
}

const FONT_STRETCH_KEYWORDS = {
  'ultra-condensed': 50,
  'extra-condensed': 62.5,
  'condensed': 75,
  'semi-condensed': 87.5,
  'normal': 100,
  'semi-expanded': 112.5,
  'expanded': 125,
  'extra-expanded': 150,
  'ultra-expanded': 200,
};

function parseSingleCssStretch(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(FONT_STRETCH_KEYWORDS, t)) {
    return { pct: FONT_STRETCH_KEYWORDS[t], label: t };
  }
  if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(t)) {
    const pct = Number(t.slice(0, -1));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return null;
    const rounded = Math.round(pct * 100) / 100;
    return { pct: rounded, label: rounded === 100 ? 'normal' : `${rounded}%` };
  }
  return null;
}

function parseCssFontStretch(raw) {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return { stretch: 'normal', stretchKey: '100%', stretchPct: 100, isStretchRange: false };
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const single = parseSingleCssStretch(tokens[0]);
    if (single) {
      return {
        stretch: single.pct === 100 ? 'normal' : single.label,
        stretchKey: `${single.pct}%`,
        stretchPct: single.pct,
        isStretchRange: false,
      };
    }
  } else if (tokens.length === 2) {
    const a = parseSingleCssStretch(tokens[0]);
    const b = parseSingleCssStretch(tokens[1]);
    if (a && b) {
      const lo = Math.min(a.pct, b.pct);
      const hi = Math.max(a.pct, b.pct);
      if (lo === hi) {
        return {
          stretch: lo === 100 ? 'normal' : `${lo}%`,
          stretchKey: `${lo}%`,
          stretchPct: lo,
          isStretchRange: false,
        };
      }
      return {
        stretch: `${lo}% ${hi}%`,
        stretchKey: `${lo}%-${hi}%`,
        stretchPct: lo <= 100 && hi >= 100 ? 100 : lo,
        isStretchRange: true,
      };
    }
  }
  return { stretch: 'normal', stretchKey: '100%', stretchPct: 100, isStretchRange: false };
}

function inferFontExtFromUrlAndFormat(url, format) {
  const fmt = String(format || '').toLowerCase().replace(/["']/g, '').trim();
  const isVariableFormat = fmt.includes('variations') || fmt.includes('variable');
  if (fmt.includes('embedded-opentype') || /\beot\b/.test(fmt)) return null;

  const raw = String(url || '');
  let urlExt = '';
  if (!raw.startsWith('data:')) {
    try {
      const pathname = new URL(raw).pathname;
      urlExt = (pathname.split('.').pop() || '').toLowerCase();
    } catch {}
  }
  if (urlExt === 'eot') return null;

  if (fmt.includes('woff2')) return { ext: 'woff2', isVariableFormat };
  if (fmt.includes('woff')) return { ext: 'woff', isVariableFormat };
  if (fmt === 'otf' || fmt.includes('opentype')) return { ext: 'otf', isVariableFormat };
  if (fmt === 'ttf' || fmt.includes('truetype')) return { ext: 'ttf', isVariableFormat };

  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    const mime = raw.slice(5, comma > 0 ? comma : 80).toLowerCase();
    if (mime.includes('embedded-opentype') || mime.includes('fontobject') || /\beot\b/.test(mime)) return null;
    if (mime.includes('woff2')) return { ext: 'woff2', isVariableFormat };
    if (mime.includes('woff')) return { ext: 'woff', isVariableFormat };
    if (mime.includes('opentype') || mime.includes('otf')) return { ext: 'otf', isVariableFormat };
    if (mime.includes('truetype') || mime.includes('ttf')) return { ext: 'ttf', isVariableFormat };
    return null;
  }
  if (SUPPORTED_FONT_EXTENSIONS.includes(urlExt)) return { ext: urlExt, isVariableFormat };
  return null;
}

function stripCssComments(input) {
  const text = String(input || '');
  let out = '';
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      out += ' ';
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function splitCssListOutsideParensAndQuotes(input, delimiter = ',') {
  const parts = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { if (depth > 0) depth--; continue; }
    if (ch === delimiter && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function parseFontFaceSrc(rawSrc, baseUrl) {
  const candidates = [];
  const cleanSrc = stripCssComments(rawSrc);
  for (const part of splitCssListOutsideParensAndQuotes(cleanSrc, ',')) {
    const trimmed = part.trim();
    if (!trimmed || /^local\s*\(/i.test(trimmed)) continue;
    const urlMatch = trimmed.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/i);
    if (!urlMatch) continue;
    const rawUrl = (urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? '').trim();
    if (!rawUrl) continue;
    let resolvedUrl = '';
    try { resolvedUrl = new URL(rawUrl, baseUrl || 'https://example.invalid/').href; } catch { continue; }
    if (!/^https?:|^data:/i.test(resolvedUrl)) continue;
    const formatMatch = trimmed.match(/format\(\s*([^)]+)\)/i);
    const techMatch = trimmed.match(/tech\(\s*([^)]+)\)/i);
    const formatHint = `${formatMatch ? formatMatch[1] : ''} ${techMatch ? techMatch[1] : ''}`.trim();
    const detected = inferFontExtFromUrlAndFormat(resolvedUrl, formatHint);
    if (!detected) continue;
    const rank = (FONT_FORMAT_RANK[detected.ext] || 0) * 10 + (resolvedUrl.startsWith('http') ? 1 : 0);
    candidates.push({ file: resolvedUrl, ext: detected.ext, rank, isVariableFormat: detected.isVariableFormat });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0] || null;
}

function parseUnicodeRangeIntervals(unicodeRange) {
  const raw = String(unicodeRange || '').trim();
  if (!raw) return [];
  const intervals = [];
  for (const token of raw.split(',')) {
    const m = token.trim().match(/^u\+([0-9a-f?]+)(?:-([0-9a-f?]+))?$/i);
    if (!m) continue;
    let startHex, endHex;
    if (m[2]) {
      startHex = m[1].replace(/\?/g, '0');
      endHex = m[2].replace(/\?/g, 'f');
    } else if (m[1].includes('?')) {
      startHex = m[1].replace(/\?/g, '0');
      endHex = m[1].replace(/\?/g, 'f');
    } else {
      startHex = m[1];
      endHex = m[1];
    }
    const start = parseInt(startHex, 16);
    const end = parseInt(endHex, 16);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    intervals.push([Math.min(start, end), Math.max(start, end)]);
  }
  return intervals;
}

function unicodeRangeCoversBasicLatin(unicodeRange) {
  const intervals = parseUnicodeRangeIntervals(unicodeRange);
  if (!intervals.length) return 3;
  let best = 0;
  for (const [lo, hi] of intervals) {
    if (lo <= 0x007a && hi >= 0x0041) return 2;
    if ((lo <= 0x007e && hi >= 0x0020) || (lo <= 0x024f && hi >= 0x0100)) best = Math.max(best, 1);
  }
  return best;
}

const KNOWN_SUBSET_RE = /^(latin|latin-ext|cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|arabic|hebrew|devanagari|bengali|gurmukhi|gujarati|oriya|tamil|telugu|kannada|malayalam|sinhala|thai|lao|tibetan|myanmar|georgian|armenian|ethiopic|khmer|cherokee|syriac|japanese|korean|chinese|chinese-simplified|chinese-traditional|simplified-chinese|traditional-chinese|cjk|math|symbols|emoji)$/;

function parseSubsetComment(comment) {
  const raw = String(comment || '').trim().toLowerCase();
  if (!raw || raw.length > 32) return { subset: '', slice: '' };
  const sliceMatch = raw.match(/^\[(\d+)\]$/);
  if (sliceMatch) return { subset: '', slice: sliceMatch[1] };
  const cleaned = raw.replace(/\s+/g, '-');
  if (KNOWN_SUBSET_RE.test(cleaned)) {
    return { subset: cleaned, slice: '' };
  }
  return { subset: '', slice: '' };
}

function normalizeSubsetHint(comment) {
  return parseSubsetComment(comment).subset;
}

const UNICODE_SCRIPT_TABLE = [
  ['vietnamese', [[0x1ea0, 0x1ef9], [0x01a0, 0x01b0], [0x0102, 0x0103], [0x0110, 0x0111], [0x0128, 0x0129], [0x0168, 0x0169]]],
  ['cyrillic', [[0x0400, 0x052f], [0x2de0, 0x2dff], [0xa640, 0xa69f]]],
  ['greek', [[0x0370, 0x03ff], [0x1f00, 0x1fff]]],
  ['armenian', [[0x0530, 0x058f]]],
  ['hebrew', [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]]],
  ['arabic', [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]]],
  ['devanagari', [[0x0900, 0x097f]]],
  ['bengali', [[0x0980, 0x09ff]]],
  ['gurmukhi', [[0x0a00, 0x0a7f]]],
  ['gujarati', [[0x0a80, 0x0aff]]],
  ['oriya', [[0x0b00, 0x0b7f]]],
  ['tamil', [[0x0b80, 0x0bff]]],
  ['telugu', [[0x0c00, 0x0c7f]]],
  ['kannada', [[0x0c80, 0x0cff]]],
  ['malayalam', [[0x0d00, 0x0d7f]]],
  ['sinhala', [[0x0d80, 0x0dff]]],
  ['thai', [[0x0e00, 0x0e7f]]],
  ['lao', [[0x0e80, 0x0eff]]],
  ['tibetan', [[0x0f00, 0x0fff]]],
  ['myanmar', [[0x1000, 0x109f]]],
  ['georgian', [[0x10a0, 0x10ff], [0x1c90, 0x1cbf]]],
  ['ethiopic', [[0x1200, 0x137f]]],
  ['khmer', [[0x1780, 0x17ff]]],
  ['korean', [[0xac00, 0xd7af], [0x1100, 0x11ff], [0x3130, 0x318f]]],
  ['japanese', [[0x3040, 0x30ff], [0x31f0, 0x31ff]]],
  ['chinese', [[0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df]]],
  ['latin-ext', [[0x0100, 0x024f], [0x1e00, 0x1eff]]],
  ['math', [[0x2200, 0x22ff], [0x27c0, 0x27ef], [0x2980, 0x2aff]]],
  ['emoji', [[0x1f300, 0x1faff]]],
  ['symbols', [[0x2000, 0x2bff], [0xe000, 0xf8ff]]],
];

function inferSubsetFromUnicodeRange(unicodeRange) {
  const intervals = parseUnicodeRangeIntervals(unicodeRange);
  if (!intervals.length) return '';
  for (const [lo, hi] of intervals) {
    if (lo <= 0x007a && hi >= 0x0041) return 'latin';
  }
  for (const [script, ranges] of UNICODE_SCRIPT_TABLE) {
    for (const [lo, hi] of intervals) {
      if (ranges.some(([rLo, rHi]) => lo <= rHi && hi >= rLo)) {
        return script;
      }
    }
  }
  return '';
}

function normalizeUnicodeRangeKey(unicodeRange) {
  const intervals = parseUnicodeRangeIntervals(unicodeRange);
  if (!intervals.length) return '';
  return intervals.map(([lo, hi]) => (lo === hi ? lo.toString(16) : `${lo.toString(16)}-${hi.toString(16)}`)).join(',');
}

function scoreFontFaceSubset(unicodeRange, subsetHint) {
  const rangeScore = unicodeRangeCoversBasicLatin(unicodeRange);
  if (subsetHint) {
    if (subsetHint === 'latin') return Math.max(rangeScore, 2);
    if (subsetHint === 'latin-ext') return Math.min(rangeScore, 1);
    return Math.min(rangeScore, 0);
  }
  return rangeScore;
}

function resolveVariantSubset(unicodeRange, subsetHint = '', sliceHint = '') {
  const inferred = subsetHint || inferSubsetFromUnicodeRange(unicodeRange);
  if (sliceHint) {
    const label = inferred ? `${inferred}-${sliceHint}` : `slice-${sliceHint}`;
    return { subset: label, subsetKey: label, subsetScore: scoreFontFaceSubset(unicodeRange, inferred) };
  }
  if (inferred) {
    return { subset: inferred, subsetKey: inferred, subsetScore: scoreFontFaceSubset(unicodeRange, inferred) };
  }
  const rangeKey = normalizeUnicodeRangeKey(unicodeRange);
  if (rangeKey) {
    return { subset: '', subsetKey: `range:${rangeKey}`, subsetScore: scoreFontFaceSubset(unicodeRange, '') };
  }
  return { subset: '', subsetKey: 'all', subsetScore: 3 };
}

function parseCssStylesheet(cssText, baseUrl) {
  const text = String(cssText || '');
  const imports = [];
  const faces = [];
  let i = 0, lastComment = '';

  const readString = (q) => {
    let out = q;
    i++;
    while (i < text.length) {
      const ch = text[i];
      out += ch;
      if (ch === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
      i++;
      if (ch === q) break;
    }
    return out;
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break;
      lastComment = text.slice(i + 2, end).trim();
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") { readString(ch); continue; }
    if (ch === '@') {
      if (/^@import(?![a-zA-Z0-9_-])/i.test(text.slice(i, i + 8))) {
        let j = i + 7, depth = 0, quote = '';
        while (j < text.length) {
          const c = text[j];
          if (quote) {
            if (c === '\\') { j += 2; continue; }
            if (c === quote) quote = '';
            j++; continue;
          }
          if (c === '/' && text[j + 1] === '*') {
            const end = text.indexOf('*/', j + 2);
            j = end === -1 ? text.length : end + 2;
            continue;
          }
          if (c === '"' || c === "'") { quote = c; j++; continue; }
          if (c === '(') depth++;
          else if (c === ')' && depth > 0) depth--;
          else if ((c === ';' || c === '{' || c === '}') && depth === 0) break;
          j++;
        }
        const stmt = stripCssComments(text.slice(i, j));
        const m = stmt.match(/^@import\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|"([^"]*)"|'([^']*)')/i);
        const rawUrl = (m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? m?.[5] ?? '').trim();
        if (rawUrl) {
          try {
            const parsedImport = isAllowedFetchUrl(new URL(rawUrl, baseUrl).href, ['https:', 'http:']);
            if (parsedImport) imports.push(parsedImport.href);
          } catch {}
        }
        i = text[j] === ';' ? j + 1 : j;
        lastComment = '';
        continue;
      }
      if (/^@font-face(?![a-zA-Z0-9_-])/i.test(text.slice(i, i + 11))) {
        const { subset: subsetHint, slice: sliceHint } = parseSubsetComment(lastComment);
        lastComment = '';
        let j = i + 10;
        let q = '';
        while (j < text.length && text[j] !== '{' && text[j] !== ';') {
          if (q) {
            if (text[j] === '\\') { j += 2; continue; }
            if (text[j] === q) q = '';
            j++; continue;
          }
          if (text[j] === '"' || text[j] === "'") { q = text[j]; j++; continue; }
          if (text[j] === '/' && text[j + 1] === '*') {
            const end = text.indexOf('*/', j + 2);
            j = end === -1 ? text.length : end + 2;
          } else {
            j++;
          }
        }
        if (text[j] !== '{') { i = j + 1; continue; }
        j++;
        const bodyStart = j;
        let depth = 1, quote = '';
        while (j < text.length && depth > 0) {
          const c = text[j];
          if (quote) {
            if (c === '\\') { j += 2; continue; }
            if (c === quote) quote = '';
            j++; continue;
          }
          if (c === '/' && text[j + 1] === '*') {
            const end = text.indexOf('*/', j + 2);
            j = end === -1 ? text.length : end + 2;
            continue;
          }
          if (c === '"' || c === "'") { quote = c; j++; continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          j++;
        }
        const rawBlock = text.slice(bodyStart, depth === 0 ? Math.max(bodyStart, j - 1) : j);
        const block = stripCssComments(rawBlock);
        const face = { family: '', src: '', weight: '', style: '', stretch: '', unicodeRange: '', base: baseUrl, subsetHint, sliceHint };
        for (const decl of splitCssListOutsideParensAndQuotes(block, ';')) {
          const colon = decl.indexOf(':');
          if (colon <= 0) continue;
          const prop = decl.slice(0, colon).trim().toLowerCase();
          const val = decl.slice(colon + 1).trim();
          if (prop === 'font-family') face.family = val;
          else if (prop === 'src') face.src = val;
          else if (prop === 'font-weight') face.weight = val;
          else if (prop === 'font-style') face.style = val;
          else if (prop === 'font-stretch') face.stretch = val;
          else if (prop === 'unicode-range') face.unicodeRange = val;
        }
        if (face.family && face.src) faces.push(face);
        i = j;
        continue;
      }
    }
    if (!/\s/.test(ch)) lastComment = '';
    i++;
  }
  return { imports, faces };
}

function buildInspectedFonts({ computed = [], inlineFaces = [], externalFaces = [], legacyFonts = null }) {
  const familyMap = new Map();
  const ensureFamily = (rawName) => {
    const name = cleanFontFamilyName(rawName);
    if (!name || isGenericFontFamily(name)) return null;
    const key = name.toLowerCase();
    let entry = familyMap.get(key);
    if (!entry) {
      entry = { name, variants: new Map(), usedWeights: new Set(), legacyFiles: [] };
      familyMap.set(key, entry);
    }
    return entry;
  };

  for (const item of computed || []) {
    const entry = ensureFamily(item?.name);
    if (!entry) continue;
    for (const w of item?.usedWeights || []) {
      const parsed = parseSingleCssWeight(w);
      if (parsed) entry.usedWeights.add(parsed);
    }
  }

  for (const face of [...(inlineFaces || []), ...(externalFaces || [])]) {
    const entry = ensureFamily(face?.family);
    if (!entry) continue;
    const picked = parseFontFaceSrc(face.src, face.base);
    if (!picked) continue;
    const weightInfo = parseCssFontWeight(face.weight, picked.file);
    const style = normalizeCssFontStyle(face.style, picked.file);
    const stretchInfo = parseCssFontStretch(face.stretch);
    const isVariable = weightInfo.isVariable || stretchInfo.isStretchRange || picked.isVariableFormat;
    const subsetInfo = resolveVariantSubset(face.unicodeRange, face.subsetHint || '', face.sliceHint || '');
    const variantKey = `${weightInfo.weightMin}-${weightInfo.weightMax}-${style}-${isVariable ? 1 : 0}-${stretchInfo.stretchKey}-${subsetInfo.subsetKey}`;
    const score = subsetInfo.subsetScore * 1000 + picked.rank;
    const existing = entry.variants.get(variantKey);
    if (!existing || score > existing.score) {
      const variant = {
        file: picked.file,
        ext: picked.ext,
        weight: weightInfo.weight,
        weightMin: weightInfo.weightMin,
        weightMax: weightInfo.weightMax,
        isVariable,
        style,
        ...(stretchInfo.stretch !== 'normal' ? { stretch: stretchInfo.stretch } : {}),
        ...(subsetInfo.subset ? { subset: subsetInfo.subset } : {}),
        score,
        _subsetScore: subsetInfo.subsetScore,
        _stretchPct: stretchInfo.stretchPct,
      };
      entry.variants.set(variantKey, variant);
    }
  }

  if (Array.isArray(legacyFonts)) {
    for (const legacy of legacyFonts) {
      const entry = ensureFamily(legacy?.name);
      if (!entry) continue;
      if (Array.isArray(legacy.variants) && legacy.variants.length) {
        for (const v of legacy.variants) {
          const wMin = normalizeFontWeightNumber(v.weightMin) ?? normalizeFontWeightNumber(v.weight) ?? 400;
          const wMax = normalizeFontWeightNumber(v.weightMax) ?? normalizeFontWeightNumber(v.weight) ?? wMin;
          const lo = Math.min(wMin, wMax);
          const hi = Math.max(wMin, wMax);
          const st = v.style === 'italic' ? 'italic' : 'normal';
          const isVar = Boolean(v.isVariable) || hi > lo;
          const stretchInfo = parseCssFontStretch(v.stretch);
          const subset = typeof v.subset === 'string' && v.subset.trim() ? v.subset.trim().toLowerCase() : '';
          const key = `${lo}-${hi}-${st}-${isVar ? 1 : 0}-${stretchInfo.stretchKey}-${subset || 'all'}`;
          if (!entry.variants.has(key)) {
            const w = normalizeFontWeightNumber(v.weight);
            entry.variants.set(key, {
              file: v.file,
              ext: v.ext || inferFontExtFromUrlAndFormat(v.file, '')?.ext || 'woff2',
              weight: w !== null && w >= lo && w <= hi ? w : (lo <= 400 && hi >= 400 ? 400 : lo),
              weightMin: lo,
              weightMax: hi,
              isVariable: isVar,
              style: st,
              ...(stretchInfo.stretch !== 'normal' ? { stretch: stretchInfo.stretch } : {}),
              ...(subset ? { subset } : {}),
              score: 0,
              _subsetScore: subset === 'latin' ? 2 : subset ? 0 : 3,
              _stretchPct: stretchInfo.stretchPct,
            });
          }
        }
      } else {
        for (const file of legacy?.files || []) {
          if (!entry.legacyFiles.includes(file)) entry.legacyFiles.push(file);
        }
      }
    }
  }

  return Array.from(familyMap.values()).map((entry) => {
    const variants = Array.from(entry.variants.values())
      .sort((a, b) =>
        (a.style === b.style ? 0 : a.style === 'normal' ? -1 : 1) ||
        ((a._stretchPct === 100 ? 0 : 1) - (b._stretchPct === 100 ? 0 : 1)) ||
        a._stretchPct - b._stretchPct ||
        a.weightMin - b.weightMin ||
        a.weightMax - b.weightMax ||
        a.weight - b.weight ||
        b._subsetScore - a._subsetScore ||
        String(a.subset || '').localeCompare(String(b.subset || ''))
      )
      .map(({ score: _score, _subsetScore: _ss, _stretchPct: _sp, ...rest }) => rest);

    if (!variants.length && entry.legacyFiles.length) {
      for (const file of entry.legacyFiles) {
        const detected = inferFontExtFromUrlAndFormat(file, '');
        if (!detected) continue;
        const w = parseCssFontWeight('', file);
        const st = normalizeCssFontStyle('', file);
        variants.push({
          file,
          ext: detected.ext,
          weight: w.weight,
          weightMin: w.weightMin,
          weightMax: w.weightMax,
          isVariable: w.isVariable || detected.isVariableFormat,
          style: st,
        });
      }
    }

    const files = [...new Set([...variants.map((v) => v.file), ...entry.legacyFiles])];
    return {
      name: entry.name,
      files,
      variants,
      usedWeights: Array.from(entry.usedWeights).sort((a, b) => a - b),
    };
  });
}

function decodeUtf8Bytes(bytes) {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[++i] & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const cp = (((b0 & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += '\ufffd';
    }
  }
  return out;
}

async function inspectFonts() {
  const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if(!tab?.id) throw new Error('No active tab');
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
    const computedMap=new Map(), external=[], inlineFaces=[];
    const ensureComputed=(raw)=>{
      const name=String(raw||'').trim().replace(/^["']|["']$/g,'').replace(/\s+/g,' ').trim();
      if(!name)return null;
      const key=name.toLowerCase();
      let item=computedMap.get(key);
      if(!item){item={name,weights:new Set()};computedMap.set(key,item)}
      return item;
    };
    for(const el of Array.from(document.querySelectorAll('body, body *')).slice(0,4000)){
      if(!el.textContent?.trim())continue;
      const cs=getComputedStyle(el);
      const w=Number(cs.fontWeight);
      let recorded=false;
      for(const family of cs.fontFamily.split(',')){
        const item=ensureComputed(family);
        if(!item)continue;
        if(!recorded&&Number.isFinite(w)&&w>=1&&w<=1000){item.weights.add(Math.round(w));recorded=true}
      }
    }
    if(document.fonts){
      for(const face of document.fonts){
        const item=ensureComputed(face.family);
        if(!item||face.status!=='loaded')continue;
        for(const tok of String(face.weight||'').split(/\s+/)){
          const w=tok==='normal'?400:tok==='bold'?700:Number(tok);
          if(Number.isFinite(w)&&w>=1&&w<=1000)item.weights.add(Math.round(w));
        }
      }
    }
    const scan=(rules,base)=>{for(const rule of Array.from(rules)){
      if(rule.type===CSSRule.FONT_FACE_RULE){
        const family=rule.style.getPropertyValue('font-family');
        const src=rule.style.getPropertyValue('src');
        const weight=rule.style.getPropertyValue('font-weight');
        const style=rule.style.getPropertyValue('font-style');
        const stretch=rule.style.getPropertyValue('font-stretch');
        const unicodeRange=rule.style.getPropertyValue('unicode-range')||rule.unicodeRange||'';
        if(family&&src)inlineFaces.push({family,src,weight,style,stretch,unicodeRange,base});
      }else if(rule.type===CSSRule.IMPORT_RULE){
        const importBase=rule.styleSheet?.href||base;
        if(rule.styleSheet){
          try{scan(rule.styleSheet.cssRules,importBase)}catch{if(rule.href)try{external.push(new URL(rule.href,base).href)}catch{}}
        }else if(rule.href){
          try{external.push(new URL(rule.href,base).href)}catch{}
        }
      }else if(rule.cssRules){try{scan(rule.cssRules,base)}catch{}}
    }};
    for(const sheet of Array.from(document.styleSheets)){
      try{scan(sheet.cssRules,sheet.href||document.baseURI)}catch{if(sheet.href)external.push(sheet.href)}
    }
    return {
      computed:Array.from(computedMap.values()).map(v=>({name:v.name,usedWeights:Array.from(v.weights)})),
      inlineFaces,
      external
    };
  }});
  const inspected=result[0]?.result||{computed:[],inlineFaces:[],external:[]};
  const externalFaces=[];
  const queue=[...(inspected.external||[])];
  const seen=new Set();
  while(queue.length&&seen.size<30){
    const stylesheet=queue.shift();
    const parsedUrl=isAllowedFetchUrl(stylesheet,['https:','http:']);
    if(!parsedUrl||seen.has(parsedUrl.href))continue;
    seen.add(parsedUrl.href);
    try{
      const { bytes }=await fetchWithLimits(parsedUrl.href,{
        maxBytes:CSS_FETCH_MAX_BYTES,
        timeoutMs:10000,
        allowedProtocols:['https:','http:'],
        rejectContentTypes:['image/','video/','audio/','font/','application/octet-stream','application/pdf','application/zip','text/html','application/xhtml+xml','application/json'],
      });
      const css=decodeUtf8Bytes(bytes);
      const parsed=parseCssStylesheet(css,parsedUrl.href);
      externalFaces.push(...parsed.faces);
      for(const nested of parsed.imports){
        if(!seen.has(nested))queue.push(nested);
      }
    }catch{}
  }
  const hasStructured=Array.isArray(inspected.computed)||Array.isArray(inspected.inlineFaces);
  const fonts=buildInspectedFonts({
    computed:inspected.computed||[],
    inlineFaces:inspected.inlineFaces||[],
    externalFaces,
    legacyFonts:hasStructured?null:inspected.fonts
  });
  return {fonts,title:tab.title||'',url:tab.url||''};
}
async function captureArea() {
 const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)throw Error('No active tab');
 const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>new Promise(resolve=>{
   const existing=document.getElementById('__sightline_selector');
   if(existing){try{window.dispatchEvent(new Event('__sightline_selector_cancel'))}catch{}resolve(null);return}
   const host=document.createElement('div');host.id='__sightline_selector';host.style.cssText='all:initial;display:block;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;user-select:none;';
   const shadow=host.attachShadow({mode:'closed'});shadow.innerHTML=`<style>:host{all:initial}.box{position:fixed;border:2px solid #f26628;box-sizing:border-box;background:#f2662810;box-shadow:0 0 0 9999px #0007;pointer-events:none;display:none}.hint{position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:7px;background:#242426;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 4px 20px #0008;pointer-events:none}</style><div class="box"></div><div class="hint">Drag to select an area</div>`;
   const box=shadow.querySelector('.box'),hint=shadow.querySelector('.hint');document.documentElement.append(host);let origin=null,point=null,frame=0,pointerId=null,done=false;
   const MIN=4;
   const clampPoint=e=>({x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))});
   const update=()=>{if(!origin||!point)return;const x=point.x+scrollX,y=point.y+scrollY,left=Math.min(origin.x,x),top=Math.min(origin.y,y),right=Math.max(origin.x,x),bottom=Math.max(origin.y,y);box.style.display='block';box.style.left=(left-scrollX)+'px';box.style.top=(top-scrollY)+'px';box.style.width=(right-left)+'px';box.style.height=(bottom-top)+'px'};
   const tick=()=>{if(!origin||!point)return;const speed=point.y<=0?-14:point.y>=innerHeight-1?14:0;if(speed){window.scrollBy(0,speed);update()}frame=requestAnimationFrame(tick)};
   const cleanup=value=>{if(done)return;done=true;cancelAnimationFrame(frame);window.removeEventListener('keydown',onKey,true);window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);window.removeEventListener('__sightline_selector_cancel',onCancel);try{if(pointerId!=null&&host.hasPointerCapture?.(pointerId))host.releasePointerCapture(pointerId)}catch{}host.remove();resolve(value)};
   const onCancel=()=>cleanup(null);
   const resetDrag=()=>{cancelAnimationFrame(frame);origin=null;point=null;pointerId=null;box.style.display='none';hint.style.display=''};
   const finish=()=>{
    if(!origin||!point)return;
    const x=point.x+scrollX,y=point.y+scrollY;
    const selection={left:Math.min(origin.x,x),top:Math.min(origin.y,y),width:Math.abs(x-origin.x),height:Math.abs(y-origin.y)};
    // A stray click or tiny drag keeps the selector open so the user can try again.
    if(selection.width<MIN||selection.height<MIN){resetDrag();return}
    cleanup(selection);
   };
   const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cleanup(null)}};
   window.addEventListener('keydown',onKey,true);window.addEventListener('scroll',update,true);window.addEventListener('resize',update);window.addEventListener('__sightline_selector_cancel',onCancel);
   host.addEventListener('pointerdown',e=>{if(e.button!==0||origin)return;e.preventDefault();e.stopPropagation();pointerId=e.pointerId;origin={x:e.clientX+scrollX,y:e.clientY+scrollY};point=clampPoint(e);hint.style.display='none';try{host.setPointerCapture(e.pointerId)}catch{}update();frame=requestAnimationFrame(tick)});
   host.addEventListener('pointermove',e=>{if(!origin||e.pointerId!==pointerId)return;e.preventDefault();if(e.buttons===0&&e.pointerType==='mouse'){point=clampPoint(e);finish();return}point=clampPoint(e);update()});
   host.addEventListener('pointerup',e=>{if(!origin||e.pointerId!==pointerId)return;e.preventDefault();e.stopPropagation();point=clampPoint(e);finish()});
   host.addEventListener('lostpointercapture',e=>{if(origin&&e.pointerId===pointerId&&!done)finish()});
   host.addEventListener('pointercancel',()=>cleanup(null));
   host.addEventListener('contextmenu',e=>{e.preventDefault()});
  })});
 const region=result[0]?.result;if(!region)return;
 try{await captureFullPage(tab,region)}catch(error){await chrome.scripting.executeScript({target:{tabId:tab.id},func:message=>{const notice=document.createElement('div');notice.textContent=`Sightline: ${message}`;notice.style.cssText='all:initial;position:fixed;z-index:2147483647;right:20px;top:20px;max-width:360px;padding:14px 18px;border-radius:8px;background:#29292c;color:#fff;font:13px system-ui;box-shadow:0 8px 30px #0009';document.documentElement.append(notice);setTimeout(()=>notice.remove(),7000)},args:[error.message||String(error)]}).catch(()=>{});throw error}

}

async function record(){const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab?.id)return;const existing=await chrome.offscreen.hasDocument();if(!existing)await chrome.offscreen.createDocument({url:'recorder.html',reasons:['USER_MEDIA'],justification:'Record the current browser tab'});const stream=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});const result=await chrome.runtime.sendMessage({type:'start',stream,title:tab.title,url:tab.url});if(result?.error)throw Error(result.error);}
chrome.commands.onCommand.addListener(async c=>{try{if(c==='capture-visible')await capture();if(c==='record-tab'){const exists=await chrome.offscreen.hasDocument();const state=exists?await chrome.runtime.sendMessage({type:'get-recorder-status'}):null;if(state?.recording)await chrome.runtime.sendMessage({type:'stop-recording'});else await record()}if(c==='capture-area')await captureArea()}catch(e){const [tab]=await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[]);await notifyImageResult(tab?.id,e?.message||String(e),true)}});
chrome.runtime.onMessage.addListener((msg,_sender,send)=>{if(msg.type==='library-tags'){const port=chrome.runtime.connectNative('com.sightline.capture');port.onMessage.addListener(result=>{send(result);port.disconnect()});port.onDisconnect.addListener(()=>{if(chrome.runtime.lastError)send({error:chrome.runtime.lastError.message})});port.postMessage({type:'tags',url:msg.url||''});return true}if(msg.type==='open-asset'){const port=chrome.runtime.connectNative('com.sightline.capture');let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);port.onMessage.removeListener(onMessage);port.onDisconnect.removeListener(onDisconnect);try{port.disconnect()}catch{}send(value)};const onMessage=result=>finish(result||{ok:true});const onDisconnect=()=>finish({error:chrome.runtime.lastError?.message||'Sightline bridge disconnected.'});const timer=setTimeout(()=>finish({error:'Opening the saved asset timed out.'}),10000);port.onMessage.addListener(onMessage);port.onDisconnect.addListener(onDisconnect);try{port.postMessage({type:'open-asset',id:msg.id,launch:msg.launch!==false,wait:msg.wait})}catch(e){finish({error:e?.message||String(e)})}return true}if(msg.type==='recording-status'){chrome.offscreen.hasDocument().then(exists=>exists?chrome.runtime.sendMessage({type:'get-recorder-status'}):{recording:false}).then(send).catch(()=>send({recording:false}));return true}if(msg.type==='recording-ready'){chrome.tabs.create({url:chrome.runtime.getURL(`review.html?id=${encodeURIComponent(msg.id)}`)}).then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='find-fonts'){inspectFonts().then(value=>send(value)).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-font'){const extension=msg.extension;if(!['woff','woff2','ttf','otf'].includes(extension)){send({error:'Unsupported font format'});return}if(!isAllowedFetchUrl(msg.file,['https:','http:','data:','blob:'])){send({error:'Unsupported font URL'});return}const ALLOWED_FONT_SOURCES=['capture','local','google','upload'];const fontSource=typeof msg.fontSource==='string'&&ALLOWED_FONT_SOURCES.includes(msg.fontSource)?msg.fontSource:'capture';const fontMeta={fontSource};if(typeof msg.family==='string'&&msg.family.trim())fontMeta.family=msg.family.trim();const w=normalizeFontWeightNumber(msg.weight);const wMin=normalizeFontWeightNumber(msg.weightMin);const wMax=normalizeFontWeightNumber(msg.weightMax);if(wMin!==null&&wMax!==null){const lo=Math.min(wMin,wMax),hi=Math.max(wMin,wMax);fontMeta.weightMin=lo;fontMeta.weightMax=hi;fontMeta.weight=w!==null&&w>=lo&&w<=hi?w:(lo<=400&&hi>=400?400:lo);fontMeta.isVariable=hi>lo?true:Boolean(msg.isVariable);}else if(w!==null){fontMeta.weight=w;fontMeta.weightMin=w;fontMeta.weightMax=w;if(typeof msg.isVariable==='boolean')fontMeta.isVariable=msg.isVariable;}else{const single=wMin??wMax;if(single!==null){fontMeta.weight=single;fontMeta.weightMin=single;fontMeta.weightMax=single;}if(typeof msg.isVariable==='boolean')fontMeta.isVariable=msg.isVariable;}if(msg.style==='normal'||msg.style==='italic')fontMeta.style=msg.style;saveCapture(msg.file,extension,msg.title,msg.url,msg.name,undefined,undefined,undefined,undefined,undefined,undefined,fontMeta).then(id=>send({ok:true,id})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-area'){saveCapture(msg.data,msg.extension||'png',msg.title,msg.url,msg.name||'',msg.tags,msg.category,undefined,undefined,msg.notes,msg.annotations).then(id=>send({ok:true,id})).catch(e=>send({error:String(e)}));return true}if(msg.type==='area'){captureArea().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='save-clip'){saveCapture(msg.data,'webm',msg.title,msg.url,'',msg.tags,msg.category,msg.segments,msg.crop,msg.notes,msg.annotations).then(id=>send({ok:true,id})).catch(e=>send({error:String(e)}));return true}if(msg.type==='full-page'){captureFullPage().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='screenshot'){capture().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='record'){record().then(()=>send({ok:true})).catch(e=>send({error:String(e)}));return true}if(msg.type==='stop'){chrome.runtime.sendMessage({type:'stop-recording'}).then(result=>send(result)).catch(e=>send({error:String(e)}));return true}});
