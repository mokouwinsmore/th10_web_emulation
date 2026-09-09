export class Scheduler {
  constructor(machine,host){this.m=machine;this.host=host;this.threads=[];this.nextStack=0x07dff000;this.nextTEB=0x12000;
    machine.u32(machine.stack-4,machine.returnAddress);machine.reg('ESP',machine.stack-4);machine.reg('EIP',machine.image.entry);this.threads.push(this.capture({id:1,ready:0,teb:0x11000}));
  }
  capture(t){t.context??=this.m.cpu.context_alloc();this.m.cpu.context_save(t.context);return t;}
  addPending(){const m=this.m;for(const pending of this.host.pendingThreads.splice(0)){
    const sameThread=this.threads.find(t=>t.id===pending.id),existing=sameThread??this.threads.find(t=>t.id!==1&&t.done&&(!t.timer||!this.host.handles.has(t.timer)));m.cpu.context_restore(sameThread?.context??this.threads[0].context);const stack=existing?.stack??this.nextStack;if(!existing)this.nextStack-=0x20000;const teb=existing?.teb??this.nextTEB;if(!existing)this.nextTEB+=0x1000;
    if(!sameThread){m.view(stack-0x1f000,0x20000).fill(0);m.resetThreadFPU?.();for(const register of ['EAX','EBX','ECX','EDX','ESI','EDI','EBP'])m.reg(register,0);}
    m.u32(teb,0xffffffff);m.u32(teb+4,stack+0x1000);m.u32(teb+8,stack-0x1f000);m.u32(teb+0x18,teb);m.u32(teb+0x24,pending.id);
    m.write(0x10000+24+2,[teb&255,(teb>>>8)&255,(teb>>>16)&255]);m.write(0x10000+24+7,[teb>>>24]);m.reg('FS',24);
    const args=pending.args??[pending.parameter];let sp=stack;for(let i=args.length-1;i>=0;i--){sp-=4;m.u32(sp,args[i]);}sp-=4;m.u32(sp,m.returnAddress);m.reg('ESP',sp);m.reg('EIP',pending.entry);m.reg('EAX',0);m.reg('EFLAGS',2);
    if(existing){Object.assign(existing,{...pending,done:false,ready:this.host.millis,wait:0,lock:0});this.capture(existing);this.host.handles.get(existing.id).done=false;}else this.threads.push(this.capture({...pending,ready:this.host.millis,teb,stack}));
  }}
  queueTimer(id,timer){const h=this.host;if(!timer.pending?.length)return false;timer.thread??=h.handle({kind:'thread',done:true});if(!h.handles.get(timer.thread)?.done)return false;h.pendingThreads.push({id:timer.thread,entry:timer.callback,args:[id,0,timer.parameter,0,0],timer:id,eventTime:timer.pending.shift()});h.handles.get(timer.thread).done=false;return true;}
  step(limit=1_000_000){
    const m=this.m,h=this.host,before=h.millis;this.addPending();let ran=false;
    h.sound.advance();
    for(const [timerId,timer] of h.handles)if(timer.kind==='multimedia-timer'){timer.interval=Math.max(1,timer.interval);timer.pending??=[];while(h.millis-timer.last>=timer.interval){timer.last+=timer.interval;if(timer.flags&0x10){const e=h.handles.get(timer.callback);if(e)e.signaled=true;}else if(timer.callback)timer.pending.push(timer.last);if(!(timer.flags&1)){timer.last=Infinity;break;}}this.queueTimer(timerId,timer);}
    this.addPending();
    for(const t of this.threads){if(t.done||h.handles.get(t.id)?.suspended||t.ready>h.millis||(t.wait&& !h.handles.get(t.wait)?.done)||(t.lock&&h.critical.get(t.lock)?.owner&&h.critical.get(t.lock)?.owner!==t.id))continue;
      do{ran=true;h.currentThreadId=t.id;h.callbackTime=t.eventTime;h.sleepMs=0;h.waitHandle=0;h.waitLock=0;h.yielded=false;m.cpu.context_restore(t.context);
      m.cpu.emu_start(m.reg('EIP'),m.returnAddress,0,limit);this.capture(t);
      if(m.reg('EIP')===m.returnAddress){t.done=true;if(h.handles.has(t.id))h.handles.get(t.id).done=true;}
      t.ready=h.millis+h.sleepMs;t.wait=h.waitHandle;t.lock=h.waitLock;
      const timer=h.handles.get(t.timer);if(t.done&&timer&&this.queueTimer(t.timer,timer)){this.addPending();continue;}break;
      }while(true);h.callbackTime=undefined;
      if(h.exitCode!==undefined)break;
    }
    if(!ran){const due=this.threads.filter(t=>!t.done&&!t.wait).map(t=>t.ready);if(due.length)h.millis=Math.max(h.millis,Math.min(...due));}
    if(h.millis===before)h.millis+=1;
    return ran;
  }
  close(){for(const t of this.threads)this.m.cpu.context_free(t.context);}
}
