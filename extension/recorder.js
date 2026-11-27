let recorder,stream,finishing=false,completion,activeTabId=null,activeTitle='';
chrome.runtime.onMessage.addListener((m,_s,send)=>{
  if(m.type==='start'){
    let freshStream=null,claimed=false;
    (async()=>{
      if(recorder?.state==='recording'||finishing)throw Error('A recording is already running or finishing.');
      finishing=true;claimed=true;
      activeTabId=m.tabId??null;activeTitle=m.title||'';
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.stream}}});
      freshStream=stream;
      const id=crypto.randomUUID(), metadata={title:m.title||'',url:m.url||'',state:'recording',created:Date.now()};
      try{await storeRecording(id,metadata)}catch(e){stream.getTracks().forEach(t=>t.stop());throw e}
      let index=0,writes=Promise.resolve(),storageError=null;
      recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
      recorder.ondataavailable=e=>{if(!e.data.size)return;const part=e.data,position=index++;writes=writes.then(()=>storeChunk(id,position,part)).catch(error=>{storageError=error;if(recorder.state==='recording')recorder.stop()})};
      completion=new Promise(resolve=>{recorder.onstop=async()=>{
        finishing=true;
        try{await writes;await storeRecording(id,{...metadata,state:storageError?'partial':'ready',chunks:index});const result=await chrome.runtime.sendMessage({type:'recording-ready',id});if(result?.error)throw Error(result.error);resolve({ok:true})}
        catch(error){console.error('Could not finalize recording:',error);resolve({error:String(error)})}
        finally{stream.getTracks().forEach(t=>t.stop());finishing=false;activeTabId=null;activeTitle=''}
      }});
      stream.getVideoTracks()[0].onended=()=>{if(recorder?.state==='recording')recorder.stop()};
      recorder.start(1000);finishing=false;send({ok:true});
    })().catch(e=>{if(claimed){finishing=false;activeTabId=null;activeTitle=''}if(freshStream)freshStream.getTracks().forEach(t=>t.stop());send({error:String(e)})});return true;
  }
  if(m.type==='get-recorder-status'){send({recording:recorder?.state==='recording',finishing,tabId:activeTabId,title:activeTitle});return true}
  if(m.type==='stop-recording'){if(recorder?.state==='recording'){finishing=true;recorder.stop();completion.then(send)}else send({error:'No active recording'});return true}
});
