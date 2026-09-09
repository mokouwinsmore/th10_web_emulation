import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createSession} from './native/session.mjs';
import {captureSession} from './native/capture-session.mjs';
const out='artifacts/record-replay';mkdirSync(out,{recursive:true});writeFileSync(out+'/progress.log','');const log=(...args)=>appendFileSync(out+'/progress.log',args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');console.log=(...a)=>log(...a);
const s=await createSession();try{
  s.frames(450);for(let i=0;i<5;i++)s.key('KeyZ');s.host.input.keys.add('ControlLeft');
  for(let i=0;i<30;i++){s.frames(600);log('PLAY',s.screen());if(s.m.i32(0x474c70)<0){s.host.input.keys.clear();s.frames(600);break;}}
  s.host.input.keys.clear();captureSession(s,'game-over',out);log('GAME_OVER',s.screen());
  for(const [i,code] of (process.env.REPLAY_KEYS??'').split(',').filter(Boolean).entries()){s.key(code,120);captureSession(s,`key-${i}-${code}`,out);log('KEY',code,s.screen());}
  for(const [name,bytes] of s.host.overlay)if(bytes){mkdirSync(out+'/'+name.split('/').slice(0,-1).join('/'),{recursive:true});writeFileSync(out+'/'+name,bytes);}writeFileSync(out+'/calls.json',JSON.stringify([...s.host.calls],null,2));writeFileSync(out+'/text.json',JSON.stringify([...s.fonts.text],null,2));log('FILES',[...s.host.overlay].map(([n,b])=>[n,b?.length]));
}catch(error){log('ERROR',error.stack);process.exitCode=1;}finally{s.close();}
