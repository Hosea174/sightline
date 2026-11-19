function createCropEditor(overlay, onChange, onCommit) {
 let rect={x:0,y:0,w:1,h:1}, drag=null, active=false;
 overlay.innerHTML='<div class="crop-selection" tabindex="0" aria-label="Move crop selection"><span class="crop-grid"></span>'+['nw','n','ne','e','se','s','sw','w'].map(side=>`<button type="button" class="crop-handle ${side}" data-side="${side}" aria-label="Resize crop ${side}"></button>`).join('')+'</div><div class="crop-shade" aria-hidden="true"><div class="crop-hole"></div></div>';
 const selection=overlay.firstElementChild, hole=overlay.lastElementChild.firstElementChild, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const isFull=(r=rect)=>Math.abs(r.x)<1e-6&&Math.abs(r.y)<1e-6&&Math.abs(r.w-1)<1e-6&&Math.abs(r.h-1)<1e-6;
 function draw(){
  const full=isFull();
  const box={left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'};
  Object.assign(selection.style,box);
  Object.assign(hole.style,box);
  overlay.classList.toggle('crop-active',active);
  overlay.classList.toggle('crop-cropped',!full);
  overlay.hidden=!active&&full;
  overlay.style.pointerEvents=active?'':'none';
  onChange?.({...rect},{active,full});
 }
 function set(value){rect={...value};draw()}
 function setActive(next){active=Boolean(next);draw()}
 function adjust(original,side,dx,dy){let {x,y,w,h}=original;const min=.01;if(side==='move'){x=clamp(x+dx,0,1-w);y=clamp(y+dy,0,1-h)}else{if(side.includes('w')){const next=clamp(x+dx,0,x+w-min);w+=x-next;x=next}if(side.includes('e'))w=clamp(w+dx,min,1-x);if(side.includes('n')){const next=clamp(y+dy,0,y+h-min);h+=y-next;y=next}if(side.includes('s'))h=clamp(h+dy,min,1-y)}return {x,y,w,h}}
 overlay.addEventListener('pointerdown',e=>{
  if(!active||e.button!==0)return;
  const side=e.target.dataset.side||'move';
  if(!selection.contains(e.target)&&!overlay.contains(e.target))return;
  e.preventDefault();
  const bounds=overlay.getBoundingClientRect();
  const px=bounds.width?clamp((e.clientX-bounds.left)/bounds.width,0,1):0;
  const py=bounds.height?clamp((e.clientY-bounds.top)/bounds.height,0,1):0;
  const drawMode=side==='move'&&(isFull(rect)||!selection.contains(e.target));
  drag={pointerId:e.pointerId,side,drawMode,startX:px,startY:py,x:e.clientX,y:e.clientY,original:{...rect}};
  overlay.setPointerCapture(e.pointerId);
 });
 overlay.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pointerId)return;
  if(e.buttons===0&&e.pointerType==='mouse'){endDrag(true);return}
  const bounds=overlay.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  if(drag.drawMode){
   const px=clamp((e.clientX-bounds.left)/bounds.width,0,1);
   const py=clamp((e.clientY-bounds.top)/bounds.height,0,1);
   const w=Math.abs(px-drag.startX),h=Math.abs(py-drag.startY);
   if(w>.015&&h>.015){
    set({x:Math.min(drag.startX,px),y:Math.min(drag.startY,py),w,h});
   }else{
    set(drag.original);
   }
   return;
  }
  set(adjust(drag.original,drag.side,(e.clientX-drag.x)/bounds.width,(e.clientY-drag.y)/bounds.height));
 });
 function endDrag(commit=true){
  if(!drag)return;
  const d=drag;drag=null;
  try{if(d.pointerId!=null&&overlay.hasPointerCapture?.(d.pointerId))overlay.releasePointerCapture(d.pointerId)}catch{}
  if(commit&&JSON.stringify(d.original)!==JSON.stringify(rect))onCommit?.(d.original);
  else if(!commit)set(d.original);
 }
 overlay.addEventListener('pointerup',e=>{if(drag&&e.pointerId!==drag.pointerId)return;endDrag(true)});
 overlay.addEventListener('lostpointercapture',e=>{if(drag&&e.pointerId===drag.pointerId)endDrag(true)});
 overlay.addEventListener('pointercancel',()=>endDrag(false));
 window.addEventListener('blur',()=>endDrag(true));
 window.addEventListener('keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopPropagation();endDrag(false)}},true);
 overlay.addEventListener('keydown',e=>{if(!active||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const before={...rect},step=e.shiftKey?.05:.01,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;set(adjust(before,e.target.dataset.side||'move',dx,dy));onCommit?.(before)});
 draw();
 return {get:()=>({...rect}),set,reset:()=>{rect={x:0,y:0,w:1,h:1};active=false;draw()},setActive,isActive:()=>active,isFull:()=>isFull()};
}
