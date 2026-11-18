const status=document.getElementById('status'),list=document.getElementById('fontList'),record=document.getElementById('record');
let recording=false,busy=false,shortcuts={};
function setBusy(value){busy=value;document.querySelectorAll('.tools button,#fonts,#recordings').forEach(button=>button.disabled=value);document.querySelector('main').setAttribute('aria-busy',String(value))}
function emitPopupState(){if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function'){window.dispatchEvent(new CustomEvent('sightline:popup-state',{detail:{recording,shortcuts}}))}}
function setShortcutHint(id,shortcut){const el=document.getElementById(id);if(el&&el.dataset)el.dataset.shortcut=shortcut||'';if(el&&typeof el.removeAttribute==='function')el.removeAttribute('title')}
chrome.commands.getAll(commands=>{shortcuts=Object.fromEntries(commands.map(c=>[c.name,c.shortcut]));setShortcutHint('screenshot',shortcuts['capture-visible']);setShortcutHint('area',shortcuts['capture-area']?`Ctrl+Alt+D / ${shortcuts['capture-area']}`:'Ctrl+Alt+D / Ctrl+Shift+D');renderRecord();emitPopupState()});
function renderRecord(){record.classList.toggle('recording',recording);record.querySelector('.action-label').textContent=recording?'Stop recording':'Record tab';record.querySelector('small').textContent=recording?'Finish and review':'Capture motion & interactions';record.setAttribute('aria-pressed',String(recording));const label=recording?'Stop recording':'Start recording';setShortcutHint('record',shortcuts['record-tab']);record.setAttribute('aria-label',label);emitPopupState()}
async function refresh(){try{const r=await chrome.runtime.sendMessage({type:'recording-status'});recording=!!r?.recording;renderRecord()}catch{}}
for(const id of ['screenshot','full-page','area','record'])document.getElementById(id).onclick=async()=>{if(busy)return;setBusy(true);const action=id==='record'?(recording?'stop':'record'):id;status.textContent=action==='stop'?'Finishing recording...':action==='full-page'?'Capturing page. Keep this tab active...':'Working...';try{const r=await chrome.runtime.sendMessage({type:action});if(r?.error)throw Error(r.error);if(action==='record')recording=true;if(action==='stop')recording=false;renderRecord();status.textContent=({screenshot:'Review your screenshot in the new tab.','full-page':'Review your full-page capture in the new tab.',area:'Select an area on the page.',record:'Recording this tab. Select Stop when finished.',stop:'Recording ready for review.'})[action]}catch(e){status.textContent=e.message||String(e);await refresh()}finally{setBusy(false)}};
const FONT_WEIGHT_LABELS={100:'Thin',200:'Extra Light',300:'Light',350:'Semilight',400:'Regular',500:'Medium',600:'Semi Bold',700:'Bold',800:'Extra Bold',900:'Black',950:'Extra Black'};
function formatVariantButtonLabel(variant){
  const ext=variant.ext.toUpperCase();
  if(variant.legacy){
    return variant.total>1&&variant.stem?`Save ${ext} · ${variant.stem.slice(0,22)}`:`Save ${ext}`;
  }
  const min=variant.weightMin??variant.weight??400,max=variant.weightMax??variant.weight??min;
  const isVar=Boolean(variant.isVariable)||max>min;
  const italic=variant.style==='italic'?' Italic':'';
  if(isVar)return `Variable ${min}–${max}${italic} · ${ext}`;
  const w=variant.weight||min||400;
  return `${w} ${FONT_WEIGHT_LABELS[w]||w}${italic} · ${ext}`;
}
function extractDownloadableVariants(font){
  const allowed=['woff','woff2','ttf','otf'];
  if(Array.isArray(font.variants)&&font.variants.length){
    return font.variants.map(v=>{
      let ext=(v.ext||'').toLowerCase();
      if(!allowed.includes(ext)){
        try{ext=(new URL(v.file).pathname.split('/').pop()||'').split('.').pop().toLowerCase()}catch{}
      }
      if(!allowed.includes(ext))return null;
      const wMin=typeof v.weightMin==='number'?v.weightMin:(typeof v.weight==='number'?v.weight:400);
      const wMax=typeof v.weightMax==='number'?v.weightMax:(typeof v.weight==='number'?v.weight:wMin);
      const isVar=Boolean(v.isVariable)||wMax>wMin;
      const w=typeof v.weight==='number'?v.weight:(wMin<=400&&wMax>=400?400:wMin);
      return {file:v.file,ext,weight:w,weightMin:wMin,weightMax:wMax,isVariable:isVar,style:v.style==='italic'?'italic':'normal',legacy:false};
    }).filter(Boolean);
  }
  const items=(font.files||[]).map(file=>{
    let ext='',stem='';
    try{const pathname=new URL(file).pathname,fileName=pathname.split('/').pop()||'';ext=fileName.split('.').pop().toLowerCase();stem=fileName.replace(/\.[^.]+$/,'')}catch{}
    return allowed.includes(ext)?{file,ext,stem,weight:400,weightMin:400,weightMax:400,isVariable:false,style:'normal',legacy:true}:null;
  }).filter(Boolean);
  return items.map(item=>({...item,total:items.length}));
}
document.getElementById('fonts').onclick=async()=>{if(busy)return;setBusy(true);list.textContent='';status.textContent='Inspecting fonts...';try{const result=await chrome.runtime.sendMessage({type:'find-fonts'});if(result?.error)throw Error(result.error);status.textContent=result.fonts.length?`${result.fonts.length} font families found.`:'No font families found.';for(const font of result.fonts){const row=document.createElement('div');row.className='item';const label=document.createElement('strong');label.textContent=font.name;row.append(label);const downloadable=extractDownloadableVariants(font);if(!downloadable.length){const hint=document.createElement('span');hint.className='hint';hint.textContent='File unavailable';row.append(hint)}const variantEntries=[];for(const variant of downloadable){const button=document.createElement('button');const buttonLabel=formatVariantButtonLabel(variant);button.textContent=buttonLabel;button.title=variant.file;const entry={variant,button,buttonLabel,saved:false};const saveVariant=async()=>{if(entry.saved)return true;button.disabled=true;try{button.textContent='Saving...';const weightSuffix=variant.legacy?'':variant.isVariable?` ${variant.weightMin}-${variant.weightMax}${variant.style==='italic'?' Italic':''}`:` ${variant.weight}${variant.style==='italic'?' Italic':''}`;const payload={type:'save-font',file:variant.file,extension:variant.ext,name:`${font.name}${weightSuffix}`,family:font.name,fontSource:'capture',title:result.title,url:result.url};if(!variant.legacy){payload.weight=variant.weight;payload.weightMin=variant.weightMin;payload.weightMax=variant.weightMax;payload.isVariable=variant.isVariable;payload.style=variant.style}const saved=await chrome.runtime.sendMessage(payload);if(saved?.error)throw Error(saved.error);entry.saved=true;button.textContent='Saved';return true}catch(e){button.disabled=false;button.textContent=buttonLabel;status.textContent=`Could not save ${font.name}: ${e.message||e}`;return false}};button.onclick=saveVariant;entry.save=saveVariant;variantEntries.push(entry);row.append(button)}if(variantEntries.length>1){const saveAll=document.createElement('button');const saveAllLabel=`Save all (${variantEntries.length})`;saveAll.className='save-all';saveAll.textContent=saveAllLabel;saveAll.onclick=async()=>{saveAll.disabled=true;let failed=0,done=0;const pending=variantEntries.filter(v=>!v.saved);for(const entry of pending){done++;saveAll.textContent=`Saving ${done}/${pending.length}...`;const ok=await entry.save();if(!ok)failed++}if(failed===0){saveAll.textContent='Saved all';status.textContent=`Saved ${variantEntries.length} styles for ${font.name}.`}else{saveAll.disabled=false;saveAll.textContent=saveAllLabel}};row.append(saveAll)}list.append(row)}}catch(e){status.textContent=e.message||String(e)}finally{setBusy(false)}};
document.getElementById('recordings').onclick=async()=>{if(busy)return;setBusy(true);list.textContent='';try{const recordings=await listRecordings();status.textContent=recordings.length?`${recordings.length} saved recordings`:'No saved recordings.';for(const item of recordings.sort((a,b)=>b.created-a.created)){const row=document.createElement('div');row.className='item';const button=document.createElement('button');button.textContent=item.title||'Untitled recording';button.onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL(`review.html?id=${encodeURIComponent(item.id)}`)});row.append(button);list.append(row)}}catch(e){status.textContent=String(e)}finally{setBusy(false)}};
document.getElementById('shortcuts').onclick=()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'});refresh();
