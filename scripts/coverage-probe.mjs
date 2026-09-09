import {writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {format} from 'node:util';
import {createSession} from './native/session.mjs';
const language=process.env.GAME_LANGUAGE??'jp',out=process.env.PROBE_OUT??`artifacts/coverage-${language}`;mkdirSync(out,{recursive:true});writeFileSync(out+'/progress.log','');console.log=(...args)=>appendFileSync(out+'/progress.log',format(...args)+'\n');const s=await createSession({language,unlocked:process.env.PROBE_UNLOCKED!=='0'});
try{
  s.frames(450);console.log('BOOT',s.screen());
  if(process.env.PROBE_MODE==='boot')process.exitCode=0;
  else{
    s.key('KeyZ');if(process.env.PROBE_MODE==='music'){for(let i=0;i<5;i++)s.key('ArrowDown');s.key('KeyZ');s.frames(900);console.log('MUSIC',s.screen());}
    else{for(let i=0;i<4;i++)s.key('KeyZ');s.host.input.keys.add('KeyZ');s.host.input.keys.add('ShiftLeft');if(process.env.PROBE_ASSIST==='1')s.host.input.keys.add('ControlLeft');
      let previousStage=0;const count=Number(process.env.PROBE_FRAMES??12000),start=s.host.d3d.frames;
      await s.framesAsync(count,()=>{if(s.host.d3d.frames%600===0)console.log('PLAY',s.screen());const stage=s.m.u32(0x474c7c);if(stage!==previousStage){console.log('STAGE',s.screen());previousStage=stage;}if(process.env.PROBE_ASSIST==='1'){s.m.u32(0x474c70,8);s.m.u32(0x474c48,100);}});console.log('PLAY_END',s.screen(),s.host.d3d.frames-start);
    }
  }
}catch(error){console.error(error.stack);console.log('ERROR_STATE',s.screen(),s.m.reg('EIP').toString(16),s.m.readWords(s.m.reg('ESP'),16).map(x=>x.toString(16)));writeFileSync(out+'/fault-memory.bin',s.m.view(0x10000,0x8000000-0x10000));writeFileSync(out+'/fault.json',JSON.stringify({threads:s.scheduler.threads.map(t=>({id:t.id,regs:Array.from(t.context.reg32),pc:t.context.instruction_pointer[0]})),allocations:[...s.host.allocations],free:s.host.freeBlocks,objects:[...s.host.d3d.com.objects.values()].map(o=>({...o,handlers:undefined,surface:undefined,texture:undefined,refOwner:undefined,params:undefined,back:undefined,depth:undefined,target:undefined,depthTarget:undefined}))},null,2));process.exitCode=1;}
finally{writeFileSync(out+'/calls.json',JSON.stringify([...s.host.calls],null,2));writeFileSync(out+'/text.json',JSON.stringify([...s.fonts.text],null,2));writeFileSync(out+'/fonts.json',JSON.stringify([...s.fonts.fonts.values()],null,2));writeFileSync(out+'/log.json',JSON.stringify(s.host.log.map(x=>({...x,data:undefined})),null,2));for(const [name,data] of s.host.overlay)if(data){const path=out+'/'+name;mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});writeFileSync(path,data);}s.close();}
