import {PEImage} from './pe.mjs';

// Load the exact x86 D3DX helper library into the same emulated address space.
// Relocations and calls stay in the guest; OS imports use our browser host.
export function loadLibrary(machine,bytes,base,name){
  const image=new PEImage(bytes),delta=base-image.base;
  machine.view(base,image.size).fill(0);machine.write(base,bytes.subarray(0,image.headerSize));
  for(const section of image.sections)if(section.rawSize)machine.write(base+section.rva,bytes.subarray(section.raw,section.raw+section.rawSize));
  const reloc=image.directories[5];
  if(delta){if(!reloc.rva)throw new Error('DLL has no relocation table: '+name);
    for(let offset=0;offset<reloc.size;){const p=base+reloc.rva+offset,page=machine.u32(p),size=machine.u32(p+4);if(size<8)break;
      const entries=new DataView(machine.bytes(p+8,size-8).buffer);
      for(let i=0;i<size-8;i+=2){const value=entries.getUint16(i,true),kind=value>>>12,address=base+page+(value&4095);if(kind===3)machine.u32(address,machine.u32(address)+delta);else if(kind!==0)throw new Error('Unsupported DLL relocation '+kind);}
      offset+=size;
    }
  }
  for(const entry of image.imports)machine.u32(entry.address+delta,machine.registerImport(entry));
  const exports=new Map([...image.exports].map(([key,rva])=>[key,base+rva]));
  for(const entry of machine.image.imports)if(entry.dll.toLowerCase()===name.toLowerCase()){
    const address=exports.get(entry.name);if(!address)throw new Error('Missing DLL export '+entry.name);machine.u32(entry.address,address);
  }
  return {image,base,name,exports,entry:image.entry+delta};
}
