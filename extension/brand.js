const menu=document.querySelector('.category-menu');
if(menu){const field=document.getElementById('category'),label=document.getElementById('category-label');menu.querySelectorAll('[data-value]').forEach(button=>button.addEventListener('click',()=>{field.value=button.dataset.value;field.dataset.changed='true';label.textContent=field.value;menu.open=false;label.focus()}));document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.open=false});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;label.focus()}})}
let toastTimer;
function showToast(title,detail,errorOrOptions=false){
 const toast=document.getElementById('toast');
 if(!toast)return;
 const opts=typeof errorOrOptions==='object'&&errorOrOptions!==null?errorOrOptions:{error:Boolean(errorOrOptions)};
 const error=Boolean(opts.error);
 toast.replaceChildren();
 const mark=document.createElement('span');
 mark.className='toast-mark';
 mark.textContent=error?'!':'✓';
 const body=document.createElement('div');
 body.className='toast-body';
 const strong=document.createElement('strong');
 strong.textContent=title;
 const small=document.createElement('span');
 small.textContent=detail;
 body.append(strong,small);
 if(opts.actionLabel&&typeof opts.onAction==='function'){
  const actions=document.createElement('div');
  actions.className='toast-actions';
  const actionBtn=document.createElement('button');
  actionBtn.type='button';
  actionBtn.className='toast-action';
  actionBtn.textContent=opts.actionLabel;
  actionBtn.onclick=async()=>{
   if(actionBtn.disabled)return;
   actionBtn.disabled=true;
   const prevText=actionBtn.textContent;
   actionBtn.textContent='Opening…';
   try{
    await opts.onAction();
    toast.className='';
   }catch(err){
    actionBtn.disabled=false;
    actionBtn.textContent=prevText;
    showToast('Could not open saved item',err?.message||String(err),true);
   }
  };
  actions.append(actionBtn);
  body.append(actions);
 }
 const closeBtn=document.createElement('button');
 closeBtn.type='button';
 closeBtn.className='toast-close';
 closeBtn.setAttribute('aria-label','Dismiss notification');
 closeBtn.textContent='×';
 closeBtn.onclick=()=>{clearTimeout(toastTimer);toast.className=''};
 toast.append(mark,body,closeBtn);
 toast.className=error?'visible error':'visible';
 const timeoutMs=typeof opts.duration==='number'?opts.duration:(opts.actionLabel?12000:5000);
 const scheduleHide=()=>{clearTimeout(toastTimer);if(timeoutMs>0)toastTimer=setTimeout(()=>toast.className='',timeoutMs)};
 toast.onpointerenter=()=>clearTimeout(toastTimer);
 toast.onpointerleave=scheduleHide;
 scheduleHide();
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
