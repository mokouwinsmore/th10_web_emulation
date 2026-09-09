import {FontOracle} from './font-oracle.mjs';
export class WindowsFonts{
  constructor(){this.oracles=new Map();this.fonts=new Map();this.text=new Set();}
  font(value){const key=JSON.stringify([value.font,value.face]);if(!this.fonts.has(key)){this.fonts.set(key,value);console.log('FONT',key);}}
  draw(dc,bitmap,x,y,text,pixels){
    const key=JSON.stringify([bitmap.width,bitmap.height,dc.font.font,dc.font.face]);let oracle=this.oracles.get(key);
    if(!oracle){oracle=new FontOracle(bitmap.width,bitmap.height);oracle.select(dc.font.font,dc.font.face);this.oracles.set(key,oracle);}
    new Uint8Array(oracle.pixels.buffer).set(pixels);oracle.draw(text,dc.color,x,y);pixels.set(new Uint8Array(oracle.pixels.buffer));this.text.add(text);
  }
  close(){for(const oracle of this.oracles.values())oracle.close();}
}
