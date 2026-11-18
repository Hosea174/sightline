function createAnnotations(frame, media, getCrop, getSegments, seek, timeline, onMutate, onModeChange) {
 const layer=document.createElement('div');layer.className='annotation-layer';frame.append(layer);
 // Crop and annotation coordinates must use the visible media, not its flex container.
 const overlay=frame.querySelector('.crop-overlay');
 function alignOverlays(){const f=frame.getBoundingClientRect(),r=media.getBoundingClientRect();let width=r.width,height=r.height;const iw=media.videoWidth||media.width,ih=media.videoHeight||media.height;if(iw&&ih){const scale=Math.min(width/iw,height/ih);width=iw*scale;height=ih*scale}const bounds={left:(r.left-f.left+(r.width-width)/2)+'px',top:(r.top-f.top+(r.height-height)/2)+'px',width:width+'px',height:height+'px',right:'auto',bottom:'auto'};Object.assign(layer.style,bounds);Object.assign(overlay.style,bounds)}
 new ResizeObserver(alignOverlays).observe(media);media.addEventListener('loadedmetadata',alignOverlays);media.addEventListener('load',alignOverlays);alignOverlays();
 const toolbar=document.createElement('div');toolbar.className='annotation-tools';toolbar.innerHTML='<button type="button" class="quiet icon-button annotation-toggle" data-action="add" aria-pressed="false" title="Add annotation (A or Ctrl+Shift+.)" aria-label="Add annotation (A or Ctrl+Shift+.)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button><button type="button" class="quiet icon-button" data-action="show" aria-pressed="true" title="Hide annotations (H)" aria-label="Hide annotations (H)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>';frame.closest('.preview').querySelector('.edit-actions').append(toolbar);
 const list=document.createElement('div');list.className='annotation-list';document.querySelector('aside').append(list);
 let items=[],enabled=false,visible=true,start=null,dragging=false,timelineSignature='',listSignature='',layerSignature='';const lanes=timeline?document.createElement('div'):null;if(lanes){lanes.className='annotation-lanes';document.querySelector('.timeline-scroll').insertBefore(lanes,document.getElementById('track'))}const add=toolbar.querySelector('[data-action=add]'),show=toolbar.querySelector('[data-action=show]');

 function isAnnotationToggleShortcut(e){
  return Boolean((e.ctrlKey||e.metaKey)&&e.shiftKey&&!e.altKey&&(e.key==='.'||e.key==='>'||e.code==='Period'));
 }

 function syncButtons(){
  add.setAttribute('aria-pressed',String(enabled));
  add.title=enabled?'Finish annotating (A or Ctrl+Shift+.)':'Add annotation (A or Ctrl+Shift+.)';
  add.setAttribute('aria-label',add.title);
  show.setAttribute('aria-pressed',String(visible));
  show.title=visible?'Hide annotations (H)':'Show annotations (H)';
  show.setAttribute('aria-label',show.title);
 }

 function setDrawing(next){
  const target=Boolean(next);
  if(enabled===target)return;
  enabled=target;
  if(enabled){visible=true;media.pause?.();onModeChange?.(true)}
  syncButtons();
  render();
 }

 function renderMarks(){
  layer.classList.toggle('drawing',enabled);
  layer.hidden=!visible&&!enabled;
  if(overlay)overlay.classList.toggle('annotating',enabled);
  const nextListSig=JSON.stringify(items);
  if(nextListSig!==listSignature){
   listSignature=nextListSig;
   list.replaceChildren();
   if(!items.length){
    const empty=document.createElement('p');empty.className='annotation-empty';empty.textContent='No annotations yet';list.append(empty);
   }else{
    items.forEach((item,i)=>{
     const row=document.createElement('div');row.className='annotation-row';
     const open=document.createElement('button');open.type='button';open.className='annotation-row-open';
     const num=document.createElement('span');num.className='annotation-row-num';num.textContent=String(i+1);
     const body=document.createElement('span');body.className='annotation-row-text';body.textContent=item.text;
     open.append(num,body);
     if(item.start!=null){
      const time=document.createElement('span');time.className='annotation-row-time';time.textContent=`${item.start.toFixed(1)}–${item.end.toFixed(1)}s`;
      open.append(time);
     }
     open.onclick=()=>{if(item.start!=null){media.pause();if(timeline)timeline.seek(item.start);else if(seek)seek(item.start);else media.currentTime=item.start}edit(item)};
     const del=document.createElement('button');del.type='button';del.className='annotation-row-delete';del.setAttribute('aria-label',`Delete annotation ${i+1}`);del.title='Delete annotation';del.textContent='×';
     del.onclick=()=>{onMutate?.();items=items.filter(a=>a!==item);if(editor)closeEditor();render()};
     row.append(open,del);list.append(row);
    });
   }
  }
  const now=timeline?timeline.now():0;
  const visibleItems=visible?items.map((item,i)=>({item,i})).filter(({item})=>item.start==null||(now>=item.start-0.001&&now<=item.end+0.001)):[];
  const nextLayerSig=JSON.stringify([visible,visibleItems.map(({item,i})=>[i,item.id,item.x,item.y,item.w,item.h,item.text])]);
  if(nextLayerSig===layerSignature)return;
  layerSignature=nextLayerSig;
  layer.replaceChildren();
  visibleItems.forEach(({item,i})=>{
   const mark=document.createElement('button');mark.type='button';mark.className='annotation-mark'+(item.w&&item.h?' area':'');
   Object.assign(mark.style,{left:item.x*100+'%',top:item.y*100+'%',width:item.w?item.w*100+'%':'',height:item.h?item.h*100+'%':''});
   mark.textContent=String(i+1);mark.title=item.text;
   let drag=null,suppressClick=false;
   if(item.w&&item.h){const handle=document.createElement('span');handle.className='annotation-resize';mark.append(handle)}
   mark.onpointerdown=e=>{e.stopPropagation();if(!item.w||!item.h||e.button!==0)return;media.pause?.();const rect=layer.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,width:rect.width,height:rect.height,resize:e.target.classList.contains('annotation-resize'),original:{...item},moved:false};mark.setPointerCapture(e.pointerId)};
   mark.onpointermove=e=>{if(!drag)return;const dx=(e.clientX-drag.x)/drag.width,dy=(e.clientY-drag.y)/drag.height,o=drag.original;if(!drag.moved&&Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>3){drag.moved=true;onMutate?.()}if(!drag.moved)return;if(drag.resize){item.w=Math.max(.01,Math.min(1-o.x,o.w+dx));item.h=Math.max(.01,Math.min(1-o.y,o.h+dy))}else{item.x=Math.max(0,Math.min(1-o.w,o.x+dx));item.y=Math.max(0,Math.min(1-o.h,o.y+dy))}Object.assign(mark.style,{left:item.x*100+'%',top:item.y*100+'%',width:item.w*100+'%',height:item.h*100+'%'})};
   mark.onpointerup=e=>{if(!drag)return;e.stopPropagation();suppressClick=drag.moved;drag=null;if(suppressClick)render()};
   mark.onpointercancel=()=>{if(drag)Object.assign(item,drag.original);drag=null;render()};
   mark.onclick=e=>{e.stopPropagation();if(suppressClick){suppressClick=false;return}edit(item)};
   layer.append(mark);
  });
 }

 function render(){renderTimeline();renderMarks()}

 let editor=null;
 function closeEditor(){editor?.remove();editor=null}
 function edit(item,isNew=false){
  if(editor)editor.remove();
  media.pause?.();
  editor=document.createElement('form');editor.className='annotation-editor';editor.setAttribute('aria-label',isNew?'New annotation':'Edit annotation');
  const timed=Boolean(timeline&&item.start!=null);
  editor.innerHTML='<div class="annotation-editor-heading"><strong></strong><button type="button" class="annotation-editor-close" aria-label="Close">&times;</button></div><textarea aria-label="Annotation note" placeholder="What caught your eye?" required></textarea>'+(timed?'<div class="annotation-editor-timing"><label>Start <input type="number" step="0.1" min="0" class="annotation-start" aria-label="Annotation start time in seconds"><span>s</span></label><label>End <input type="number" step="0.1" min="0" class="annotation-end" aria-label="Annotation end time in seconds"><span>s</span></label></div>':'')+'<div class="annotation-editor-actions"><button type="button" class="annotation-editor-delete">Delete</button><span></span><button type="button" class="annotation-editor-cancel">Cancel</button><button type="submit" class="annotation-editor-save">Save note</button></div>';
  editor.querySelector('strong').textContent=isNew?'New annotation':'Annotation';
  const field=editor.querySelector('textarea');field.value=item.text||'';
  const startInput=editor.querySelector('.annotation-start'),endInput=editor.querySelector('.annotation-end');
  if(timed&&startInput&&endInput){
   const limits=timeline.limits();
   startInput.min=limits.start.toFixed(2);startInput.max=limits.end.toFixed(2);startInput.value=item.start.toFixed(2);
   endInput.min=limits.start.toFixed(2);endInput.max=limits.end.toFixed(2);endInput.value=item.end.toFixed(2);
  }
  editor.style.left=`${Math.max(2,Math.min(98,item.x*100))}%`;
  editor.style.top=`${Math.max(2,Math.min(98,(item.y+(item.h||0))*100))}%`;
  editor.querySelector('.annotation-editor-close').onclick=closeEditor;
  editor.querySelector('.annotation-editor-cancel').onclick=closeEditor;
  editor.querySelector('.annotation-editor-delete').hidden=isNew;
  editor.querySelector('.annotation-editor-delete').onclick=()=>{onMutate?.();items=items.filter(a=>a!==item);closeEditor();render()};
  editor.onsubmit=e=>{
   e.preventDefault();
   const text=field.value.trim();
   if(!text){field.focus();return}
   onMutate?.();
   item.text=text;
   if(timed&&startInput&&endInput){
    const limits=timeline.limits();
    const usePlayhead=isNew&&startInput.value===item.start.toFixed(2)&&endInput.value===item.end.toFixed(2);
    const sVal=usePlayhead?timeline.now():parseFloat(startInput.value);
    const eVal=usePlayhead?limits.end:parseFloat(endInput.value);
    if(Number.isFinite(sVal)&&Number.isFinite(eVal)){
     const clamped=clampAnnotationRange({start:Math.min(sVal,eVal),end:Math.max(sVal,eVal)},limits);
     item.start=clamped.start;item.end=clamped.end;
    }
   }
   if(isNew)items.push(item);
   closeEditor();render();
  };
  editor.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeEditor()}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter')editor.requestSubmit()};
  document.body.append(editor);
  const rect=layer.getBoundingClientRect();
  const left=Math.max(8,Math.min(window.innerWidth-editor.offsetWidth-8,rect.left+item.x*rect.width));
  const top=Math.max(8,Math.min(window.innerHeight-editor.offsetHeight-8,rect.top+(item.y+(item.h||0))*rect.height+8));
  editor.style.left=left+'px';editor.style.top=top+'px';field.focus();
 }

 function point(e){const r=layer.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
 add.onclick=()=>{setDrawing(!enabled)};
 show.onclick=()=>{visible=!visible;enabled=false;syncButtons();render()};
 layer.onpointerdown=e=>{if(!enabled||e.button!==0)return;e.preventDefault();start=point(e);layer.setPointerCapture(e.pointerId)};
 layer.onpointermove=e=>{if(!start)return;const end=point(e);let box=layer.querySelector('.annotation-draft');if(!box){box=document.createElement('div');box.className='annotation-draft';layer.append(box)}Object.assign(box.style,{left:Math.min(start.x,end.x)*100+'%',top:Math.min(start.y,end.y)*100+'%',width:Math.abs(end.x-start.x)*100+'%',height:Math.abs(end.y-start.y)*100+'%'})};
 layer.onpointerup=e=>{
  if(!start)return;
  layer.querySelector('.annotation-draft')?.remove();
  const end=point(e),x=Math.min(start.x,end.x),y=Math.min(start.y,end.y),w=Math.abs(end.x-start.x),h=Math.abs(end.y-start.y);
  start=null;
  const limits=timeline?.limits();
  let timing={};
  if(limits){
   const span=Math.max(0,limits.end-limits.start);
   const minSpan=Math.min(0.5,span);
   const rawStart=Math.min(limits.end,Math.max(limits.start,timeline.now()));
   const safeStart=rawStart>limits.end-Math.min(0.1,span)?Math.max(limits.start,limits.end-minSpan):rawStart;
   timing={start:safeStart,end:limits.end};
  }
  edit({id:crypto.randomUUID(),x,y,w:w>.01&&h>.01?w:0,h:w>.01&&h>.01?h:0,text:'',...timing},true);
 };
 layer.onpointercancel=()=>{start=null;layer.querySelector('.annotation-draft')?.remove()};
 media.addEventListener('timeupdate',render);
 if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('keydown',e=>{
   if(e.defaultPrevented)return;
   const toggleShortcut=isAnnotationToggleShortcut(e);
   if(!toggleShortcut&&(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey))return;
   const t=e.target;
   if(t?.closest?.('.annotation-editor,[role="dialog"],[role="menu"],[role="listbox"],input:not([type="range"]),textarea,select,[contenteditable="true"]'))return;
   if(document.querySelector?.('[role="dialog"][data-state="open"],[role="menu"][data-state="open"]'))return;
   if(toggleShortcut){if(!e.repeat){e.preventDefault();setDrawing(!enabled)}return}
   if(e.code==='KeyA'){if(!e.repeat){e.preventDefault();setDrawing(!enabled)}}
   else if(e.code==='KeyH'){if(!e.repeat){e.preventDefault();show.click()}}
   else if(e.key==='Escape'&&enabled&&!editor){e.preventDefault();setDrawing(false)}
  });
 }
 syncButtons();
 render();

 function renderTimeline(){
  if(!lanes||dragging)return;
  const duration=timeline.duration();if(!duration)return;
  const limits=timeline.limits();
  for(const item of items)if(item.start!=null){Object.assign(item,clampAnnotationRange(item,limits))}
  const signature=JSON.stringify([items,limits,duration]);
  if(signature===timelineSignature)return;
  timelineSignature=signature;
  lanes.replaceChildren();
  items.forEach((item,i)=>{
   if(item.start==null)return;
   const lane=document.createElement('div');lane.className='annotation-lane';
   const bar=document.createElement('div');bar.className='annotation-clip';bar.tabIndex=0;bar.setAttribute('role','slider');
   bar.setAttribute('aria-label',`Annotation ${i+1}: ${item.text}. Arrow keys move; Shift and arrows resize the end; drag an edge to resize`);
   bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(duration));bar.setAttribute('aria-valuenow',item.start.toFixed(2));
   bar.title=`${item.text} - ${item.start.toFixed(2)} - ${item.end.toFixed(2)}s`;
   bar.style.left=(item.start/duration*100)+'%';bar.style.width=((item.end-item.start)/duration*100)+'%';
   bar.innerHTML='<span class="annotation-edge left" data-side="left"></span><span class="annotation-clip-label"></span><span class="annotation-edge right" data-side="right"></span>';
   bar.querySelector('.annotation-clip-label').textContent=`${i+1}. ${item.text}`;
   bar.onpointerdown=e=>{
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();media.pause();dragging=true;let pushed=false;
    const side=e.target.dataset.side||'move',origin=e.clientX,oldStart=item.start,oldEnd=item.end;
    bar.setPointerCapture(e.pointerId);
    bar.onpointermove=event=>{
     if(!pushed){pushed=true;onMutate?.()}
     const delta=(event.clientX-origin)/lane.getBoundingClientRect().width*duration,min=Math.min(.1,duration);
     if(side==='left')item.start=Math.max(limits.start,Math.min(oldEnd-min,oldStart+delta));
     else if(side==='right')item.end=Math.min(limits.end,Math.max(oldStart+min,oldEnd+delta));
     else{item.start=Math.max(limits.start,Math.min(limits.end-(oldEnd-oldStart),oldStart+delta));item.end=item.start+oldEnd-oldStart}
     bar.style.left=(item.start/duration*100)+'%';bar.style.width=((item.end-item.start)/duration*100)+'%';
     bar.title=`${item.text} - ${item.start.toFixed(2)} - ${item.end.toFixed(2)}s`;
     renderMarks();
    };
    bar.onpointerup=()=>{dragging=false;render()};
    bar.onpointercancel=()=>{item.start=oldStart;item.end=oldEnd;dragging=false;render()};
   };
   bar.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();onMutate?.();const delta=(e.key==='ArrowRight'?1:-1)*.1,length=item.end-item.start;if(e.shiftKey)item.end=Math.max(item.start+Math.min(.1,duration),Math.min(limits.end,item.end+delta));else{item.start=Math.max(limits.start,Math.min(limits.end-length,item.start+delta));item.end=item.start+length}render();lanes.children[i]?.querySelector('.annotation-clip')?.focus()};
   bar.ondblclick=()=>edit(item);
   lane.append(bar);lanes.append(lane);
  });
  lanes.hidden=!lanes.children.length;
 }

 return {
  snapshot:()=>items.map(item=>({...item})),
  restore:saved=>{items=saved.map(item=>({...item}));timelineSignature='';layerSignature='';listSignature='';render()},
  shiftTiming:(fromTime,delta,rangeEnd,scale=1)=>{
   let changed=false;
   items=items.map(item=>{
    if(item.start==null)return item;
    if(scale!==1&&rangeEnd!=null&&item.start<rangeEnd&&item.end>fromTime){
     changed=true;
     const nextStart=item.start<=fromTime?item.start:fromTime+(item.start-fromTime)*scale;
     const nextEnd=item.end>=rangeEnd?rangeEnd+(rangeEnd-fromTime)*(scale-1)+(item.end-rangeEnd):fromTime+(item.end-fromTime)*scale;
     return {...item,start:nextStart,end:Math.max(nextStart+0.05,nextEnd)};
    }
    if(delta!==0&&item.start>=fromTime-0.001){
     changed=true;
     return {...item,start:Math.max(0,item.start+delta),end:Math.max(0.05,item.end+delta)};
    }
    if(delta!==0&&item.end>fromTime){
     changed=true;
     return {...item,end:Math.max(item.start+0.05,item.end+delta)};
    }
    return item;
   });
   if(changed){timelineSignature='';layerSignature='';listSignature='';render()}
  },
  setDrawing,
  isDrawing:()=>enabled,
  count:()=>items.length,
  hasOmitted:()=>items.some(item=>!remapAnnotations([item],getCrop(),getSegments?.()).length),
  export:()=>remapAnnotations(items,getCrop(),getSegments?.()),
  renderTimeline,
  renderMarks
 };
}

