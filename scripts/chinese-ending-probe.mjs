import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {createSession} from './native/session.mjs';import {stageFixture} from './native/test-entry.mjs';import {captureSession} from './native/capture-session.mjs';
const out='artifacts/chinese-ending';mkdirSync(out,{recursive:true});writeFileSync(out+'/progress.log','');const log=(...args)=>appendFileSync(out+'/progress.log',args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');console.log=(...a)=>log(...a);
const s=await createSession({language:'chs'});
try{
  const draw=s.host.d3d.draw;s.host.d3d.draw=()=>0;
  stageFixture(s,6);s.frames(450);for(let i=0;i<5;i++)s.key('KeyZ');
  s.host.input.keys=new Set(['KeyZ','ShiftLeft','ControlLeft']);
  await s.framesAsync(65000,()=>{
    s.m.u32(0x474c70,8);s.m.u32(0x474c48,100);
    if(s.host.d3d.frames%3000===0){log('PLAY',s.screen());writeFileSync(out+'/text.json',JSON.stringify([...s.fonts.text],null,2));}
  });
  const screen=s.screen();assert(screen.flags&4);assert.equal(screen.player,0,'The original ending must have replaced the playfield');
  assert([...s.fonts.text].some(t=>/Ending|结局.*01|通关/.test(t)),'The final translated ending message must be displayed');
  s.host.d3d.draw=draw;if(process.env.NATIVE_CAPTURE==='1')captureSession(s,'ending',out);log('PASSED',screen);
}catch(error){log('ERROR',error.stack);process.exitCode=1;}
finally{writeFileSync(out+'/text.json',JSON.stringify([...s.fonts.text],null,2));writeFileSync(out+'/calls.json',JSON.stringify([...s.host.calls],null,2));s.close();}
