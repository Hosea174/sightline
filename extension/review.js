const video=document.getElementById('video'),status=document.getElementById('status'),save=document.getElementById('save'),track=document.getElementById('track'),clipsNode=document.getElementById('clips'),head=document.getElementById('playhead'),play=document.getElementById('play'),ruler=document.getElementById('ruler');
const cropToggle=document.getElementById('crop-toggle'),resetCrop=document.getElementById('reset-crop'),speedSelect=document.getElementById('speed'),timelinePanel=document.querySelector?.('.timeline-panel'),timelineResizer=document.getElementById('timeline-resizer'),timelineToggle=document.getElementById('timeline-toggle');
const id=new URL(location.href).searchParams.get('id'),$=id=>document.getElementById(id),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),frame=1/60;
let metadata={},sourceUrl='',duration=0,clips=[],selected=0,drag=null,exporting=false,history=[],future=[],playhead=0,playingClip=0,dirty=false,loaded=false,initialized=false,rafId=0;
const clipSpeed=c=>c?.speed||1,width=c=>(c.end-c.start)/clipSpeed(c),end=c=>c.at+width(c);
const timelineStart=()=>clips.length?Math.min(...clips.map(c=>c.at)):0;
const timelineEnd=()=>clips.length?Math.max(...clips.map(end)):duration;
function format(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`}
const playIcon='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
const pauseIcon='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>';
function syncCropControls(r,state){
 const full=state?state.full:(Math.abs(r.x)<1e-6&&Math.abs(r.y)<1e-6&&Math.abs(r.w-1)<1e-6&&Math.abs(r.h-1)<1e-6);
 const active=state?state.active:cropEditor?.isActive?.()||false;
 if(cropToggle){cropToggle.setAttribute('aria-pressed',String(active));cropToggle.title=active?'Done cropping (C)':'Crop (C)';cropToggle.setAttribute('aria-label',cropToggle.title)}
 if(resetCrop)resetCrop.disabled=full&&!active;
}
const cropEditor=createCropEditor($('crop-overlay'),(r,state)=>syncCropControls(r,state),before=>remember(before));
syncCropControls(cropEditor.get());
const annotations=createAnnotations($('media-frame'),video,()=>cropEditor.get(),()=>[...clips].sort((a,b)=>a.at-b.at),time=>{const clip=clips.find(c=>time>=c.start&&time<=c.end);if(clip)setTime(clip.at+(time-clip.start)/clipSpeed(clip))},{now:()=>playhead,duration:()=>duration,limits:()=>({start:timelineStart(),end:timelineEnd()}),seek:setTime},()=>remember(),drawing=>{if(drawing)cropEditor.setActive?.(false)});
function snapshot(crop=cropEditor.get()){return {clips:clips.map(c=>({...c})),crop,annotations:annotations.snapshot()}}
function syncHistoryButtons(){$('undo').disabled=!history.length;$('redo').disabled=!future.length}
function pushHistory(entry){history.push(entry);if(history.length>50)history.shift();future=[];if(loaded)dirty=true;syncHistoryButtons()}
function remember(crop){pushHistory(snapshot(crop))}
function drawRuler(){
 if(!ruler||!duration)return;
 track.parentElement?.style.setProperty('--timeline-content-width',`${duration/metadataDuration*100}%`);
 const step=metadataDuration/4;
 const times=Array.from({length:Math.ceil(duration/step)},(_,i)=>i*step);
 // Avoid overlapping labels if the extension ends just beyond a regular tick.
 if(times.length>5&&times.at(-1)>metadataDuration&&duration-times.at(-1)<step*.45)times.pop();
 times.push(duration);
 ruler.textContent='';
 for(const time of times){
  const tick=document.createElement('span');
  tick.className='tick';tick.style.left=(time/duration*100)+'%';tick.textContent=format(time);ruler.append(tick);
 }
}
function syncDuration(){
 if(!metadataDuration)return;
 const maxEnd=timelineEnd();
 // Keep the source scale when edits shorten the clip. Extend only to fit slower clips.
 const next=Math.max(metadataDuration,maxEnd);
 if(Math.abs(next-duration)>1e-4){duration=next;drawRuler()}
}
function undo(redo=false){
 const from=redo?future:history,to=redo?history:future;
 if(from.length){
  to.push(snapshot());
  const state=from.pop();
  clips=state.clips;
  annotations.restore(state.annotations||[]);
  cropEditor.set(state.crop);
  selected=Math.max(0,Math.min(selected,clips.length-1));
  syncDuration();
  setTime(Math.min(playhead,duration));
  dirty=true;
 }
 syncHistoryButtons();
}
syncHistoryButtons();
$('undo').addEventListener('click',()=>undo());$('redo').addEventListener('click',()=>undo(true));
resetCrop.addEventListener('click',()=>{const r=cropEditor.get(),full=cropEditor.isFull?cropEditor.isFull():(r.x===0&&r.y===0&&r.w===1&&r.h===1);if(!full)remember(r);cropEditor.reset()});
function toggleCrop(){
 const next=!(cropEditor.isActive?.());
 if(next)annotations.setDrawing?.(false);
 cropEditor.setActive?.(next);
}
if(cropToggle)cropToggle.onclick=toggleCrop;
function readStorage(key,fallback){try{const v=localStorage.getItem(key);return v==null?fallback:v}catch{return fallback}}
function writeStorage(key,val){try{localStorage.setItem(key,String(val))}catch{}}
let timelineMinimized=readStorage('sightline-timeline-minimized','false')==='true';
let timelineHeight=clamp(Number(readStorage('sightline-timeline-height',210))||210,140,480);
function applyTimelineLayout(){
 if(!timelinePanel)return;
 timelinePanel.classList?.toggle('minimized',timelineMinimized);
 timelinePanel.style.height=timelineMinimized?'':`${timelineHeight}px`;
 if(timelineToggle){
  const label=timelineMinimized?'Restore timeline (Ctrl+`)':'Minimize timeline (Ctrl+`)';
  timelineToggle.setAttribute('aria-expanded',String(!timelineMinimized));
  timelineToggle.title=label;
  timelineToggle.setAttribute('aria-label',label);
 }
}
function toggleTimeline(){timelineMinimized=!timelineMinimized;writeStorage('sightline-timeline-minimized',timelineMinimized);applyTimelineLayout()}
if(timelineToggle)timelineToggle.addEventListener('click',toggleTimeline);
if(timelineResizer&&timelinePanel){
 let resizeDrag=null;
 timelineResizer.onpointerdown=e=>{
  if(e.button!==0||timelineMinimized)return;
  e.preventDefault();
  resizeDrag={y:e.clientY,height:timelinePanel.getBoundingClientRect?.().height||timelineHeight};
  timelineResizer.setPointerCapture?.(e.pointerId);
 };
 timelineResizer.onpointermove=e=>{
  if(!resizeDrag)return;
  const maxH=Math.max(220,(typeof window!=='undefined'&&window.innerHeight?window.innerHeight:800)-240);
  timelineHeight=clamp(Math.round(resizeDrag.height+(resizeDrag.y-e.clientY)),140,maxH);
  timelinePanel.style.height=`${timelineHeight}px`;
 };
 const finishResize=()=>{if(!resizeDrag)return;resizeDrag=null;writeStorage('sightline-timeline-height',timelineHeight)};
 timelineResizer.onpointerup=finishResize;
 timelineResizer.onpointercancel=finishResize;
 timelineResizer.onkeydown=e=>{
  if(timelineMinimized||!['ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();
  const maxH=Math.max(220,(typeof window!=='undefined'&&window.innerHeight?window.innerHeight:800)-240);
  const step=e.shiftKey?48:16;
  timelineHeight=clamp(timelineHeight+(e.key==='ArrowUp'?step:-step),140,maxH);
  writeStorage('sightline-timeline-height',timelineHeight);
  applyTimelineLayout();
 };
}
applyTimelineLayout();

function setClipSpeed(index,nextSpeed){
 const c=clips[index];
 if(!c||!Number.isFinite(nextSpeed)||nextSpeed<=0)return;
 const cur=clipSpeed(c);
 if(Math.abs(cur-nextSpeed)<1e-4)return;
 remember();
 const oldWidth=width(c),oldEnd=end(c);
 const sourceOffset=playhead>=c.at&&playhead<=oldEnd?(playhead-c.at)*cur:null;
 c.speed=nextSpeed;
 const newWidth=width(c),delta=newWidth-oldWidth;
 clips.forEach((other,i)=>{if(i!==index&&other.at>=oldEnd-0.0001)other.at=Math.max(0,other.at+delta)});
 annotations.shiftTiming?.(c.at,delta,oldEnd,newWidth/oldWidth);
 syncDuration();
 if(sourceOffset!==null)playhead=c.at+sourceOffset/nextSpeed;
 setTime(clamp(playhead,0,duration));
}
if(speedSelect){
 speedSelect.onchange=()=>{
  const next=parseFloat(speedSelect.value);
  setClipSpeed(selected,next);
  speedSelect.blur?.();
 };
}

function locate(t){let i=clips.findIndex(c=>t>=c.at&&t<end(c));if(i>=0)return i;i=clips.findIndex(c=>c.at>t);return i<0?clips.length-1:i}
function setTime(t){if(!duration||!clips.length)return;playhead=clamp(t,0,timelineEnd());playingClip=locate(playhead);const c=clips[playingClip];const spd=clipSpeed(c);const target=clamp(c.start+(playhead-c.at)*spd,c.start,c.end);if(Math.abs(video.currentTime-target)>0.001)video.currentTime=target;if('playbackRate' in video)video.playbackRate=spd;render()}
function normalizeStart(){const first=Math.min(...clips.map(c=>c.at));if(first>0){clips.forEach(c=>c.at-=first);playhead=Math.max(0,playhead-first);annotations.shiftTiming?.(0,-first)}}
function render(){
 if(!duration)return;
 annotations.renderTimeline();
 annotations.renderMarks?.();
 clipsNode.textContent='';
 clips.forEach((c,i)=>{
  const el=document.createElement('div');
  const isRetiming=Boolean(drag&&drag.side?.startsWith('speed-')&&drag.i===i);
  el.className='clip'+(i===selected?' selected':'')+(isRetiming?' retiming':'');
  el.style.left=(c.at/duration*100)+'%';
  el.style.width=(width(c)/duration*100)+'%';
  el.tabIndex=0;
  const spd=clipSpeed(c),spdTag=Math.abs(spd-1)>1e-4?` · ${spd}×`:'';
  el.setAttribute('aria-label',`Clip ${i+1}, source ${format(c.start)} to ${format(c.end)}, timeline ${format(c.at)}${spdTag}`);
  const grip=side=>`<span class="clip-speed-handle ${side}" data-side="speed-${side}" title="Drag inward to speed up or outward to slow down · Shift for 0.25× steps"></span>`;
  el.innerHTML=grip('left')+grip('right')+'<span class="handle left" data-side="left" title="Trim start"></span><div class="clip-label">Video '+(i+1)+spdTag+'</div><span class="handle right" data-side="right" title="Trim end"></span>'+(isRetiming?`<div class="clip-speed-readout">${spd}× · ${format(width(c))}</div>`:'');
  el.onpointerdown=e=>{
   if(e.button!==undefined&&e.button!==0)return;
   e.preventDefault();e.stopPropagation();
   selected=i;video.pause();
   const side=e.target?.closest?.('[data-side]')?.dataset?.side||e.target?.dataset?.side||'move';
   const trackRect=track.getBoundingClientRect?.();
   drag={
    i,
    side,
    x:e.clientX,
    original:{...c},
    originalClips:clips.map(item=>({...item})),
    originalAnnotations:annotations.snapshot(),
    originalDuration:duration,
    originalPlayhead:playhead,
    trackWidth:trackRect&&trackRect.width>0?trackRect.width:100,
    changed:false,
    before:snapshot()
   };
   track.setPointerCapture(e.pointerId);
   if(!side.startsWith('speed-'))render();
  };
  clipsNode.append(el);
 });
 if(speedSelect&&clips[selected]){
  const val=String(clipSpeed(clips[selected]));
  if(speedSelect.value!==val){
   speedSelect.value=val;
   speedSelect.dispatchEvent?.(new CustomEvent('sightline:sync-value'));
  }
 }
 head.style.left=(playhead/duration*100)+'%';
 head.setAttribute('aria-valuemax',timelineEnd().toFixed(2));
 head.setAttribute('aria-valuenow',playhead.toFixed(2));
 $('clock').textContent=`${format(playhead)} / ${format(timelineEnd())}`;
 const outLen=clips.reduce((sum,c)=>sum+width(c),0);
 const editSummary=Math.abs(outLen-metadataDuration)>1e-4?` · out ${format(outLen)}`:'';
 $('duration').textContent=`${format(duration)} · ${clips.length} ${clips.length===1?'clip':'clips'}${editSummary}`;
 play.innerHTML=video.paused?playIcon:pauseIcon;
}
function point(e){const r=track.getBoundingClientRect();return clamp((e.clientX-r.left)/r.width*duration,0,duration)}
function startSeek(e){if(!duration)return;e.preventDefault();e.stopPropagation();video.pause();track.setPointerCapture(e.pointerId);drag={seek:true};setTime(point(e))}
track.onpointerdown=e=>{if(e.target.closest('.clip'))return;startSeek(e)};head.onpointerdown=startSeek;ruler.onpointerdown=startSeek;
track.onpointermove=e=>{
 if(!drag)return;
 if(drag.seek){setTime(point(e));return}
 if(drag.side.startsWith('speed-')){
  if(!drag.changed&&Math.abs(e.clientX-drag.x)<2)return;
  const o=drag.original,origSpd=clipSpeed(o),sourceLen=Math.max(frame,o.end-o.start),origWidth=sourceLen/origSpd;
  const direction=drag.side==='speed-left'?-1:1;
  const d=direction*(e.clientX-drag.x)/Math.max(1,drag.trackWidth)*drag.originalDuration;
  const minW=Math.max(frame,sourceLen/4),maxW=sourceLen/0.25;
  const targetWidth=clamp(origWidth+d,minW,maxW);
  const rawSpeed=sourceLen/targetWidth;
  const step=e.shiftKey?0.25:0.05;
  let nextSpeed=Math.round(rawSpeed/step)*step;
  if(!e.shiftKey&&Math.abs(nextSpeed-1)<0.035)nextSpeed=1;
  nextSpeed=Number(clamp(nextSpeed,0.25,4).toFixed(2));
  clips=drag.originalClips.map(item=>({...item}));
  const target=clips[drag.i];
  if(!target)return;
  target.speed=nextSpeed;
  const newWidth=width(target),delta=newWidth-origWidth,oldEnd=o.at+origWidth;
  clips.forEach((other,idx)=>{
   if(idx!==drag.i&&drag.originalClips[idx].at>=oldEnd-0.0001){
    other.at=Math.max(0,drag.originalClips[idx].at+delta);
   }
  });
  if(typeof annotations.restore==='function'&&Array.isArray(drag.originalAnnotations)){
   annotations.restore(drag.originalAnnotations);
  }
  annotations.shiftTiming?.(o.at,delta,oldEnd,newWidth/origWidth);
  syncDuration();
  if(drag.originalPlayhead>=o.at&&drag.originalPlayhead<=oldEnd){
   playhead=o.at+(drag.originalPlayhead-o.at)*(origSpd/nextSpeed);
  }else if(drag.originalPlayhead>oldEnd){
   playhead=Math.max(0,drag.originalPlayhead+delta);
  }else{
   playhead=drag.originalPlayhead;
  }
  playhead=clamp(playhead,0,duration);
  playingClip=locate(playhead);
  if('playbackRate' in video)video.playbackRate=clipSpeed(clips[playingClip]);
  drag.changed=drag.changed||Math.abs(nextSpeed-origSpd)>1e-4;
  render();
  return;
 }
 const c=clips[drag.i];if(!c)return;
 const spd=clipSpeed(c),d=(e.clientX-drag.x)/drag.trackWidth*drag.originalDuration,o=drag.original;
 const others=clips.filter((_,i)=>i!==drag.i);
 const left=Math.max(0,...others.filter(x=>end(x)<=o.at+0.0001).map(end));
 const right=Math.min(Math.max(metadataDuration,duration),...others.filter(x=>x.at>=end(o)-0.0001).map(x=>x.at));
 if(drag.side==='left'){
  const shift=clamp(d,Math.max(left-o.at,-o.start/spd),width(o)-frame);
  c.start=o.start+shift*spd;c.at=o.at+shift;
 }else if(drag.side==='right'){
  const nextClip=others.filter(x=>x.at>=end(o)-0.0001).sort((a,b)=>a.at-b.at)[0];
  const rightBound=nextClip?(nextClip.at-end(o)):(metadataDuration-o.end)/spd;
  const shift=clamp(d,-width(o)+frame,Math.min(rightBound,(metadataDuration-o.end)/spd));
  c.end=o.end+shift*spd;
  syncDuration();
 }else{
  c.at=clamp(o.at+d,left,right-width(o));
 }
 drag.changed=true;render();
};
window.addEventListener('pointerup',()=>{if(!drag)return;if(drag.side?.startsWith('speed-')&&!drag.changed){drag=null;return}if(drag.changed&&drag.before)pushHistory(drag.before);if(drag.changed&&drag.side==='left'){normalizeStart();setTime(clips[drag.i].at)}else if(drag.changed&&drag.side.startsWith('speed-')){setTime(clamp(playhead,0,duration))}drag=null;syncDuration();render()});
window.addEventListener('pointercancel',()=>{if(drag&&drag.changed&&drag.before){clips=drag.before.clips.map(item=>({...item}));annotations.restore(drag.before.annotations||[]);if(Number.isFinite(drag.originalPlayhead))playhead=drag.originalPlayhead;syncDuration()}drag=null;render()});
function stepPlayback(){
 if(!video.paused&&!exporting&&clips.length){
  if(video.seeking){render();return}
  const c=clips[playingClip];
  if(c){
   const spd=clipSpeed(c);
   if('playbackRate' in video&&Math.abs(video.playbackRate-spd)>1e-4)video.playbackRate=spd;
   playhead=clamp(c.at+(video.currentTime-c.start)/spd,0,duration);
   if(video.currentTime>=c.end-0.015*spd){
    const next=clips.map((clip,i)=>({clip,i})).filter(x=>x.clip.at>=end(c)-0.001&&x.i!==playingClip).sort((a,b)=>a.clip.at-b.clip.at)[0];
    if(next){
     playingClip=next.i;playhead=next.clip.at;
     if('playbackRate' in video)video.playbackRate=clipSpeed(next.clip);
     video.currentTime=next.clip.start;
    }else{
     video.pause();playhead=end(c);
    }
   }
  }
 }
 render();
}
function handleVideoSeeked(){if(!video.paused&&!exporting)stepPlayback();else render()}
function startRaf(){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(rafId);if(!video.paused&&!exporting&&typeof requestAnimationFrame==='function'){const tick=()=>{stepPlayback();if(!video.paused&&!exporting)rafId=requestAnimationFrame(tick)};rafId=requestAnimationFrame(tick)}}
video.ontimeupdate=stepPlayback;
video.onseeked=handleVideoSeeked;
video.onended=()=>{
 if(exporting||!clips.length)return;
 const c=clips[playingClip];
 if(c){
  const next=clips.map((clip,i)=>({clip,i})).filter(x=>x.clip.at>=end(c)-0.001&&x.i!==playingClip).sort((a,b)=>a.clip.at-b.clip.at)[0];
  if(next){
   playingClip=next.i;playhead=next.clip.at;
   if('playbackRate' in video)video.playbackRate=clipSpeed(next.clip);
   video.currentTime=next.clip.start;
   video.play?.().catch(()=>{});
   render();
   return;
  }
  playhead=end(c);
 }else{
  playhead=timelineEnd();
 }
 render();
};
video.onplay=()=>{render();startRaf()};
video.onpause=()=>{if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(rafId);render()};
play.addEventListener('click',()=>{if(video.paused){status.textContent='';const last=timelineEnd();if(playhead>=last-frame)playhead=timelineStart();else{const c=clips[locate(playhead)];if(c&&playhead<c.at)playhead=c.at}setTime(playhead);video.play().catch(e=>{if(e.name!=='AbortError')status.textContent='Playback failed. Try playing the clip again.'})}else video.pause()});
function split(){const c=clips[selected],offset=playhead-c?.at,spd=clipSpeed(c),minLen=frame/spd;if(!c||offset<=minLen||offset>=width(c)-minLen)return;remember();const t=c.start+offset*spd;clips.splice(selected,1,{start:c.start,end:t,at:c.at,speed:spd},{start:t,end:c.end,at:playhead,speed:spd});selected++;playingClip=selected;render()}
function remove(){if(clips.length<=1){status.textContent='Keep at least one clip.';return}remember();clips.splice(selected,1);selected=Math.max(0,Math.min(selected,clips.length-1));normalizeStart();syncDuration();setTime(Math.min(playhead,timelineEnd()))}
$('split').addEventListener('click',split);$('delete').addEventListener('click',remove);
$('reset').addEventListener('click',()=>{video.pause();remember();clips=[{start:0,end:metadataDuration,at:0,speed:1}];cropEditor.reset();annotations.setDrawing(false);annotations.restore([]);selected=0;playingClip=0;duration=metadataDuration;drawRuler();setTime(0)});
function isTextEntry(target){if(!target)return false;const isEl=typeof Element==='undefined'?Boolean(target.tagName):target instanceof Element;if(!isEl)return false;if(target.isContentEditable||target.closest?.('.annotation-editor'))return true;if(target.tagName==='TEXTAREA'||target.tagName==='SELECT')return true;if(target.tagName==='INPUT'){const t=(target.getAttribute('type')||'text').toLowerCase();return !/^(range|button|checkbox|radio|submit|reset|color|file)$/.test(t)}return false}
function isDialogOpen(){return Boolean(document.querySelector?.('[role="dialog"][data-state="open"],[role="menu"][data-state="open"]'))}
async function confirmAction(opts){
 if(typeof window.sightlineConfirm==='function')return await window.sightlineConfirm(opts);
 return confirm(opts.description||opts.title);
}
['title','url','notes','category'].forEach(fieldId=>{const el=$(fieldId);if(el?.addEventListener){el.addEventListener('input',()=>{if(loaded)dirty=true});el.addEventListener('change',()=>{if(loaded)dirty=true})}});
const tagPills=$('tag-pills');
if(tagPills&&typeof MutationObserver!=='undefined'){new MutationObserver(()=>{if(loaded)dirty=true}).observe(tagPills,{childList:true})}
window.addEventListener('beforeunload',e=>{if(dirty&&!exporting){e.preventDefault();e.returnValue=''}});
window.addEventListener('pointerdown',e=>{const active=document.activeElement;if(!isTextEntry(active))return;const t=e.target;if(t instanceof Element&&t.closest('input:not([type="range"]),textarea,select,.tags-field,.tag-suggestions,.annotation-editor,[contenteditable="true"]'))return;if(active instanceof HTMLElement)active.blur()},true);
window.addEventListener('keydown',e=>{if(exporting||isDialogOpen()||e.code!=='Space'||e.ctrlKey||e.metaKey||e.altKey)return;if(isTextEntry(e.target))return;e.preventDefault();e.stopPropagation();if(!e.repeat)play.click()},true);
window.addEventListener('keyup',e=>{if(exporting||isDialogOpen()||e.code!=='Space'||e.ctrlKey||e.metaKey||e.altKey)return;if(isTextEntry(e.target))return;e.preventDefault();e.stopPropagation()},true);
window.addEventListener('keydown',e=>{
 if(exporting||isDialogOpen())return;
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.code==='Backquote'){e.preventDefault();toggleTimeline();return}
 if(e.key==='Escape'&&!e.defaultPrevented&&isTextEntry(e.target)&&!e.target.closest?.('.annotation-editor')){e.preventDefault();if(e.target instanceof HTMLElement)e.target.blur();return}
 if(isTextEntry(e.target))return;
 const c=clips[selected];
 if((e.ctrlKey||e.metaKey)&&(e.code==='KeyZ'||e.code==='KeyY')){e.preventDefault();undo(e.code==='KeyY'||e.shiftKey);return}
 if(e.key==='?'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();window.dispatchEvent?.(new CustomEvent('sightline:shortcuts'));return}
 if(/BUTTON|SUMMARY/.test(e.target.tagName))return;
 if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&e.code==='KeyC'){e.preventDefault();toggleCrop()}
 else if(e.key==='Escape'&&!e.defaultPrevented&&cropEditor.isActive?.()){e.preventDefault();cropEditor.setActive(false)}
 else if(e.ctrlKey&&e.altKey&&e.code==='KeyB'){e.preventDefault();split()}
 else if(e.ctrlKey&&e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();video.pause();setTime(e.key==='ArrowLeft'?timelineStart():timelineEnd())}
 else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.code==='KeyQ'||e.code==='KeyW')){const offset=playhead-c?.at,spd=clipSpeed(c),minLen=frame/spd;e.preventDefault();if(c&&offset>minLen&&offset<width(c)-minLen){remember();if(e.code==='KeyQ'){c.start+=offset*spd;c.at+=offset;normalizeStart();syncDuration();setTime(c.at)}else{c.end=c.start+offset*spd;syncDuration();setTime(end(c))}}}
 else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove()}
 else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();video.pause();setTime(playhead+(e.key==='ArrowRight'?1:-1)*frame*(e.shiftKey?10:1))}
 else if(e.key==='Home'||e.key==='End'){e.preventDefault();video.pause();setTime(e.key==='Home'?timelineStart():timelineEnd())}
});
let metadataDuration=0;
readRecording(id).then(async value=>{
 if(!value)throw Error('Recording not found.');
 metadata=value;
 if(typeof loadSourceDefaults==='function')await loadSourceDefaults(value.url);
 $('title').value=value.title||'';
 $('url').value=value.url||'';
 if(value.state==='partial'||value.state==='recording')status.textContent='This recording may be incomplete.';
 sourceUrl=URL.createObjectURL(value.blob);
 video.src=sourceUrl;
 $('source').textContent=value.title||'Recording';
 setTimeout(()=>{loaded=true},100);
}).catch(e=>{status.textContent=String(e);save.disabled=true});
video.onloadedmetadata=()=>{
 if(!Number.isFinite(video.duration)){
  const resolveDuration=()=>{
   if(Number.isFinite(video.duration)){
    video.ontimeupdate=stepPlayback;
    video.ondurationchange=null;
    video.onseeked=handleVideoSeeked;
    init();
   }
  };
  video.ondurationchange=resolveDuration;
  video.ontimeupdate=resolveDuration;
  video.onseeked=resolveDuration;
  video.currentTime=1e10;
 }else init();
};
function init(){if(initialized)return;video.pause?.();duration=metadataDuration=video.duration;if(!Number.isFinite(duration)||duration<=0){status.textContent='Could not read recording duration.';save.disabled=true;return}initialized=true;save.disabled=false;clips=[{start:0,end:duration,at:0,speed:1}];selected=0;drawRuler();setTime(0)}
save.onclick=async()=>{
 if(!clips.length||exporting)return;
 if(annotations.hasOmitted()&&!await confirmAction({title:'Save with omitted annotations?',description:'Some annotations are outside the selected crop or clips and will not be saved. Continue?',confirmLabel:'Continue',destructive:false}))return;
 exporting=true;save.disabled=true;video.pause();
 let tempUrl='';
 try{
  const sortedClips=[...clips].sort((a,b)=>a.at-b.at);
  const hasSpeedChange=sortedClips.some(c=>Math.abs(clipSpeed(c)-1)>1e-4);
  let exportUrl=sourceUrl;
  let segments=sortedClips.map(c=>({start:c.start,end:c.end}));
  if(hasSpeedChange){
   if(typeof renderSpeedAdjustedWebm!=='function')throw Error('Speed export module is unavailable.');
   status.textContent='Applying speed adjustments…';
   const retimed=await renderSpeedAdjustedWebm(
    sourceUrl,
    sortedClips.map(c=>({start:c.start,end:c.end,speed:clipSpeed(c)})),
    {width:video.videoWidth,height:video.videoHeight},
    pct=>{status.textContent=`Applying speed adjustments… ${Math.round(pct*100)}%`}
   );
   if(!Number.isFinite(retimed?.duration)||retimed.duration<=0)throw Error('Could not determine retimed clip duration.');
   tempUrl=URL.createObjectURL(retimed.blob);
   exportUrl=tempUrl;
   segments=[{start:0,end:retimed.duration}];
  }
  status.textContent='Sending and rendering your clip…';
  const result=await chrome.runtime.sendMessage({
   type:'save-clip',
   data:exportUrl,
   title:$('title').value.trim(),
   url:$('url').value.trim(),
   annotations:annotations.export(),
   tags:window.captureTags.values(),
   notes:document.getElementById('notes').value,
   category:$('category').value,
   segments,
   crop:(()=>{const r=cropEditor.get();return (cropEditor.isFull?cropEditor.isFull():(r.x===0&&r.y===0&&r.w===1&&r.h===1))?null:r})()
  });
  if(!result)throw Error('No response from Sightline. Reload the extension and try again.');
  if(result.error)throw Error(result.error);
  dirty=false;
  status.textContent='';
  showToast('Clip saved',result.id?'Open it or find it in Sightline.':'Sightline will import it while open.',result.id?{actionLabel:'Open clip',onAction:async()=>{const openRes=await chrome.runtime.sendMessage({type:'open-asset',id:result.id});if(openRes?.error)throw Error(openRes.error)}}:undefined);
 }catch(e){
  status.textContent='';
  showToast('Could not save clip',e.message||String(e),true);
 }finally{
  if(tempUrl)URL.revokeObjectURL(tempUrl);
  exporting=false;save.disabled=false;
 }
};
$('discard').onclick=async()=>{
 const msg=dirty?'Discard your unsaved edits and close this tab? Your original recording in Saved recordings will be kept.':'Close this recording tab without saving? Your original recording in Saved recordings will be kept.';
 if(!await confirmAction({title:'Discard edits?',description:msg,confirmLabel:'Discard',destructive:false}))return;
 dirty=false;
 if(sourceUrl)URL.revokeObjectURL(sourceUrl);
 window.close();
};