function remapAnnotations(items,crop,segments){return items.flatMap(a=>{const x=Math.max(a.x,crop.x),y=Math.max(a.y,crop.y),right=Math.min(a.x+(a.w||0),crop.x+crop.w),bottom=Math.min(a.y+(a.h||0),crop.y+crop.h);if(a.w&&a.h?(right<=x||bottom<=y):(a.x<crop.x||a.x>crop.x+crop.w||a.y<crop.y||a.y>crop.y+crop.h))return [];const base={...a,x:(x-crop.x)/crop.w,y:(y-crop.y)/crop.h,w:a.w?(right-x)/crop.w:0,h:a.h?(bottom-y)/crop.h:0};if(!segments)return [base];let offset=0;const result=[];for(const segment of segments){const timelineStart=segment.at??offset, length=(segment.end-segment.start)/(segment.speed||1);let start=a.start,end=a.end;if(start==null&&a.time!=null){start=timelineStart+(a.time-segment.start)/(segment.speed||1);end=start+2}if(start!=null&&end!=null){const from=Math.max(start,timelineStart),to=Math.min(end,timelineStart+length);if(to>from){const id=result.length?`${a.id}-${result.length}`:a.id;const {time,...rest}=base;result.push({...rest,id,start:offset+from-timelineStart,end:offset+to-timelineStart})}}offset+=length}return result})}

function clampAnnotationRange(item,limits){const min=Math.min(.1,Math.max(0,limits.end-limits.start)),start=Math.max(limits.start,Math.min(item.start,limits.end-min)),end=Math.max(start+min,Math.min(item.end,limits.end));return {start,end}}
