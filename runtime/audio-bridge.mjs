// The original DirectSound buffers supply all PCM, loop points and play events.
// No replacement music or gameplay-dependent sound rules are used here.
export function connectAudio(host,port){
  const sound=host.sound,m=host.m,uploaded=new Map();
  host.onMidi=event=>port.postMessage(event,[event.data.buffer]);
  function send(type,b,ranges){if(b.flags&1)return;const cursor=sound.position(b),fmt=new DataView(b.format.buffer,b.format.byteOffset),message={type,id:b.address,time:host.millis,playing:b.playing,loop:b.loop,cursor,rate:b.frequency,channels:fmt.getUint16(2,true),bits:fmt.getUint16(14,true),align:fmt.getUint16(12,true),volume:b.volume,pan:b.pan},version=b.version??0;
    if(uploaded.get(b.address)!==version){if(uploaded.get(b.address)===version-1&&ranges?.length&&ranges.every(r=>r.offset>=0&&r.length>0&&r.offset+r.length<=b.length))message.patches=ranges.map(r=>({offset:r.offset,data:m.bytes(b.data+r.offset,r.length)}));else message.data=m.bytes(b.data,b.length);uploaded.set(b.address,version);}
    port.postMessage(message,message.data?[message.data.buffer]:message.patches?.map(p=>p.data.buffer)??[]);
  }
  sound.onUpload=(b,ranges)=>send('update',b,ranges);sound.onPlay=b=>send('update',b);sound.onSeek=b=>send('update',b);sound.onChange=b=>send('update',b);sound.onStop=b=>send('update',b);sound.onDestroy=b=>{uploaded.delete(b.address);port.postMessage({type:'remove',id:b.address,time:host.millis});};
  return {sync(){port.postMessage({type:'clock',time:host.millis});}};
}
