import {interfaces} from './interfaces.mjs';
export class COM {
  constructor(host){this.host=host;this.m=host.m;this.objects=new Map();this.vtables=new Map();}
  create(kind,handlers,state={}){
    let vtable=this.vtables.get(kind);
    if(!vtable){
      const schema=interfaces[kind];if(!schema)throw new Error('Unknown COM interface '+kind);
      vtable=this.host.alloc(schema.length*4);this.vtables.set(kind,vtable);
      schema.forEach(([name,argc],index)=>this.m.u32(vtable+index*4,this.m.registerImport({dll:kind,name:kind+'.'+name,argc,handler:a=>{
        const object=this.objects.get(a[0]);if(!object)throw new Error('Invalid COM object '+a[0].toString(16));
        if(name==='QueryInterface'){if(object.handlers.QueryInterface)return object.handlers.QueryInterface(a.slice(1,argc));this.m.u32(a[2],a[0]);this.addRef(object);return 0;}
        if(name==='AddRef')return this.addRef(object);
        if(name==='Release')return this.release(object);
        const method=object.handlers[name];if(!method)throw new Error('Unimplemented '+kind+'.'+name+' args='+a.slice(1,argc).map(n=>n.toString(16)));
        return method.call(object,a.slice(1,argc));
      }})));
    }
    const address=this.host.alloc(16),object={...state,address,kind,refs:1,handlers};this.m.u32(address,vtable);this.objects.set(address,object);return object;
  }
  get(address){const o=this.objects.get(address);if(!o)throw new Error('Missing COM object '+address.toString(16));return o;}
  addRef(value){const object=typeof value==='number'?this.get(value):value;return ++(object.refOwner??object).refs;}
  release(value){const object=typeof value==='number'?this.get(value):value;if(object.refOwner)return this.release(object.refOwner);if(object.refs<=0)throw new Error('Released COM object '+object.kind);const refs=--object.refs;if(!refs){object.destroy?.();this.forget(object);}return refs;}
  forget(object){this.objects.delete(object.address);this.host.free(object.address);}
}
