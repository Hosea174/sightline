const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d'),status=document.getElementById('status'),save=document.getElementById('save');
const cropToggle=document.getElementById('crop-toggle'),resetCrop=document.getElementById('reset-crop'),discardBtn=document.getElementById('discard');
const image=new Image();let metadata={},history=[],future=[],dirty=false,loaded=false;
function syncHistoryButtons(){document.getElementById('undo').disabled=!history.length;document.getElementById('redo').disabled=!future.length}
syncHistoryButtons();
function syncCropControls(r,state){
 const full=state?state.full:(Math.abs(r.x)<1e-6&&Math.abs(r.y)<1e-6&&Math.abs(r.w-1)<1e-6&&Math.abs(r.h-1)<1e-6);
 const active=state?state.active:editor?.isActive?.()||false;
 if(cropToggle){cropToggle.setAttribute('aria-pressed',String(active));cropToggle.title=active?'Done cropping':'Crop';cropToggle.setAttribute('aria-label',cropToggle.title)}
 if(resetCrop)resetCrop.disabled=full&&!active;
 const sizeEl=document.getElementById('crop-size');
 if(sizeEl&&canvas.width&&canvas.height){
  const w=Math.max(1,Math.round(r.w*canvas.width)),h=Math.max(1,Math.round(r.h*canvas.height));
  sizeEl.textContent=full?`${w} × ${h} px`:`Crop: ${w} × ${h} px`;
 }
}
const editor=createCropEditor(document.getElementById('crop-overlay'),(r,state)=>syncCropControls(r,state),before=>remember(before));
syncCropControls(editor.get());
const annotations=createAnnotations(document.getElementById('media-frame'),canvas,()=>editor.get(),null,null,null,()=>remember(),drawing=>{if(drawing)editor.setActive(false)});
function snapshot(crop=editor.get()){return {crop,annotations:annotations.snapshot()}}
function remember(crop){history.push(snapshot(crop));if(history.length>50)history.shift();future=[];if(loaded)dirty=true;syncHistoryButtons()}
function undo(redo=false){const from=redo?future:history,to=redo?history:future;if(from.length){to.push(snapshot());const state=from.pop();editor.set(state.crop||state);if(state.annotations)annotations.restore(state.annotations);dirty=true}syncHistoryButtons()}
document.getElementById('undo').addEventListener('click',()=>undo());document.getElementById('redo').addEventListener('click',()=>undo(true));
resetCrop.addEventListener('click',()=>{const r=editor.get(),full=editor.isFull();if(!full)remember(r);editor.reset()});
function toggleCrop(){
 const next=!editor.isActive();
 if(next)annotations.setDrawing?.(false);
 editor.setActive(next);
}
if(cropToggle)cropToggle.onclick=toggleCrop;
function isTextEntry(target){if(!target)return false;const isEl=typeof Element==='undefined'?Boolean(target.tagName):target instanceof Element;if(!isEl)return false;if(target.isContentEditable||target.closest?.('.annotation-editor'))return true;if(target.tagName==='TEXTAREA'||target.tagName==='SELECT')return true;if(target.tagName==='INPUT'){const t=(target.getAttribute('type')||'text').toLowerCase();return !/^(range|button|checkbox|radio|submit|reset|color|file)$/.test(t)}return false}
function isDialogOpen(){return Boolean(document.querySelector?.('[role="dialog"][data-state="open"],[role="menu"][data-state="open"]'))}
async function confirmAction(opts){
 if(typeof window.sightlineConfirm==='function')return await window.sightlineConfirm(opts);
 return confirm(opts.description||opts.title);
}
function syncDocumentTitle(){const title=document.getElementById('title')?.value?.trim()||'';document.title=title?`${title} — Sightline`:'Sightline Editor'}
['title','url','notes','category','tags'].forEach(id=>{const el=document.getElementById(id);if(el){el.addEventListener('input',()=>{if(loaded)dirty=true;if(id==='title')syncDocumentTitle()});el.addEventListener('change',()=>{if(loaded)dirty=true;if(id==='title')syncDocumentTitle()})}});
const tagPills=document.getElementById('tag-pills');
if(tagPills&&typeof MutationObserver!=='undefined'){new MutationObserver(()=>{if(loaded)dirty=true}).observe(tagPills,{childList:true})}
window.addEventListener('pointerdown',e=>{const active=document.activeElement;if(!isTextEntry(active))return;const t=e.target;if(t instanceof Element&&t.closest('input:not([type="range"]),textarea,select,.tags-field,.tag-suggestions,.annotation-editor,[contenteditable="true"]'))return;if(active instanceof HTMLElement)active.blur()},true);
window.addEventListener('keydown',e=>{
 if(isDialogOpen())return;
 if(e.key==='Escape'&&!e.defaultPrevented&&isTextEntry(e.target)&&!e.target.closest?.('.annotation-editor')){e.preventDefault();if(e.target instanceof HTMLElement)e.target.blur();return}
 if(isTextEntry(e.target))return;
 if((e.ctrlKey||e.metaKey)&&(e.code==='KeyZ'||e.code==='KeyY')){e.preventDefault();undo(e.code==='KeyY'||e.shiftKey);return}
 if(e.key==='?'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();window.dispatchEvent(new CustomEvent('sightline:shortcuts'));return}
 if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&e.code==='KeyC'){e.preventDefault();toggleCrop();return}
 if(e.key==='Escape'&&!e.defaultPrevented&&editor.isActive()){e.preventDefault();editor.setActive(false)}
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
if(discardBtn){
 discardBtn.onclick=async()=>{
  const message=dirty?'Discard this capture and your unsaved edits?':'Discard this capture without saving?';
  if(!await confirmAction({title:'Discard capture?',description:message,confirmLabel:'Discard',destructive:true}))return;
  dirty=false;
  try{
   const latest=await chrome.storage.local.get(['cropId']);
   if(!metadata.cropId||latest.cropId===metadata.cropId)await chrome.storage.local.remove(['cropId','cropImage','cropTitle','cropUrl','cropFull','cropExtension','cropName']);
  }catch{}
  window.close();
 };
}
chrome.storage.local.get(['cropId','cropImage','cropTitle','cropUrl','cropFull','cropExtension','cropName']).then(async v=>{
 metadata=v;
 await loadSourceDefaults(v.cropUrl);
 document.getElementById('title').value=v.cropTitle||'';
 syncDocumentTitle();
 document.getElementById('url').value=v.cropUrl||'';
 image.src=v.cropImage||'';
 setTimeout(()=>{loaded=true},100);
});
image.onload=()=>{canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);editor.reset();save.disabled=false};
image.onerror=()=>status.textContent='The image could not be loaded.';
let saving=false,lastSavedSignature=null,lastSavedId=null;
function captureEdits(commitTags=true){
 return {
  crop:editor.isFull()?null:editor.get(),
  title:document.getElementById('title').value.trim(),
  url:document.getElementById('url').value.trim(),
  category:document.getElementById('category').value,
  tags:window.captureTags.values(commitTags),
  notes:document.getElementById('notes').value,
  annotations:annotations.export(),
 };
}
save.onclick=async()=>{
 if(saving||save.disabled)return;
 saving=true;
 try{
  const {crop,...fields}=captureEdits();
  const saveSig=JSON.stringify({crop,...fields});
  if(lastSavedSignature!==null&&saveSig===lastSavedSignature){
   dismissToast?.(true);
   if(!await confirmAction({title:'Already saved',description:'No changes were made since you last saved this capture. Save another copy anyway?',confirmLabel:'Save copy',destructive:false})){
    showSavedAssetToast('capture',lastSavedId,true);
    return;
   }
  }
  if(annotations.hasOmitted()&&!await confirmAction({title:'Save with omitted annotations?',description:'Some annotations are outside the crop and will not be saved. Continue?',confirmLabel:'Continue',destructive:false}))return;
  save.disabled=true;
  status.textContent='Saving…';
  let data=metadata.cropImage;
  if(crop){
   const r=crop;
   const out=document.createElement('canvas');
   out.width=Math.max(1,Math.round(r.w*canvas.width));
   out.height=Math.max(1,Math.round(r.h*canvas.height));
   out.getContext('2d').drawImage(image,r.x*canvas.width,r.y*canvas.height,r.w*canvas.width,r.h*canvas.height,0,0,out.width,out.height);
   data=out.toDataURL('image/png');
  }
  const result=await chrome.runtime.sendMessage({type:'save-area',data,extension:crop?'png':metadata.cropExtension,name:crop?'':metadata.cropName,...fields});
  if(!result)throw Error('No response from Sightline. Reload the extension and try again.');
  if(result.error)throw Error(result.error);
  dirty=Boolean(document.getElementById('tags').value.trim())||JSON.stringify(captureEdits(false))!==saveSig;
  lastSavedSignature=saveSig;lastSavedId=result.id;status.textContent='';
  showSavedAssetToast('capture',result.id);
  try{
   const latest=await chrome.storage.local.get(['cropId']);
   if(!metadata.cropId||latest.cropId===metadata.cropId)await chrome.storage.local.remove(['cropId','cropImage','cropTitle','cropUrl','cropFull','cropExtension','cropName']);
  }catch{}
 }catch(e){
  status.textContent='';
  showToast('Could not save capture',e.message||String(e),{tone:'error'});
 }finally{
  saving=false;
  save.disabled=false;
 }
};
