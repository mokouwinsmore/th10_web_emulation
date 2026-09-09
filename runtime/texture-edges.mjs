// TH10's ARGB4444 transparent-edge colors, before D3DX scales a text atlas.
// Alpha stays unchanged; only the four opaque neighbors contribute, with the
// original integer division followed by the original one-bit attenuation.
export function colorTransparentEdges(pixels,width,height,rows){
  for(let y=0,p=0;y<rows;y++)for(let x=0;x<width;x++,p++){
    if(pixels[p]&0xf000)continue;
    let red=0,green=0,blue=0,count=0;
    const add=q=>{const v=pixels[q];if(v&0xf000){red+=v>>8&15;green+=v>>4&15;blue+=v&15;count++;}};
    if(x>0)add(p-1);if(x+1<width)add(p+1);if(y>0)add(p-width);if(y+1<height)add(p+width);
    if(count>1){red=(red/count)|0;green=(green/count)|0;blue=(blue/count)|0;}
    pixels[p]=(red>>1)<<8|(green>>1)<<4|(blue>>1);
  }
}

export function installTextureEdges(host){
  const m=host.m,address=0x436da0,original=m.bytes(address,5);
  if(!original.every((byte,i)=>byte===[0x83,0xec,0x14,0x53,0x55][i]))throw new Error('Unexpected TH10 texture-edge code');
  const trampoline=m.allocate(16),jump=new Uint8Array(5);jump[0]=0xe9;new DataView(jump.buffer).setInt32(1,address+5-(trampoline+5)-5,true);m.cpu.mem_write(trampoline,[...original,...jump]);
  m.replace(address,'TH10.TextureEdges',args=>{
    const [object,rows]=args,width=m.u32(object+0x104),height=m.u32(object+0x108),pitch=m.u32(object+0x110);
    if(m.u32(object+0x100)!==26||!width||!rows||rows>height||pitch!==width*2){m.reg('EIP',trampoline);return {blocked:true};}
    const bytes=m.view(m.u32(object+0x120),width*Math.min(rows+1,height)*2);
    colorTransparentEdges(new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),width,height,rows);
    return (rows&0xffffff00)|1;
  },2);
}
