import {decode932,decode936} from './encoding.mjs';
export function installGDI(host,backend){
  const m=host.m,object=id=>host.handles.get(id),handle=value=>{const obj={kind:'gdi',...value};obj.handle=host.handle(obj);return obj.handle;};
  Object.assign(host.api,{
    CreateDIBSection:[6,a=>{const p=a[1],width=m.i32(p+4),height=Math.abs(m.i32(p+8)),bpp=m.view(p+14,1)[0],pitch=((width*bpp+31)>>>5)*4,size=pitch*height,data=host.alloc(size);m.view(data,size).fill(0);m.u32(a[3],data);return handle({type:'bitmap',data,size,width,height,bpp,pitch});}],
    CreateCompatibleDC:[1,()=>handle({type:'dc',color:0,mode:2})],
    SelectObject:[2,a=>{const dc=object(a[0]),next=object(a[1]);if(!next)return 0;const key=next.type==='font'?'font':'bitmap',old=dc[key];dc[key]=next;return old?.handle??0;}],
    DeleteDC:[1,a=>{host.handles.delete(a[0]);return 1;}],DeleteObject:[1,a=>{const obj=object(a[0]);if(obj?.data)host.free(obj.data);host.handles.delete(a[0]);return 1;}],
    CreateFontA:[14,a=>{const font=a.slice(0,13).map(x=>x|0),face=host.text(a[13]),value={type:'font',font,face};const ready=backend.font?.(value);if(ready?.blocked)return ready;value.handle=handle(value);return value.handle;}],
    SetBkMode:[2,a=>{const dc=object(a[0]),old=dc.mode;dc.mode=a[1];return old;}],SetTextColor:[2,a=>{const dc=object(a[0]),old=dc.color;dc.color=a[1];return old;}],
    TextOutA:[5,a=>{const dc=object(a[0]),bitmap=dc.bitmap,bytes=m.bytes(a[3],a[4]),text=(dc.font.font[8]===134?decode936:decode932)(bytes);return backend.draw(dc,bitmap,a[1]|0,a[2]|0,text,m.view(bitmap.data,bitmap.size))??1;}],
  });
}
