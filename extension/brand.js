const menu=document.querySelector('.category-menu');
if(menu){const field=document.getElementById('category'),label=document.getElementById('category-label');menu.querySelectorAll('[data-value]').forEach(button=>button.addEventListener('click',()=>{field.value=button.dataset.value;field.dataset.changed='true';label.textContent=field.value;menu.open=false;label.focus()}));document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.open=false});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;label.focus()}})}
let dismissToast;
function showToast(title,detail,{tone='success',actionLabel,onAction,closeTab=false}={}){
 const toast=document.getElementById('toast');
 if(!toast)return;
 dismissToast?.(true);
 const duration=5000;
 const exitDuration=180;
 let remaining=duration,startedAt=null,timer,exitTimer,hovered=false,focused=false,shown=false;

 const body=document.createElement('div');
 body.className='toast-body';
 const strong=document.createElement('strong');
 strong.textContent=title;
 const description=document.createElement('span');
 description.textContent=detail;
 body.append(strong,description);
 if(onAction||closeTab){
  const actions=document.createElement('div');
  actions.className='toast-actions';
  if(onAction){
   const open=document.createElement('button');
   open.type='button';
   open.className='toast-action';
   open.textContent=actionLabel;
   open.onclick=async()=>{
    open.disabled=true;
    open.textContent='Opening…';
    try{
     await onAction();
     if(dismissToast===dismiss)dismiss();
    }catch(error){
     if(dismissToast===dismiss)showToast('Could not open saved item',error.message||String(error),{tone:'error'});
    }
   };
   actions.append(open);
  }
  if(closeTab){
   const close=document.createElement('button');
   close.type='button';
   close.className='toast-action-secondary';
   close.textContent='Close tab';
   close.setAttribute('aria-label','Close editing tab');
   close.onclick=()=>window.close();
   actions.append(close);
  }
  body.append(actions);
 }
 const dismissButton=document.createElement('button');
 dismissButton.type='button';
 dismissButton.className='toast-close';
 dismissButton.setAttribute('aria-label','Dismiss notification');
 dismissButton.textContent='×';
 dismissButton.onclick=()=>dismiss();

 const progress=document.createElement('div');
 progress.className='toast-progress';
 progress.setAttribute('aria-hidden','true');
 const bar=document.createElement('div');
 bar.className='toast-progress-bar';
 progress.append(bar);
 toast.setAttribute('role',tone==='error'?'alert':'status');
 toast.setAttribute('aria-live',tone==='error'?'assertive':'polite');
 toast.style.setProperty('--toast-duration',`${duration}ms`);
 toast.replaceChildren(body,dismissButton,progress);
 toast.className=`tone-${tone}`;

 function clear(){
  toast.className='';
  toast.replaceChildren();
  if(dismissToast===dismiss)dismissToast=undefined;
 }
 function dismiss(immediate=false){
  clearTimeout(timer);
  clearTimeout(exitTimer);
  document.removeEventListener('visibilitychange',syncCountdown);
  toast.onpointerenter=toast.onpointerleave=toast.onfocusin=toast.onfocusout=null;
  if(immediate)clear();
  else{
   toast.classList.add('closing');
   exitTimer=setTimeout(clear,exitDuration);
  }
 }
 function syncCountdown(){
  if(document.hidden&&shown){
   dismiss(true);
   return;
  }
  if(!document.hidden){
   shown=true;
   toast.classList.add('visible');
  }
  const paused=document.hidden||hovered||focused;
  toast.classList.toggle('paused',paused);
  if(paused&&startedAt!==null){
   remaining=Math.max(0,remaining-(performance.now()-startedAt));
   startedAt=null;
   clearTimeout(timer);
  }else if(!paused&&startedAt===null){
   startedAt=performance.now();
   timer=setTimeout(dismiss,remaining);
  }
 }
 toast.onpointerenter=()=>{hovered=true;syncCountdown()};
 toast.onpointerleave=()=>{hovered=false;syncCountdown()};
 toast.onfocusin=()=>{focused=true;syncCountdown()};
 toast.onfocusout=event=>{if(!toast.contains(event.relatedTarget)){focused=false;syncCountdown()}};
 document.addEventListener('visibilitychange',syncCountdown);
 dismissToast=dismiss;
 syncCountdown();
}

function showSavedAssetToast(asset,id,duplicate=false){
 const title=duplicate?'Already saved':`${asset[0].toUpperCase()}${asset.slice(1)} saved`;
 const itemTitle=document.getElementById('title')?.value?.trim()||'';
 const detail=duplicate?`Edit the ${asset} to save a new version.`:id?itemTitle:'Sightline will import it while open.';
 showToast(title,detail,{
  tone:duplicate?'warning':'success',
  closeTab:true,
  actionLabel:`Open ${asset}`,
  onAction:id?async()=>{
   const result=await chrome.runtime.sendMessage({type:'open-asset',id});
   if(result?.error)throw Error(result.error);
  }:undefined,
 });
}

async function loadSourceDefaults(url){
 if(!url)return;
 try{
  const result=await chrome.runtime.sendMessage({type:'library-tags',url});
  if(result?.source){
   if(Array.isArray(result.source.tags))window.captureTags?.setDefaults(result.source.tags);
   const category=document.getElementById('category'),label=document.getElementById('category-label');
   if(category&&!category.dataset.changed&&['Web design','Illustration','Motion graphics','Other','Post Ideas'].includes(result.source.category)){
    category.value=result.source.category;
    category.dispatchEvent?.(new Event('sightline:sync-value'));
    if(label)label.textContent=category.value;
   }
  }
 }catch{}
}
