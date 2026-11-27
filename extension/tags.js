(() => {
 const input=document.getElementById('tags'),container=document.getElementById('tag-pills'),suggestions=document.getElementById('tag-suggestions');
 let tags=[],known=[],activeIndex=-1;
 const optionByTag=new Map();
 const foldSeparators=s=>s.toLowerCase().replace(/[-_\s/.]+/g,' ').trim();
 const compactText=s=>s.toLowerCase().replace(/[-_\s/.]+/g,'');
 function scoreSubsequence(rawCandidate,compactCandidate,compactQuery){
  const isWordStart=[],lower=rawCandidate.toLowerCase();
  for(let idx=0;idx<lower.length;idx++){
   if(!/[-_\s/.]/.test(lower[idx]))isWordStart.push(idx===0||/[-_\s/.]/.test(lower[idx-1]));
  }
  const positions=[];let qi=0;
  for(let ci=0;ci<compactCandidate.length&&qi<compactQuery.length;ci++){
   if(compactCandidate[ci]===compactQuery[qi]){positions.push(ci);qi++}
  }
  if(qi<compactQuery.length)return 0;
  let boundaryHits=0,consecutive=0,maxConsecutive=0;
  for(let i=0;i<positions.length;i++){
   if(isWordStart[positions[i]])boundaryHits++;
   if(i>0&&positions[i]===positions[i-1]+1){consecutive++;if(consecutive>maxConsecutive)maxConsecutive=consecutive}
   else{consecutive=1;if(maxConsecutive===0)maxConsecutive=1}
  }
  const firstIdx=positions[0]??0,lastIdx=positions[positions.length-1]??0;
  const gapPenalty=Math.max(0,lastIdx-firstIdx+1-compactQuery.length);
  return Math.max(1,400+Math.min(150,boundaryHits*25)+Math.min(120,maxConsecutive*18)-Math.min(120,gapPenalty*4)-Math.min(40,firstIdx*2));
 }
 function scoreTagMatch(candidate,query){
  const rawQuery=query.trim().toLowerCase();
  if(!rawQuery)return 0;
  const rawCand=candidate.toLowerCase();
  const foldedCand=foldSeparators(rawCand),foldedQuery=foldSeparators(rawQuery);
  const compactCand=compactText(rawCand),compactQuery=compactText(rawQuery);
  if(!compactQuery)return rawCand.includes(rawQuery)?500:0;
  if(rawCand===rawQuery)return 1000;
  if(foldedCand===foldedQuery)return 960;
  if(compactCand===compactQuery)return 950;
  if(rawCand.startsWith(rawQuery))return 900;
  if(foldedCand.startsWith(foldedQuery))return 860;
  if(compactCand.startsWith(compactQuery))return 840;
  const words=foldedCand.split(' ').filter(Boolean);
  if(words.some(w=>w.startsWith(foldedQuery)||w.startsWith(compactQuery)))return 800;
  if(rawCand.includes(rawQuery))return 750;
  if(foldedCand.includes(foldedQuery))return 720;
  if(compactCand.includes(compactQuery))return 700;
  return scoreSubsequence(rawCand,compactCand,compactQuery);
 }
 function visibleOptions(){if(suggestions.hidden)return [];return [...suggestions.children].filter(option=>!option.hidden)}
 function syncSelection(){const visible=visibleOptions();for(const option of suggestions.children)option.setAttribute('aria-selected','false');if(activeIndex>=visible.length)activeIndex=visible.length-1;if(activeIndex>=0&&visible[activeIndex]){visible[activeIndex].setAttribute('aria-selected','true');visible[activeIndex].scrollIntoView?.({block:'nearest'})}}
 function render(){container.textContent='';for(const tag of tags){const pill=document.createElement('span');pill.className='tag-pill';const text=document.createElement('span');text.textContent=tag;const remove=document.createElement('button');remove.type='button';remove.className='tag-remove';remove.setAttribute('aria-label',`Remove ${tag}`);remove.textContent='×';remove.onclick=()=>{tags=tags.filter(t=>t!==tag);render();filterSuggestions();input.focus()};pill.append(text,remove);container.append(pill)}}
 function add(value){const t=value.trim();if(t&&!tags.some(v=>v.toLowerCase()===t.toLowerCase()))tags.push(known.find(v=>v.toLowerCase()===t.toLowerCase())||t);input.value='';render()}
 function filterSuggestions(){
  const query=input.value.trim();
  if(!known.length&&!optionByTag.size){suggestions.hidden=true;activeIndex=-1;return}
  const selected=new Set(tags.map(t=>t.toLowerCase()));
  const matched=[],hiddenOptions=[];
  for(const tag of known){
   const option=optionByTag.get(tag);
   if(!option)continue;
   const score=(query&&!selected.has(tag.toLowerCase()))?scoreTagMatch(tag,query):0;
   if(score>0){option.hidden=false;matched.push({tag,score,option})}
   else{option.hidden=true;hiddenOptions.push(option)}
  }
  matched.sort((a,b)=>b.score-a.score||a.tag.localeCompare(b.tag));
  suggestions.textContent='';
  suggestions.append(...matched.map(m=>m.option),...hiddenOptions);
  activeIndex=matched.length?0:-1;
  suggestions.hidden=!query||!matched.length;
  syncSelection();
 }
 input.addEventListener('input',filterSuggestions);
 input.addEventListener('keydown',e=>{
  const visible=visibleOptions();
  if(e.key==='ArrowDown'&&!suggestions.hidden&&visible.length){e.preventDefault();activeIndex=(activeIndex+1)%visible.length;syncSelection()}
  else if(e.key==='ArrowUp'&&!suggestions.hidden&&visible.length){e.preventDefault();activeIndex=(activeIndex-1+visible.length)%visible.length;syncSelection()}
  else if(e.key==='Escape'&&!suggestions.hidden){e.preventDefault();suggestions.hidden=true;activeIndex=-1;syncSelection()}
  else if((e.key===','||e.key==='Enter'||e.key==='Tab')&&input.value.trim()){e.preventDefault();const picked=visible[activeIndex>=0?activeIndex:0]?.textContent;add((e.key==='Tab'||e.key==='Enter')?picked||input.value:input.value);filterSuggestions()}
  else if(e.key==='Backspace'&&!input.value&&tags.length){tags.pop();render();filterSuggestions()}
 });
 input.addEventListener('blur',()=>{if(input.value.trim())add(input.value);suggestions.hidden=true;activeIndex=-1;syncSelection()});
 window.captureTags={setDefaults:values=>{if(!tags.length&&!input.value.trim()&&Array.isArray(values)){tags=Array.from(new Set(values.map(v=>String(v).trim()).filter(Boolean)));render();filterSuggestions()}},values:(commit=true)=>{if(commit&&input.value.trim())add(input.value);return [...tags]}};
 chrome.runtime.sendMessage({type:'library-tags'}).then(result=>{
  if(Array.isArray(result?.tags)){
   known=result.tags;
   for(const tag of known){
    const option=document.createElement('button');
    option.type='button';
    option.setAttribute('role','option');
    option.setAttribute('aria-selected','false');
    option.textContent=tag;
    option.hidden=true;
    option.onmousedown=e=>e.preventDefault();
    option.onclick=()=>{add(tag);filterSuggestions();input.focus()};
    optionByTag.set(tag,option);
    suggestions.append(option);
   }
  }
 }).catch(()=>{});
})();
