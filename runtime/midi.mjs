export function installMidi(host){const m=host.m,emit=data=>host.onMidi?.({type:'midi',time:host.callbackTime??host.millis,data});Object.assign(host.api,{
  midiOutGetNumDevs:[0,()=>1],
  midiOutOpen:[5,a=>{const handle=host.handle({kind:'midi',callback:a[2],instance:a[3],flags:a[4]});m.u32(a[0],handle);return 0;}],
  midiOutClose:[1,a=>{host.handles.delete(a[0]);return 0;}],
  midiOutReset:[1,()=>{for(let channel=0;channel<16;channel++){emit(Uint8Array.of(0xb0|channel,120,0));emit(Uint8Array.of(0xb0|channel,121,0));}return 0;}],
  midiOutPrepareHeader:[3,a=>{m.u32(a[1]+16,m.u32(a[1]+16)|2);return 0;}],midiOutUnprepareHeader:[3,a=>{m.u32(a[1]+16,m.u32(a[1]+16)&~2);return 0;}],
  midiOutShortMsg:[2,a=>{const status=a[1]&255,length=status>=0xf0?1:(status&0xf0)===0xc0||(status&0xf0)===0xd0?2:3;emit(Uint8Array.from([status,a[1]>>8&127,a[1]>>16&127].slice(0,length)));return 0;}],
  midiOutLongMsg:[3,a=>{emit(m.bytes(m.u32(a[1]),m.u32(a[1]+4)));m.u32(a[1]+16,(m.u32(a[1]+16)|1)&~4);const device=host.handles.get(a[0]);if(device?.flags&0x10000)host.messages.push([device.callback,0x3c9,a[0],a[1]]);return 0;}],
  midiOutGetVolume:[2,a=>{m.u32(a[1],0xffffffff);return 0;}],midiOutSetVolume:[2,()=>0],
});}
