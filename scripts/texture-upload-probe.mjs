import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {launchBrowser} from './native/browser-launch.mjs';
const browser=await launchBrowser(),page=await browser.newPage();
try{await page.goto('http://127.0.0.1:8091');const result=await page.evaluate(async()=>{
  const {WebGLD3D9}=await import('/runtime/webgl.mjs'),canvas=new OffscreenCanvas(256,256),gl=canvas.getContext('webgl2'),r=Object.create(WebGLD3D9.prototype),results=[];
  r.gl=gl;r.surfaces=new Map();r.stats={uploadBytes:0};
  for(const format of [21,22,23,24,25,26,28,50]){
    const bpp=format<=22?4:format<=26?2:1,input=new Uint8Array(65536*bpp),s={address:format,width:256,height:256,pitch:256*bpp,format,data:0,size:input.length,version:0};r.m={view:()=>input};
    for(let pass=0;pass<2;pass++){
      if(bpp===2){const words=new Uint16Array(input.buffer);for(let i=0;i<words.length;i++)words[i]=i^(pass?0x5a5a:0);}
      else for(let i=0;i<input.length;i++)input[i]=(i*31+(i>>>8)*47+pass*19)&255;
      s.version++;const gpu=r.surface(s),actual=new Uint8Array(65536*4);gl.bindFramebuffer(gl.FRAMEBUFFER,gpu.framebuffer);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,actual);
      // The previous upload path expanded to RGBA8 and specified new storage.
      const texture=gl.createTexture(),framebuffer=gl.createFramebuffer(),rgba=r.pixels(s),rgb=[22,23].includes(format);let pixels=rgba;
      if(rgb){pixels=new Uint8Array(65536*3);for(let i=0,j=0;i<rgba.length;i+=4){pixels[j++]=rgba[i];pixels[j++]=rgba[i+1];pixels[j++]=rgba[i+2];}}
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,format===23?gl.RGB565:format===24||format===25?gl.RGB5_A1:format===26?gl.RGBA4:rgb?gl.RGB8:gl.RGBA8,256,256,0,rgb?gl.RGB:gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);const expected=new Uint8Array(actual.length);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,expected);
      let different=0;for(let i=0;i<actual.length;i++)different+=actual[i]!==expected[i];results.push({format,pass,different,error:gl.getError()});gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);
    }
  }return results;
});mkdirSync('artifacts/text-texture-upload',{recursive:true});writeFileSync('artifacts/text-texture-upload/results.json',JSON.stringify(result,null,2));for(const r of result){assert.equal(r.different,0,JSON.stringify(r));assert.equal(r.error,0,JSON.stringify(r));}console.log('PASS',result.length,'GPU upload comparisons; all 65536 ARGB4444 values included');
}finally{await browser.close();}
