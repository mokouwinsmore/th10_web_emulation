import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import koffi from 'koffi';
import {FontOracle} from '../scripts/native/font-oracle.mjs';import {GDIFonts} from '../runtime/gdi-fonts.mjs';import {decode932,encode932,decode936,encode936} from '../runtime/encoding.mjs';
for(const charset of [128,134])test(`portable ${charset===128?'Japanese':'Chinese'} GDI matches native Windows pixels at all original sizes`,()=>{
  const blend=new Uint8Array(gunzipSync(readFileSync('assets/fonts/blend.bin.gz'))),oracle=new FontOracle(1024,65);let seed=70;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  try{for(let size=32;size<=60;size+=2){const data=JSON.parse(gunzipSync(readFileSync(`assets/fonts/${charset}/${size}-400.json.gz`))),fonts=new GDIFonts(blend,[data]),chars=Object.keys(data.glyphs);oracle.select(data.font,data.face);
    for(let trial=0;trial<12;trial++){const text=trial===0?(charset===128?'霊符「夢想封印」 東方風神録 0123':'简体中文 东方风神录「灵击」0123'):Array.from({length:12},()=>chars[random()%chars.length]).join(''),color=random()&0xffffff,x=trial%3===0?-10:trial%7,y=trial%5===0?-5:trial%11;
      for(let p=0;p<oracle.pixels.length;p++)oracle.pixels[p]=random()&65535;const portable=new Uint8Array(oracle.pixels.buffer.slice(0));oracle.draw(text,color,x,y);fonts.draw({font:data,color,mode:1},{bpp:16,width:1024,height:65,pitch:2048},x,y,text,portable);
      assert.ok(Buffer.from(portable).equals(Buffer.from(oracle.pixels.buffer)),`${charset}/${size}/${trial}: ${text}`);
    }
  }}finally{oracle.close();}
});
test('original ANSI text decoding matches Windows GDI for Japanese and Chinese, including truncated lines',()=>{
  const textA=koffi.load('gdi32.dll').func('int __stdcall TextOutA(void *,int,int,const void *,int)'),oracle=new FontOracle(1024,65),blend=new Uint8Array(gunzipSync(readFileSync('assets/fonts/blend.bin.gz')));
  try{for(const [charset,encode,decode,text] of [[128,encode932,decode932,'これは、神様との信仰のお話です。'],[134,encode936,decode936,'这是一个关于神明与信仰的故事。']]){
    const data=JSON.parse(gunzipSync(readFileSync(`assets/fonts/${charset}/32-400.json.gz`))),fonts=new GDIFonts(blend,[data]);oracle.select(data.font,data.face);const full=encode(text);
    for(const bytes of [full,full.subarray(0,full.length-1),Uint8Array.of(65,0x81),Uint8Array.of(65,0x81,0x22,66)]){oracle.pixels.fill(0x8421);oracle.fn.color(oracle.dc,0xc0e0ff);const portable=new Uint8Array(oracle.pixels.buffer.slice(0));textA(oracle.dc,4,2,bytes,bytes.length);oracle.fn.flush();fonts.draw({font:data,color:0xc0e0ff,mode:1},{bpp:16,width:1024,height:65,pitch:2048},4,2,decode(bytes),portable);assert.ok(Buffer.from(portable).equals(Buffer.from(oracle.pixels.buffer)),`${charset}: ${Buffer.from(bytes).toString('hex')} -> ${JSON.stringify(decode(bytes))}`);}
  }}finally{oracle.close();}
});
