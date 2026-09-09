import {COM} from './com.mjs';
const zero=()=>0;
export class DirectSound8 {
  constructor(host){this.host=host;this.m=host.m;this.com=new COM(host);this.buffers=[];}
  create(){return this.com.create('IDirectSound8',{
    SetCooperativeLevel:zero,Compact:zero,Initialize:zero,GetSpeakerConfig:a=>{this.m.u32(a[0],4);return 0;},SetSpeakerConfig:zero,
    CreateSoundBuffer:a=>{const flags=this.m.u32(a[0]+4),length=this.m.u32(a[0]+8),format=this.m.u32(a[0]+16),b=this.buffer(flags,length,format);this.m.u32(a[1],b.address);return 0;},
    DuplicateSoundBuffer:a=>{const src=this.com.get(a[0]),b=this.buffer(src.flags,src.length,src.format,src.storage);b.frequency=src.frequency;b.volume=src.volume;b.pan=src.pan;this.m.u32(a[1],b.address);return 0;},
    GetCaps:a=>{const size=this.m.u32(a[0]);this.m.write(a[0]+4,new Uint8Array(size-4));this.m.u32(a[0]+4,0x60f);this.m.u32(a[0]+8,100);this.m.u32(a[0]+12,200000);return 0;},
  }).address;}
  position(b){if(!b.playing)return b.cursor;const fmt=new DataView(b.format.buffer),align=fmt.getUint16(12,true)||1,rate=b.frequency||fmt.getUint32(4,true),pos=b.cursor+Math.floor((this.host.millis-b.started)*rate/1000)*align;if(b.loop)return pos%b.length;if(pos>=b.length){b.playing=false;return b.cursor=0;}return pos;}
  advance(){for(const b of this.buffers)if(b.playing){const pos=this.position(b),last=b.lastCursor??pos;for(const n of b.notifications??[])if((pos>=last&&n.offset>=last&&n.offset<pos)||(pos<last&&(n.offset>=last||n.offset<pos))){const e=this.host.handles.get(n.event);if(e)e.signaled=true;}b.lastCursor=pos;}}
  buffer(flags,length,format,sharedStorage){
    length=length||4096;const m=this.m,storage=sharedStorage??{data:this.host.alloc(length),refs:0,version:0},b=this.com.create('IDirectSoundBuffer',{}, {flags,length,data:storage.data,storage,format:format instanceof Uint8Array?format.slice():format?m.bytes(format,18):new Uint8Array([1,0,2,0,68,172,0,0,16,177,2,0,4,0,16,0,0,0]),playing:false,cursor:0,volume:0,pan:0,frequency:44100});
    storage.refs++;Object.defineProperty(b,'version',{get:()=>storage.version});b.frequency=new DataView(b.format.buffer).getUint32(4,true);if(!sharedStorage)m.view(b.data,b.length).fill(new DataView(b.format.buffer).getUint16(14,true)===8?128:0);
    b.handlers={
      QueryInterface:a=>{const iid=m.u32(a[0]);if(iid===0xb0210783){b.notify??=this.com.create('IDirectSoundNotify',{SetNotificationPositions:a=>{b.notifications=Array.from({length:a[0]},(_,i)=>({offset:m.u32(a[1]+i*8),event:m.u32(a[1]+i*8+4)}));return 0;}},{refOwner:b});this.com.addRef(b);m.u32(a[1],b.notify.address);return 0;}m.u32(a[1],b.address);this.com.addRef(b);return 0;},
      SetFormat:a=>{b.format=m.bytes(a[0],18);b.frequency=new DataView(b.format.buffer).getUint32(4,true);this.onChange?.(b);return 0;},SetVolume:a=>{b.volume=a[0]|0;this.onChange?.(b);return 0;},SetPan:a=>{b.pan=a[0]|0;this.onChange?.(b);return 0;},SetFrequency:a=>{b.cursor=this.position(b);b.started=this.host.millis;b.frequency=a[0]||new DataView(b.format.buffer).getUint32(4,true);this.onChange?.(b);return 0;},
      GetVolume:a=>{m.u32(a[0],b.volume);return 0;},GetPan:a=>{m.u32(a[0],b.pan);return 0;},GetFrequency:a=>{m.u32(a[0],b.frequency);return 0;},GetStatus:a=>{this.position(b);m.u32(a[0],b.playing?(b.loop?5:1):0);return 0;},
      GetCurrentPosition:a=>{const pos=this.position(b);if(a[0])m.u32(a[0],pos);if(a[1])m.u32(a[1],(pos+2048)%b.length);return 0;},SetCurrentPosition:a=>{b.cursor=a[0]%b.length;b.started=this.host.millis;this.onSeek?.(b);return 0;},
      GetCaps:a=>{[20,flags,length,0,0].forEach((n,i)=>m.u32(a[0]+i*4,n));return 0;},
      Lock:a=>{const offset=a[0]%b.length,len=a[6]&2?b.length:a[1],first=Math.min(len,b.length-offset);m.u32(a[2],b.data+offset);m.u32(a[3],first);if(a[4])m.u32(a[4],len>first?b.data:0);if(a[5])m.u32(a[5],len-first);return 0;},Unlock:a=>{storage.version++;const ranges=[];for(let i=0;i<4;i+=2)if(a?.[i]&&a[i+1])ranges.push({offset:a[i]-b.data,length:a[i+1]});for(const other of this.buffers)if(other.storage===storage)this.onUpload?.(other,ranges);return 0;},
      Play:a=>{if(b.playing)b.cursor=this.position(b);b.playing=true;b.loop=!!(a[2]&1);b.started=this.host.millis;b.lastCursor=b.cursor;this.onPlay?.(b);return 0;},Stop:()=>{b.cursor=this.position(b);b.playing=false;this.onStop?.(b);return 0;},Restore:zero,Initialize:zero,
      GetFormat:a=>{if(a[2])m.u32(a[2],18);if(a[0])m.write(a[0],b.format.subarray(0,a[1]));return 0;},
    };b.destroy=()=>{b.playing=false;this.onDestroy?.(b);if(!--storage.refs)this.host.free(b.data);if(b.notify)this.com.forget(b.notify);this.buffers.splice(this.buffers.indexOf(b),1);};this.buffers.push(b);return b;
  }
}
