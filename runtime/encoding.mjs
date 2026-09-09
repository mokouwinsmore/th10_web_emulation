const decoder=new TextDecoder('shift_jis');
const chineseDecoder=new TextDecoder('gbk');
let reverse;
let chineseReverse;
export function decode936(bytes){const text=chineseDecoder.decode(bytes);if(!text.includes('\ufffd'))return text;let result='';for(let i=0;i<bytes.length;i++){const byte=bytes[i];if(byte<=0x80)result+=byte===0x80?'€':String.fromCharCode(byte);else if(byte===255)result+='?';else{const trail=bytes[i+1];if(trail===undefined||trail===0){result+='?';continue;}const pair=chineseDecoder.decode(bytes.subarray(i,i+2));result+=pair.length===1&&pair!=='\ufffd'?pair:'?';i++;}}return result;}
export function encode936(text){
  if(!chineseReverse){chineseReverse=new Map();for(let n=0;n<128;n++)chineseReverse.set(String.fromCharCode(n),[n]);chineseReverse.set('€',[128]);
    for(let lead=0x81;lead<=0xfe;lead++)for(let trail=0x40;trail<=0xfe;trail++)if(trail!==0x7f){const bytes=[lead,trail],c=chineseDecoder.decode(Uint8Array.from(bytes));if(c.length===1&&c!=='\ufffd'&&!chineseReverse.has(c))chineseReverse.set(c,bytes);}
  }return Uint8Array.from([...text].flatMap(c=>chineseReverse.get(c)??[63]));
}
export function decode932(bytes){
  const text=decoder.decode(bytes);
  if(!/[\u001a\u001c\u007f\ufffd]/.test(text))return text;
  // Windows CP932 consumes malformed pairs and uses U+30FB, including a
  // dangling lead byte in the original Music Room's fixed-size text lines.
  let result='';
  for(let i=0;i<bytes.length;i++){
    const byte=bytes[i];
    if(byte<=0x80)result+=String.fromCharCode(byte);
    else if(byte>=0xa1&&byte<=0xdf)result+=String.fromCharCode(0xff61+byte-0xa1);
    else if(byte===0xa0||byte>=0xfd)result+=String.fromCharCode(byte===0xa0?0xf8f0:0xf8f1+byte-0xfd);
    else{
      const trail=bytes[i+1];
      if(trail===undefined||trail===0){result+='\u30fb';continue;}
      const pair=decoder.decode(bytes.subarray(i,i+2));
      result+=pair.length===1&&pair!=='\ufffd'?pair:'\u30fb';
      i++;
    }
  }
  return result;
}
export function encode932(text){
  if(!reverse){
    reverse=new Map();for(let n=0;n<256;n++){const c=decoder.decode(new Uint8Array([n]));if(c!=='�')reverse.set(c,[n]);}
    for(let lead=0x81;lead<=0xfc;lead++)if(lead<=0x9f||lead>=0xe0)for(let trail=0x40;trail<=0xfc;trail++)if(trail!==0x7f){const bytes=[lead,trail],c=decoder.decode(new Uint8Array(bytes));if(c.length===1&&c!=='�'&&!reverse.has(c))reverse.set(c,bytes);}
  }
  return new Uint8Array([...text].flatMap(c=>reverse.get(c)??[63]));
}
export function characterType(code){const c=String.fromCharCode(code);return (/[A-Z]/.test(c)?1:0)|(/[a-z]/.test(c)?2:0)|(/[0-9]/.test(c)?4:0)|(/\s/.test(c)?8:0)|(/[!-/:-@[-`{-~]/.test(c)?16:0)|(code<32||code===127?32:0)|(c===' '?64:0)|(/[0-9A-Fa-f]/.test(c)?128:0)|(/\p{L}/u.test(c)?256:0);}
