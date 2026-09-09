// TH10 1.00a's stdcall decompressor (435dc0) and its shared 8192-byte dictionary.
// Finish a decode atomically: title loading and score loading use the same
// dictionary from different original threads. Emulation quanta must not
// interleave these short native calls in the middle of a compressed stream.
export function decodeLzss(input,output,dict){
  let cursor=0,mask=128,byte=0,head=1,written=0;
  const bit=()=>{if(mask===128)byte=cursor<input.length?input[cursor++]:0;const value=byte&mask?1:0;mask>>=1;if(!mask)mask=128;return value;};
  const bits=n=>{let value=0;for(let i=0;i<n;i++)value=value*2+bit();return value;};
  const put=value=>{if(written>=output.length)throw new Error('TH10 LZSS output exceeds declared size');output[written++]=value;dict[head]=value;head=(head+1)&8191;};
  for(;;){if(bit())put(bits(8));else{const offset=bits(13);if(!offset)break;const length=bits(4)+3;for(let i=0;i<length;i++)put(dict[(offset+i)&8191]);}}
  return written;
}
export function installLzss(host){const m=host.m;m.replace(0x435dc0,'TH10.LzssDecode',a=>{const output=a[2]||host.alloc(a[3]);decodeLzss(m.view(a[0],a[1]),m.view(output,a[3]),m.view(0x48f868,8192));return output;},4);}
