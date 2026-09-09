import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {FontOracle,fontParams} from './native/font-oracle.mjs';
const oracle=new FontOracle(256,112),charset=Number(process.env.FONT_CHARSET??128),face=process.env.FONT_FACE??'ＭＳ ゴシック',decoder=new TextDecoder(charset===134?'gbk':'shift_jis'),chars=new Set();
for(let byte=32;byte<256;byte++){const char=decoder.decode(Uint8Array.of(byte));if(char.length===1&&char!=='\ufffd')chars.add(char);}
for(let lead=0x81;lead<=0xfe;lead++)if(charset===134||lead<=0x9f||lead>=0xe0&&lead<=0xfc)for(let trail=0x40;trail<=0xfe;trail++)if(trail!==0x7f){const char=decoder.decode(Uint8Array.of(lead,trail));if(char.length===1&&char!=='\ufffd')chars.add(char);}
const output=`assets/fonts/${charset}`;mkdirSync(output,{recursive:true});
const sample='霊符夢想WAgQ0123456789',pairs=new Map();oracle.select(fontParams(32,400));oracle.pixels.fill(0x8000);const light=oracle.draw(sample).slice();oracle.pixels.fill(0xffff);const dark=oracle.draw(sample,0).slice();
for(let p=0;p<light.length;p++)if(light[p]!==0x8000){const key=((light[p]&31)<<5)|(dark[p]&31);if(!pairs.has(key))pairs.set(key,{id:pairs.size+1,p});}
if(pairs.size>255)throw new Error('GDI coverage overflow');const blend=new Uint8Array((pairs.size+1)*8192);
for(let bg=0;bg<32;bg++)for(let fg=0;fg<256;fg++){oracle.pixels.fill(0x8000|bg*0x421);oracle.draw(sample,fg*0x10101);for(const {id,p} of pairs.values())blend[id*8192+bg*256+fg]=oracle.pixels[p]&31;}
writeFileSync('assets/fonts/blend.bin.gz',gzipSync(blend,{level:9}));
try{for(const size of (process.env.FONT_SIZES??'32,34,36,38,40,42,44,46,48,50,52,54,56,58,60').split(',').map(Number)){
  const font=fontParams(size,400);font[8]=charset;oracle.select(font,face);const glyphs={};
  for(const char of chars){oracle.pixels.fill(0x8000);const a=oracle.draw(char,0xffffff,16,16).slice();oracle.pixels.fill(0xffff);const b=oracle.draw(char,0,16,16);let left=oracle.width,top=oracle.height,right=0,bottom=0;
    for(let p=0;p<a.length;p++)if(a[p]!==0x8000){const x=p%oracle.width,y=Math.floor(p/oracle.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
    const advance=oracle.advance(char);if(right<=left){glyphs[char]=[advance,0,0,0,0,''];continue;}const pixels=new Uint8Array((right-left)*(bottom-top));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const p=y*oracle.width+x;if(a[p]!==0x8000){const pair=pairs.get(((a[p]&31)<<5)|(b[p]&31));if(!pair)throw new Error(`New GDI coverage ${size}/${char}`);pixels[(y-top)*(right-left)+x-left]=pair.id;}}
    glyphs[char]=[advance,left-16,top-16,right-left,bottom-top,Buffer.from(pixels).toString('base64')];
  }
  const bytes=gzipSync(JSON.stringify({font,face,glyphs}),{level:9});writeFileSync(`${output}/${size}-400.json.gz`,bytes);console.log('BAKED_FONT',charset,size,chars.size,bytes.length);
}}finally{oracle.close();}
