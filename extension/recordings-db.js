function openRecordings(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('sightline-captures',2);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('recordings'))db.createObjectStore('recordings');if(!db.objectStoreNames.contains('chunks'))db.createObjectStore('chunks')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function storeRecording(id,value){
  const db=await openRecordings();return new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite');tx.objectStore('recordings').put(value,id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Recording storage was interrupted'))}});
}
async function storeChunk(id,index,blob){
  const db=await openRecordings();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put(blob,[id,index]);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Recording storage was interrupted'))}});
}
async function readRecording(id){
  const db=await openRecordings();return new Promise((resolve,reject)=>{const tx=db.transaction(['recordings','chunks']);const request=tx.objectStore('recordings').get(id);request.onsuccess=()=>{const value=request.result;if(!value||value.blob){db.close();resolve(value);return}const chunks=tx.objectStore('chunks').getAll(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));chunks.onsuccess=()=>{db.close();resolve({...value,blob:new Blob(chunks.result,{type:'video/webm'})})};chunks.onerror=()=>{db.close();reject(chunks.error)}};request.onerror=()=>{db.close();reject(request.error)}});
}
async function listRecordings(){
  const db=await openRecordings();return new Promise((resolve,reject)=>{const tx=db.transaction('recordings');const store=tx.objectStore('recordings');const values=store.getAll(),keys=store.getAllKeys();tx.oncomplete=()=>{db.close();resolve(values.result.map((value,index)=>({id:keys.result[index],title:value.title||'Recording',url:value.url||'',state:value.state||'ready',created:value.created||0})))};tx.onerror=()=>{db.close();reject(tx.error)}});
}
async function deleteRecording(id){
  const db=await openRecordings();return new Promise((resolve,reject)=>{const tx=db.transaction(['recordings','chunks'],'readwrite');tx.objectStore('recordings').delete(id);tx.objectStore('chunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error||Error('Could not delete recording'))}});
}
