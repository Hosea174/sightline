(function(global){
  const ID_EBML=0x1A45DFA3,ID_SEGMENT=0x18538067,ID_INFO=0x1549A966,ID_TIMECODE_SCALE=0x2AD7B1,ID_TRACKS=0x1654AE6B,ID_TRACK_ENTRY=0xAE,ID_TRACK_NUMBER=0xD7,ID_TRACK_TYPE=0x83,ID_CODEC_ID=0x86,ID_VIDEO=0xE0,ID_PIXEL_WIDTH=0xB0,ID_PIXEL_HEIGHT=0xBA,ID_CLUSTER=0x1F43B675,ID_TIMECODE=0xE7,ID_SIMPLE_BLOCK=0xA3,ID_BLOCK_GROUP=0xA0,ID_BLOCK=0xA1,ID_REF_BLOCK=0xFB;
  const TOP_LEVEL_IDS=new Set([ID_CLUSTER,0x1C53BB6B,0x1254C367,0x1941A469,ID_TRACKS,ID_INFO,0x114D9B74,0x1043A770]);

  function readVintId(buf,pos){
    if(pos>=buf.length)return null;
    const first=buf[pos];
    let len=0;
    for(let i=0;i<4;i++){if(first&(0x80>>i)){len=i+1;break}}
    if(!len||pos+len>buf.length)return null;
    let id=0;
    for(let i=0;i<len;i++)id=id*256+buf[pos+i];
    return {id,length:len};
  }

  function readVintSize(buf,pos){
    if(pos>=buf.length)return null;
    const first=buf[pos];
    let len=0;
    for(let i=0;i<8;i++){if(first&(0x80>>i)){len=i+1;break}}
    if(!len||pos+len>buf.length)return null;
    const mask=(0x80>>(len-1))-1;
    let val=first&mask,allOnes=val===mask;
    for(let i=1;i<len;i++){
      const b=buf[pos+i];
      if(b!==0xFF)allOnes=false;
      val=val*256+b;
    }
    return {size:allOnes?-1:val,length:len};
  }

  function readUint(buf,start,end){
    let v=0;
    for(let i=start;i<end;i++)v=v*256+buf[i];
    return v;
  }

  function readString(buf,start,end){
    return new TextDecoder().decode(buf.subarray(start,end)).replace(/\0+$/,'');
  }

  function unpackBlock(buf,start,end,clusterTime,timecodeScale,defaultKey){
    const tr=readVintSize(buf,start);
    if(!tr)return null;
    const p=start+tr.length;
    if(p+3>end)return null;
    let rel=(buf[p]<<8)|buf[p+1];
    if(rel>=0x8000)rel-=0x10000;
    const flags=buf[p+2];
    const isKey=defaultKey!==undefined?defaultKey:((flags&0x80)!==0);
    const lacing=(flags>>1)&0x03;
    const timestampUs=Math.round((clusterTime+rel)*(timecodeScale/1000));
    const payloadStart=p+3;
    const frames=[];
    if(lacing===0){
      frames.push(buf.subarray(payloadStart,end));
    }else if(payloadStart<end){
      const count=buf[payloadStart]+1;
      let cursor=payloadStart+1;
      const sizes=[];
      if(lacing===1){
        for(let i=0;i<count-1;i++){
          let s=0;
          while(cursor<end){const b=buf[cursor++];s+=b;if(b<255)break}
          sizes.push(s);
        }
      }else if(lacing===2){
        const total=end-cursor;
        const each=Math.floor(total/count);
        for(let i=0;i<count-1;i++)sizes.push(each);
      }else if(lacing===3){
        const first=readVintSize(buf,cursor);
        if(first){
          cursor+=first.length;
          let prev=first.size;
          sizes.push(prev);
          for(let i=1;i<count-1;i++){
            const d=readVintSize(buf,cursor);
            if(!d)break;
            cursor+=d.length;
            const bias=(1<<(7*d.length-1))-1;
            prev+=d.size-bias;
            sizes.push(prev);
          }
        }
      }
      let offset=cursor;
      for(const s of sizes){
        if(offset+s<=end)frames.push(buf.subarray(offset,offset+s));
        offset+=s;
      }
      if(offset<=end)frames.push(buf.subarray(offset,end));
    }
    return {trackNumber:tr.size,timestampUs,isKey,frames};
  }

  function demuxWebm(buffer){
    const buf=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    let pos=0,timecodeScale=1000000;
    let videoTrack=null;
    const packets=[];

    function parseTrackEntry(start,end){
      let p=start,trackNumber=0,trackType=0,codecId='',width=0,height=0;
      while(p<end){
        const idR=readVintId(buf,p);if(!idR)break;p+=idR.length;
        const szR=readVintSize(buf,p);if(!szR)break;p+=szR.length;
        const elEnd=szR.size<0?end:Math.min(end,p+szR.size);
        if(idR.id===ID_TRACK_NUMBER)trackNumber=readUint(buf,p,elEnd);
        else if(idR.id===ID_TRACK_TYPE)trackType=readUint(buf,p,elEnd);
        else if(idR.id===ID_CODEC_ID)codecId=readString(buf,p,elEnd);
        else if(idR.id===ID_VIDEO){
          let vp=p;
          while(vp<elEnd){
            const vid=readVintId(buf,vp);if(!vid)break;vp+=vid.length;
            const vsz=readVintSize(buf,vp);if(!vsz)break;vp+=vsz.length;
            const vEnd=vsz.size<0?elEnd:Math.min(elEnd,vp+vsz.size);
            if(vid.id===ID_PIXEL_WIDTH)width=readUint(buf,vp,vEnd);
            else if(vid.id===ID_PIXEL_HEIGHT)height=readUint(buf,vp,vEnd);
            vp=vEnd;
          }
        }
        p=elEnd;
      }
      if(trackType===1&&!videoTrack)videoTrack={trackNumber,codecId,width,height};
    }

    function parseTracks(start,end){
      let p=start;
      while(p<end){
        const idR=readVintId(buf,p);if(!idR)break;p+=idR.length;
        const szR=readVintSize(buf,p);if(!szR)break;p+=szR.length;
        const elEnd=szR.size<0?end:Math.min(end,p+szR.size);
        if(idR.id===ID_TRACK_ENTRY)parseTrackEntry(p,elEnd);
        p=elEnd;
      }
    }

    function parseInfo(start,end){
      let p=start;
      while(p<end){
        const idR=readVintId(buf,p);if(!idR)break;p+=idR.length;
        const szR=readVintSize(buf,p);if(!szR)break;p+=szR.length;
        const elEnd=szR.size<0?end:Math.min(end,p+szR.size);
        if(idR.id===ID_TIMECODE_SCALE)timecodeScale=readUint(buf,p,elEnd)||1000000;
        p=elEnd;
      }
    }

    function parseCluster(start,end,unknownSize){
      let p=start,clusterTime=0;
      while(p<end){
        const peekPos=p;
        const idR=readVintId(buf,p);if(!idR)break;
        if(unknownSize&&TOP_LEVEL_IDS.has(idR.id))return peekPos;
        p+=idR.length;
        const szR=readVintSize(buf,p);if(!szR)break;p+=szR.length;
        const elEnd=szR.size<0?end:Math.min(end,p+szR.size);
        if(idR.id===ID_TIMECODE){
          clusterTime=readUint(buf,p,elEnd);
        }else if(idR.id===ID_SIMPLE_BLOCK){
          const blk=unpackBlock(buf,p,elEnd,clusterTime,timecodeScale);
          if(blk&&(!videoTrack||blk.trackNumber===videoTrack.trackNumber)){
            for(const data of blk.frames){
              packets.push({timestampUs:Math.max(0,blk.timestampUs),isKey:blk.isKey,data});
            }
          }
        }else if(idR.id===ID_BLOCK_GROUP){
          let bp=p,blockInfo=null,hasRef=false;
          while(bp<elEnd){
            const bid=readVintId(buf,bp);if(!bid)break;bp+=bid.length;
            const bsz=readVintSize(buf,bp);if(!bsz)break;bp+=bsz.length;
            const bEnd=bsz.size<0?elEnd:Math.min(elEnd,bp+bsz.size);
            if(bid.id===ID_BLOCK)blockInfo=unpackBlock(buf,bp,bEnd,clusterTime,timecodeScale,true);
            else if(bid.id===ID_REF_BLOCK)hasRef=true;
            bp=bEnd;
          }
          if(blockInfo&&(!videoTrack||blockInfo.trackNumber===videoTrack.trackNumber)){
            for(const data of blockInfo.frames){
              packets.push({timestampUs:Math.max(0,blockInfo.timestampUs),isKey:!hasRef,data});
            }
          }
        }
        p=elEnd;
      }
      return p;
    }

    while(pos<buf.length){
      const idR=readVintId(buf,pos);if(!idR)break;pos+=idR.length;
      const szR=readVintSize(buf,pos);if(!szR)break;pos+=szR.length;
      const segEnd=szR.size<0?buf.length:Math.min(buf.length,pos+szR.size);
      if(idR.id===ID_EBML){
        pos=segEnd;
      }else if(idR.id===ID_SEGMENT){
        let p=pos;
        while(p<segEnd){
          const cid=readVintId(buf,p);if(!cid)break;p+=cid.length;
          const csz=readVintSize(buf,p);if(!csz)break;p+=csz.length;
          const elEnd=csz.size<0?segEnd:Math.min(segEnd,p+csz.size);
          if(cid.id===ID_INFO){parseInfo(p,elEnd);p=elEnd}
          else if(cid.id===ID_TRACKS){parseTracks(p,elEnd);p=elEnd}
          else if(cid.id===ID_CLUSTER){p=parseCluster(p,elEnd,csz.size<0)}
          else{p=elEnd}
        }
        pos=segEnd;
      }else{
        pos=segEnd;
      }
    }

    return {timecodeScale,track:videoTrack,packets};
  }

  function encodeId(id){
    if(id<=0xFF)return new Uint8Array([id]);
    if(id<=0xFFFF)return new Uint8Array([(id>>8)&0xFF,id&0xFF]);
    if(id<=0xFFFFFF)return new Uint8Array([(id>>16)&0xFF,(id>>8)&0xFF,id&0xFF]);
    return new Uint8Array([(id>>>24)&0xFF,(id>>16)&0xFF,(id>>8)&0xFF,id&0xFF]);
  }

  function encodeSize(len){
    if(len<0x7F)return new Uint8Array([0x80|len]);
    if(len<0x3FFF)return new Uint8Array([0x40|(len>>8),len&0xFF]);
    if(len<0x1FFFFF)return new Uint8Array([0x20|(len>>16),(len>>8)&0xFF,len&0xFF]);
    if(len<0x0FFFFFFF)return new Uint8Array([0x10|(len>>>24),(len>>16)&0xFF,(len>>8)&0xFF,len&0xFF]);
    const out=new Uint8Array(8);
    out[0]=0x01;
    let v=len;
    for(let i=7;i>=1;i--){out[i]=v%256;v=Math.floor(v/256)}
    return out;
  }

  function encodeUintBytes(val){
    if(val===0)return new Uint8Array([0]);
    const bytes=[];
    let v=Math.floor(val);
    while(v>0){bytes.unshift(v%256);v=Math.floor(v/256)}
    return new Uint8Array(bytes);
  }

  function concatBytes(parts){
    let total=0;
    for(const p of parts)total+=p.length;
    const out=new Uint8Array(total);
    let offset=0;
    for(const p of parts){out.set(p,offset);offset+=p.length}
    return out;
  }

  function el(id,payload){
    const idBytes=encodeId(id);
    const data=Array.isArray(payload)?concatBytes(payload):payload;
    return concatBytes([idBytes,encodeSize(data.length),data]);
  }

  function elStr(id,text){return el(id,new TextEncoder().encode(text))}
  function elUint(id,val){return el(id,encodeUintBytes(val))}
  function elFloat64(id,val){
    const buf=new ArrayBuffer(8);
    new DataView(buf).setFloat64(0,val,false);
    return el(id,new Uint8Array(buf));
  }

  function muxWebm({width,height,codecId='V_VP8',durationMs=0,chunks}){
    const ebml=el(ID_EBML,[
      elUint(0x4286,1),
      elUint(0x42F7,1),
      elUint(0x42F2,4),
      elUint(0x42F3,8),
      elStr(0x4282,'webm'),
      elUint(0x4287,4),
      elUint(0x4285,2)
    ]);
    const info=el(ID_INFO,[
      elUint(ID_TIMECODE_SCALE,1000000),
      elFloat64(0x4489,Math.max(0,durationMs)),
      elStr(0x4D80,'Sightline'),
      elStr(0x5741,'Sightline')
    ]);
    const tracks=el(ID_TRACKS,[
      el(ID_TRACK_ENTRY,[
        elUint(ID_TRACK_NUMBER,1),
        elUint(0x73C5,1),
        elUint(ID_TRACK_TYPE,1),
        elStr(ID_CODEC_ID,codecId),
        el(ID_VIDEO,[
          elUint(ID_PIXEL_WIDTH,width),
          elUint(ID_PIXEL_HEIGHT,height)
        ])
      ])
    ]);

    const clusters=[];
    let clusterTimeMs=0,clusterBlocks=[];
    const flushCluster=()=>{
      if(!clusterBlocks.length)return;
      clusters.push(el(ID_CLUSTER,[elUint(ID_TIMECODE,clusterTimeMs),...clusterBlocks]));
      clusterBlocks=[];
    };

    for(const chunk of chunks){
      const timeMs=Math.max(0,Math.round(chunk.timestampUs/1000));
      if(!clusterBlocks.length){
        clusterTimeMs=timeMs;
      }else if((chunk.isKey&&timeMs-clusterTimeMs>=1000)||timeMs-clusterTimeMs>30000){
        flushCluster();
        clusterTimeMs=timeMs;
      }
      const rel=Math.max(-32768,Math.min(32767,timeMs-clusterTimeMs));
      const header=new Uint8Array(4);
      header[0]=0x81;
      header[1]=(rel>>8)&0xFF;
      header[2]=rel&0xFF;
      header[3]=chunk.isKey?0x80:0x00;
      clusterBlocks.push(el(ID_SIMPLE_BLOCK,[header,chunk.data]));
    }
    flushCluster();

    const segmentBody=concatBytes([info,tracks,...clusters]);
    const segment=concatBytes([encodeId(ID_SEGMENT),encodeSize(segmentBody.length),segmentBody]);
    return concatBytes([ebml,segment]);
  }

  function decoderCandidates(codecId){
    if(codecId==='V_VP9')return ['vp09.00.10.08','vp09.00.41.08','vp09.00.50.08'];
    if(codecId==='V_VP8')return ['vp8'];
    if(codecId==='V_AV1')return ['av01.0.04M.08','av01.0.08M.08'];
    return [];
  }

  async function pickDecoderConfig(codecId,width,height){
    for(const codec of decoderCandidates(codecId)){
      try{
        const cfg={codec};
        if(width&&height){cfg.codedWidth=width;cfg.codedHeight=height}
        const res=await VideoDecoder.isConfigSupported(cfg);
        if(res.supported)return res.config;
      }catch{}
    }
    return null;
  }

  async function pickEncoderConfig(width,height){
    const bitrate=Math.max(1500000,Math.min(12000000,Math.round(width*height*4)));
    for(const [codec,codecId] of [['vp09.00.10.08','V_VP9'],['vp8','V_VP8']]){
      try{
        const cfg={codec,width,height,bitrate,framerate:30};
        const res=await VideoEncoder.isConfigSupported(cfg);
        if(res.supported)return {config:res.config,codecId};
      }catch{}
    }
    return null;
  }

  async function retimeWithWebCodecs(blob,segments,fallbackDims,onProgress){
    if(typeof VideoDecoder==='undefined'||typeof VideoEncoder==='undefined'||typeof EncodedVideoChunk==='undefined'){
      throw Error('WebCodecs unavailable');
    }
    const demuxed=demuxWebm(await blob.arrayBuffer());
    if(!demuxed.track||!demuxed.packets.length)throw Error('No video packets found');
    const width=demuxed.track.width||fallbackDims.width;
    const height=demuxed.track.height||fallbackDims.height;
    if(!width||!height)throw Error('Unknown video dimensions');
    const decCfg=await pickDecoderConfig(demuxed.track.codecId,width,height);
    const encSel=await pickEncoderConfig(width,height);
    if(!decCfg||!encSel)throw Error('Unsupported codec configuration');

    const encodedChunks=[];
    let encError=null;
    const encoder=new VideoEncoder({
      output(chunk){
        const data=new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encodedChunks.push({timestampUs:chunk.timestamp,isKey:chunk.type==='key',data});
      },
      error(e){encError=e}
    });
    encoder.configure(encSel.config);

    let outOffsetUs=0,frameCounter=0,lastOutTs=-1000;
    const packets=demuxed.packets;
    const totalOutUs=segments.reduce((sum,s)=>sum+Math.round((s.end-s.start)*1e6/(s.speed||1)),0);

    try{
      for(let si=0;si<segments.length;si++){
        if(encError)throw encError;
        const seg=segments[si];
        if(!(seg.end>seg.start))continue;
        const segStartUs=Math.round(seg.start*1e6);
        const segEndUs=Math.round(seg.end*1e6);
        const spd=seg.speed||1;
        const segOutDurUs=Math.max(1000,Math.round((segEndUs-segStartUs)/spd));

        let kIdx=-1;
        for(let i=0;i<packets.length;i++){
          if(packets[i].isKey&&packets[i].timestampUs<=segStartUs)kIdx=i;
          if(packets[i].timestampUs>segStartUs)break;
        }
        if(kIdx<0)kIdx=packets.findIndex(p=>p.isKey);
        if(kIdx<0)throw Error('No video keyframe found');
        let endIdx=kIdx;
        while(endIdx<packets.length&&packets[endIdx].timestampUs<=segEndUs+250000)endIdx++;

        let decError=null,preFrame=null,lastFrame=null,emittedStart=false;
        const encodeVideoFrame=(vf,tsUs)=>{
          const safeTs=Math.max(lastOutTs+1000,tsUs);
          lastOutTs=safeTs;
          const cloned=new VideoFrame(vf,{timestamp:safeTs});
          try{
            encoder.encode(cloned,{keyFrame:frameCounter%60===0});
            frameCounter++;
          }finally{
            cloned.close();
          }
        };

        const decoder=new VideoDecoder({
          output(frame){
            try{
              const ts=frame.timestamp;
              if(ts<segStartUs){
                preFrame?.close();
                preFrame=frame.clone();
                return;
              }
              if(ts<=segEndUs){
                if(!emittedStart){
                  emittedStart=true;
                  if(preFrame&&ts-segStartUs>20000){
                    encodeVideoFrame(preFrame,outOffsetUs);
                  }
                  preFrame?.close();
                  preFrame=null;
                }
                const outTs=Math.round(outOffsetUs+(ts-segStartUs)/spd);
                encodeVideoFrame(frame,outTs);
                lastFrame?.close();
                lastFrame=frame.clone();
              }
            }finally{
              frame.close();
            }
          },
          error(e){decError=e}
        });
        decoder.configure(decCfg);

        try{
          for(let i=kIdx;i<endIdx;i++){
            if(decError)throw decError;
            if(encError)throw encError;
            const p=packets[i];
            decoder.decode(new EncodedVideoChunk({
              type:p.isKey?'key':'delta',
              timestamp:p.timestampUs,
              data:p.data
            }));
            while(decoder.decodeQueueSize>12||encoder.encodeQueueSize>12){
              await new Promise(r=>setTimeout(r,4));
            }
          }
          await decoder.flush();
          if(decError)throw decError;
          if(!emittedStart&&preFrame){
            encodeVideoFrame(preFrame,outOffsetUs);
          }
          const holdFrame=lastFrame||preFrame;
          if(holdFrame&&segOutDurUs>40000&&lastOutTs<outOffsetUs+segOutDurUs-33333){
            encodeVideoFrame(holdFrame,Math.max(outOffsetUs+1000,outOffsetUs+segOutDurUs-16667));
          }
        }finally{
          preFrame?.close();
          lastFrame?.close();
          try{decoder.close()}catch{}
        }

        outOffsetUs+=segOutDurUs;
        onProgress?.(Math.min(1,outOffsetUs/Math.max(1,totalOutUs)));
      }

      await encoder.flush();
      if(encError)throw encError;
    }finally{
      try{encoder.close()}catch{}
    }

    if(!encodedChunks.length)throw Error('No frames encoded');
    const webmBytes=muxWebm({
      width,
      height,
      codecId:encSel.codecId,
      durationMs:outOffsetUs/1000,
      chunks:encodedChunks
    });
    return {blob:new Blob([webmBytes],{type:'video/webm'}),duration:outOffsetUs/1e6};
  }

  async function retimeWithMediaRecorder(sourceUrl,segments,onProgress){
    const video=document.createElement('video');
    video.muted=true;
    video.playsInline=true;
    video.src=sourceUrl;
    await new Promise((resolve,reject)=>{
      video.onloadedmetadata=resolve;
      video.onerror=()=>reject(Error('Could not load source video for speed export.'));
    });
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth||1280;
    canvas.height=video.videoHeight||720;
    const ctx=canvas.getContext('2d');
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const stream=canvas.captureStream(30);
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6000000});
    const parts=[];
    recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
    const stopped=new Promise(resolve=>{recorder.onstop=resolve});
    const totalOutSec=segments.reduce((sum,s)=>sum+Math.max(0,s.end-s.start)/(s.speed||1),0);
    let elapsedOut=0;
    recorder.start(250);
    try{
      for(const seg of segments){
        if(!(seg.end>seg.start))continue;
        const spd=seg.speed||1;
        video.pause();
        video.playbackRate=spd;
        if(Math.abs(video.currentTime-seg.start)>0.001){
          const seeked=new Promise(resolve=>{
            const done=()=>{video.onseeked=null;resolve()};
            video.onseeked=done;
          });
          video.currentTime=seg.start;
          await seeked;
        }
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        await video.play();
        await new Promise(resolve=>{
          let raf=0,settled=false;
          const finish=()=>{
            if(settled)return;
            settled=true;
            cancelAnimationFrame(raf);
            video.onended=null;
            video.pause();
            resolve();
          };
          video.onended=()=>{
            ctx.drawImage(video,0,0,canvas.width,canvas.height);
            onProgress?.(Math.min(1,(elapsedOut+(seg.end-seg.start)/spd)/Math.max(0.01,totalOutSec)));
            finish();
          };
          const step=()=>{
            if(settled)return;
            ctx.drawImage(video,0,0,canvas.width,canvas.height);
            onProgress?.(Math.min(1,(elapsedOut+Math.max(0,video.currentTime-seg.start)/spd)/Math.max(0.01,totalOutSec)));
            if(video.currentTime>=seg.end-0.015*spd||video.ended){
              finish();
              return;
            }
            raf=requestAnimationFrame(step);
          };
          raf=requestAnimationFrame(step);
        });
        elapsedOut+=(seg.end-seg.start)/spd;
      }
      recorder.stop();
      await stopped;
    }finally{
      video.onseeked=null;
      video.onended=null;
      stream.getTracks().forEach(t=>t.stop());
      video.removeAttribute('src');
      video.load();
    }
    return {blob:new Blob(parts,{type:'video/webm'}),duration:totalOutSec};
  }

  async function renderSpeedAdjustedWebm(sourceUrl,segments,dims={},onProgress){
    const response=await fetch(sourceUrl);
    if(!response.ok)throw Error('Could not read source recording.');
    const blob=await response.blob();
    try{
      return await retimeWithWebCodecs(blob,segments,dims,onProgress);
    }catch{
      return await retimeWithMediaRecorder(sourceUrl,segments,onProgress);
    }
  }

  global.demuxWebm=demuxWebm;
  global.muxWebm=muxWebm;
  global.renderSpeedAdjustedWebm=renderSpeedAdjustedWebm;
})(typeof window!=='undefined'?window:globalThis);
