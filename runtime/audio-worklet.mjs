import {DirectSoundMixer} from './audio-mixer.mjs';
class NativeSoundProcessor extends AudioWorkletProcessor {
  constructor(){super();this.mixer=new DirectSoundMixer(sampleRate);this.report=0;this.energy=0;this.samples=0;this.port.onmessage=({data})=>{if(data.type==='connect'){this.source=data.port;this.source.onmessage=({data})=>this.mixer.push(data);this.source.start();this.port.postMessage({type:'ready'});}};}
  process(inputs,outputs){const [left,right]=outputs[0];this.mixer.render(left,right);for(let i=0;i<left.length;i++)this.energy+=left[i]*left[i]+right[i]*right[i];this.samples+=left.length*2;if(++this.report%172===0){this.port.postMessage({type:'audio',frames:this.mixer.frames,peak:this.mixer.peak,rms:Math.sqrt(this.energy/this.samples),buffers:this.mixer.buffers.size,time:this.mixer.time});this.energy=0;this.samples=0;}return true;}
}
registerProcessor('native-directsound',NativeSoundProcessor);
