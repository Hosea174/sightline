function createCropEditor(overlay, onChange, onCommit) {
 let rect={x:0,y:0,w:1,h:1}, drag=null;
 overlay.innerHTML='<div class="crop-selection" tabindex="0" aria-label="Move crop selection"><span class="crop-grid"></span>'+['nw','n','ne','e','se','s','sw','w'].map(side=>`<button type="button" class="crop-handle ${side}" data-side="${side}" aria-label="Resize crop ${side}"></button>`).join('')+'</div><div class="crop-shade" aria-hidden="true"><div class="crop-hole"></div></div>';
 const selection=overlay.firstElementChild, hole=overlay.lastElementChild.firstElementChild, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function draw(){const box={left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'};Object.assign(selection.style,box);Object.assign(hole.style,box);onChange?.({...rect})}
 function set(value){rect={...value};draw()}
 function adjust(original,side,dx,dy){let {x,y,w,h}=original;const min=.01;if(side==='move'){x=clamp(x+dx,0,1-w);y=clamp(y+dy,0,1-h)}else{if(side.includes('w')){const next=clamp(x+dx,0,x+w-min);w+=x-next;x=next}if(side.includes('e'))w=clamp(w+dx,min,1-x);if(side.includes('n')){const next=clamp(y+dy,0,y+h-min);h+=y-next;y=next}if(side.includes('s'))h=clamp(h+dy,min,1-y)}return {x,y,w,h}}
 overlay.addEventListener('pointerdown',e=>{if(e.button!==0)return;const side=e.target.dataset.side||'move';if(!selection.contains(e.target))return;e.preventDefault();drag={side,x:e.clientX,y:e.clientY,original:{...rect}};overlay.setPointerCapture(e.pointerId)});
 overlay.addEventListener('pointermove',e=>{if(!drag)return;const bounds=overlay.getBoundingClientRect();set(adjust(drag.original,drag.side,(e.clientX-drag.x)/bounds.width,(e.clientY-drag.y)/bounds.height))});
 overlay.addEventListener('pointerup',()=>{if(!drag)return;const before=drag.original;drag=null;if(JSON.stringify(before)!==JSON.stringify(rect))onCommit?.(before)});
 overlay.addEventListener('pointercancel',()=>{if(drag){set(drag.original);drag=null}});
 overlay.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const before={...rect},step=e.shiftKey?.05:.01,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;set(adjust(before,e.target.dataset.side||'move',dx,dy));onCommit?.(before)});
 draw();return {get:()=>({...rect}),set,reset:()=>set({x:0,y:0,w:1,h:1})};
}
