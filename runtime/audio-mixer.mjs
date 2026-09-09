export class DirectSoundMixer {
  constructor(sampleRate){this.sampleRate=sampleRate;this.buffers=new Map();this.events=[];this.time=null;this.frames=0;this.peak=0;}
  push(event){if(event.type==='clock'){this.latestTime=event.time;if(this.time===null)this.time=event.time-80;else if(Math.abs(event.time-80-this.time)>250)this.time=event.time-80;return;}let index=this.events.length;while(index&&this.events[index-1].time>event.time)index--;this.events.splice(index,0,event);}
  apply(e){if(e.type==='midi'){this.onMidi?.(e);return;}if(e.type==='remove'){this.buffers.delete(e.id);return;}const b=this.buffers.get(e.id)??{};Object.assign(b,e);if(e.data)b.view=new DataView(e.data.buffer,e.data.byteOffset,e.data.byteLength);for(const patch of e.patches??[])b.data.set(patch.data,patch.offset);delete b.patches;b.left=Math.pow(10,(b.volume-Math.max(0,b.pan))/2000);b.right=Math.pow(10,(b.volume+Math.min(0,b.pan))/2000);this.buffers.set(e.id,b);}
  sample(b,frame,channel){const count=b.data.length/b.align;if(b.loop)frame=((frame%count)+count)%count;else if(frame<0||frame>=count)return 0;const offset=frame*b.align+Math.min(channel,b.channels-1)*b.bits/8;if(b.bits===16)return b.view.getInt16(offset,true)/32768;if(b.bits===8)return (b.data[offset]-128)/128;throw new Error('Unsupported original PCM depth '+b.bits);}
  render(left,right){left.fill(0);right.fill(0);if(this.time===null)return;const step=1000/this.sampleRate;let active=[...this.buffers.values()].filter(b=>b.playing&&b.data);
    for(let i=0;i<left.length;i++){
      if(this.events.length&&this.events[0].time<=this.time+.000001){while(this.events.length&&this.events[0].time<=this.time+.000001)this.apply(this.events.shift());active=[...this.buffers.values()].filter(b=>b.playing&&b.data);}let l=0,r=0;
      for(const b of active){if(!b.playing)continue;const position=b.cursor/b.align+(this.time-b.time)*b.rate/1000,frame=Math.floor(position),fraction=position-frame;
        if(!b.loop&&frame>=b.data.length/b.align){b.playing=false;continue;}
        const a=this.sample(b,frame,0),c=this.sample(b,frame,1);l+=(a+(this.sample(b,frame+1,0)-a)*fraction)*b.left;r+=(c+(this.sample(b,frame+1,1)-c)*fraction)*b.right;
      }
      left[i]=Math.max(-1,Math.min(1,l));right[i]=Math.max(-1,Math.min(1,r));this.peak=Math.max(this.peak,Math.abs(left[i]),Math.abs(right[i]));this.time+=step;
    }this.frames+=left.length;
  }
}
