import {NativeMachine,hex} from './machine.mjs';
import {PEImage} from './pe.mjs';
const regs={EAX:0,ECX:1,EDX:2,EBX:3,ESP:4,EBP:5,ESI:6,EDI:7},segments={ES:0,CS:1,SS:2,DS:3,FS:4,GS:5};
const contextFields=['reg32','segment_is_null','segment_offsets','segment_limits','segment_access_bytes','protected_mode','idtr_size','idtr_offset','gdtr_size','gdtr_offset','tss_size_32','cr','cpl','is_32','stack_size_32','last_virt_eip','eip_phys','prefixes','flags','flags_changed','last_op_size','last_op1','last_result','instruction_pointer','previous_ip','fpu_st','fpu_stack_empty','fpu_stack_ptr','fpu_control_word','fpu_status_word','fpu_ip','fpu_ip_selector','fpu_opcode','fpu_dp','fpu_dp_selector','reg_xmm32s','mxcsr','sreg','dreg','reg_pdpte'];
export class JitMachine extends NativeMachine {
  static async create(bytes,options={}){const m=new JitMachine();await m.init(bytes,options);return m;}
  async init(bytes,options){
    const V86=options.factory??globalThis.V86??(await import('v86')).V86;
    this.vm=new V86({wasm_path:options.wasmPath??'node_modules/v86/build/v86.wasm',memory_size:128*1024*1024,vga_memory_size:1024*1024,autostart:false,disable_speaker:true,disable_keyboard:true,disable_mouse:true});
    await new Promise(resolve=>this.vm.add_listener('emulator-ready',resolve));const c=this.core=this.vm.v86.cpu;
    this.image=new PEImage(bytes);this.hooks=[];this.heap=0x02000000;this.stack=0x07efff00;this.returnAddress=0x07f00000;this.importMap=new Map();this.stubAddress=0x07e00000;
    this.wasmMemory=c.wasm_memory;this.hostMemory=c.mem8.byteOffset+0x10000;
    c.mem8.fill(0);c.write_blob(bytes.subarray(0,this.image.headerSize),this.image.base);for(const s of this.image.sections)if(s.rawSize)c.write_blob(bytes.subarray(s.raw,s.raw+s.rawSize),this.image.base+s.rva);
    c.cr[0]=1;c.protected_mode[0]=1;c.is_32[0]=1;c.stack_size_32[0]=1;c.cpl[0]=0;c.flags[0]=2;c.flags_changed[0]=0;c.segment_is_null.fill(0);c.segment_offsets.fill(0);c.segment_limits.fill(0xffffffff);c.segment_access_bytes.fill(0x93);c.segment_access_bytes[1]=0x9b;c.update_state_flags();c.full_clear_tlb();
    const gdt=new Uint8Array(32),v=new DataView(gdt.buffer);for(const [index,base,type] of [[1,0,0x9b],[2,0,0x93],[3,0x11000,0x93]]){const o=index*8;v.setUint16(o,0xffff,true);v.setUint16(o+2,base&0xffff,true);gdt[o+4]=base>>>16&255;gdt[o+5]=type;gdt[o+6]=0xcf;gdt[o+7]=base>>>24;}c.write_blob(gdt,0x10000);c.gdtr_offset[0]=0x10000;c.gdtr_size[0]=31;
    for(const [name,value] of [['CS',8],['DS',16],['ES',16],['SS',16],['FS',24],['ESP',this.stack],['FPCW',0x37f]])this.reg(name,value);
    this.u32(0x11000,0xffffffff);this.u32(0x11018,0x11000);this.u32(0x11004,this.stack+256);this.u32(0x11008,this.stack-0x100000);c.write_blob(Uint8Array.of(0xf4),this.returnAddress);
    const m=this;this.cpu={
      emu_start(begin,until,timeout,limit){m.run(begin,until,limit);},emu_stop(){m.stopped=true;},
      mem_write(address,bytes){c.write_blob(Uint8Array.from(bytes),address);},
      context_alloc(){return {};},context_save(context){for(const name of contextFields){if(context[name])context[name].set(c[name]);else context[name]=c[name].slice();}},context_restore(context){const changed=c.cr[0]!==context.cr[0]||c.cr[3]!==context.cr[3]||c.cr[4]!==context.cr[4]||c.cpl[0]!==context.cpl[0];for(const name of contextFields)c[name].set(context[name]);c.wm.exports.set_control_word(c.fpu_control_word[0]);c.in_hlt[0]=0;c.update_state_flags();if(changed)c.full_clear_tlb();},context_free(){},
    };
    for(const entry of this.image.imports)this.u32(entry.address,this.registerImport(entry));
  }
  reg(name,value){const c=this.core;if(name in regs){if(value===undefined)return c.reg32[regs[name]]>>>0;c.reg32[regs[name]]=value;return;}
    if(name==='EIP'){if(value===undefined)return c.instruction_pointer[0]>>>0;c.instruction_pointer[0]=value;c.last_virt_eip[0]=-1;return;}
    if(name==='EFLAGS'){if(value===undefined)return c.get_eflags()>>>0;c.flags[0]=value;c.flags_changed[0]=0;return;}
    if(name==='FPCW'){if(value===undefined)return c.fpu_control_word[0];c.wm.exports.set_control_word(value);return;}
    if(name in segments){const id=segments[name];if(value===undefined)return c.sreg[id];c.sreg[id]=value;const d=this.view(0x10000+(value&~7),8);c.segment_offsets[id]=(d[2]|d[3]<<8|d[4]<<16|d[7]<<24);c.update_state_flags();return;}
    throw new Error('Unknown JIT register '+name);
  }
  registerImport(entry){const address=this.stubAddress;this.stubAddress+=16;this.importMap.set(address,entry);this.core.write_blob(Uint8Array.of(0xf4),address);return address;}
  resetThreadFPU(){const c=this.core;this.reg('FPCW',0x27f);c.wm.exports.fpu_load_status_word(0);c.wm.exports.fpu_load_tag_word(0xffff);c.fpu_stack_ptr[0]=0;c.mxcsr[0]=0x1f80;c.reg_xmm32s.fill(0);}
  u32(address,value){if(address&3)return super.u32(address,value);if(address<0x10000||address+4>0x08000000)throw new Error('Guest word bounds '+hex(address));const words=this.core.mem32s,index=address>>>2;if(value===undefined)return words[index]>>>0;words[index]=value|0;}
  readWords(address,count){if(address&3)return super.readWords(address,count);if(address<0x10000||count<0||address+count*4>0x08000000)throw new Error('Guest word range '+hex(address));const words=this.core.mem32s,index=address>>>2,result=new Array(count);for(let i=0;i<count;i++)result[i]=words[index+i]>>>0;return result;}
  run(begin,until,limit=1000000){const c=this.core;this.stopped=false;this.reg('EIP',begin);c.in_hlt[0]=0;const start=c.instruction_counter[0];
    while(!this.stopped&&((c.instruction_counter[0]-start)>>>0)<(limit||1000000)){
      c.main_loop();if(this.profile&&!c.in_hlt[0]){this.samples??=new Map();const pc=this.reg('EIP');this.samples.set(pc,(this.samples.get(pc)??0)+1);}if(c.in_hlt[0]){const address=(this.reg('EIP')-1)>>>0;c.in_hlt[0]=0;
        if(address===until||address===this.returnAddress){this.reg('EIP',address);return;}
        const entry=this.importMap.get(address);if(!entry)throw new Error('Unexpected x86 HLT at '+hex(address));this.reg('EIP',address);if(!this.onImport)throw new Error('Unimplemented '+entry.name);this.onImport(entry);
      }
      const pc=this.reg('EIP');if(pc<0x400000||pc>=0x08000000)throw new Error('x86 exception at '+hex(pc));
    }
  }
  close(){this.vm.destroy();}
}
