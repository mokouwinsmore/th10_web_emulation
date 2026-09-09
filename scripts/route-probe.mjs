import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';import {createSession} from './native/session.mjs';
import {stageFixture} from './native/test-entry.mjs';
const root='artifacts/routes';mkdirSync(root,{recursive:true});writeFileSync(root+'/progress.log','');const log=x=>appendFileSync(root+'/progress.log',JSON.stringify(x)+'\n');console.log=(...args)=>log(args);
const cases=[['jp',0,0,0,1],['jp',0,1,1,2],['jp',0,2,2,3],['chs',1,0,3,4],['chs',1,1,1,5],['chs',1,2,2,6],['jp',1,0,4,7]],results=[];
for(const [language,character,shot,difficulty,stage] of cases.filter(c=>!process.env.ROUTE_CASES||new RegExp(process.env.ROUTE_CASES).test(c.join('-')))){const s=await createSession({language,unlocked:false}),name=`${language}-${character}${shot}-d${difficulty}-s${stage}`;try{
  stageFixture(s,stage);s.frames(450);s.key('KeyZ');s.key('KeyZ');
  if(difficulty===0)s.key('ArrowUp');else if(difficulty<4)for(let i=1;i<difficulty;i++)s.key('ArrowDown');s.key('KeyZ');
  if(character)s.key('ArrowRight',120);s.key('KeyZ',90);for(let i=0;i<shot;i++)s.key('ArrowDown');s.key('KeyZ',90);
  s.frames(300);const screen=s.screen(),config=s.m.u32(0x477848),stageFile=s.host.text(s.m.u32(config+4));log({name,event:'entered',screen,stageFile});for(const [key,value] of Object.entries({character,shot,difficulty,stage}))if(screen[key]!==value)throw new Error(`${key}: ${screen[key]} expected ${value}`);if(stageFile!==`stage${String(stage).padStart(2,'0')}.std`)throw new Error('Incorrect stage resources: '+stageFile);
  s.host.input.keys=new Set(['KeyZ','ShiftLeft','ControlLeft']);const count=stage===7?24000:2400;
  s.frames(count,()=>{s.m.u32(0x474c70,8);s.m.u32(0x474c48,100);const frame=s.host.d3d.frames;if(stage!==7&&frame%900<3)s.host.input.keys.add('KeyX');else s.host.input.keys.delete('KeyX');if(frame%3000===0)log({name,event:'progress',screen:s.screen()});});
  const result={name,status:'pass',screen:s.screen(),texts:[...s.fonts.text],calls:[...s.host.calls]};results.push(result);log({name,event:'passed',screen:result.screen});writeFileSync(`${root}/${name}.json`,JSON.stringify(result,null,2));
}catch(error){const result={name,status:'failed',error:error.stack,screen:s.screen(),threads:s.scheduler.threads.map(t=>({id:t.id,pc:t.context.instruction_pointer[0],regs:Array.from(t.context.reg32)})),calls:[...s.host.calls]};results.push(result);log(result);writeFileSync(`${root}/${name}-fault.json`,JSON.stringify(result,null,2));writeFileSync(`${root}/${name}-memory.bin`,s.m.view(0x10000,0x8000000-0x10000));process.exitCode=1;break;}finally{s.close();}}
writeFileSync(root+'/results.json',JSON.stringify(results,null,2));
