from pathlib import Path
s=Path('../th08_web/scripts/native/d3d-pixel-check.mjs').read_text(encoding='utf-8')
body=s[s.index('const rendered=await page.evaluate(async cases=>{'):s.index("console.log('WEBGL_RENDERER'")]
body=body.replace('WebGLD3D8','WebGLD3D9').replace('host.alloc(52)','host.alloc(56)')
header="""import {launchBrowser} from './native/browser-launch.mjs';import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
const root=process.argv[2]??'artifacts/browser-quality-chs/pixels',cases=readdirSync(root).filter(n=>n.endsWith('.json')&&n!=='comparison.json').flatMap(n=>JSON.parse(readFileSync(root+'/'+n))),browser=await launchBrowser(),page=await browser.newPage();mkdirSync(root+'/rerender',{recursive:true});
try{await page.goto('http://127.0.0.1:8091');
"""
footer="""
const summary=[];for(const r of rendered){const a=Uint8Array.from(r.pixels),b=readFileSync(root+'/windows/'+r.name+'.bin'),c=cases.find(c=>c.name===r.name);writeFileSync(root+'/rerender/'+r.name+'.bin',a);let count=0,total=0,max=0;for(let i=0;i<a.length;i++){if(c.format===22&&i%4===3)continue;const d=Math.abs(a[i]-b[i]);count+=d!==0;total+=d;max=Math.max(d,max);}summary.push({name:r.name,count,max,mean:total/(c.width*c.height*3)});}console.table(summary);writeFileSync(root+'/rerender/result.json',JSON.stringify(summary,null,2));
}finally{await browser.close();}
"""
Path('scripts/render-fixtures.mjs').write_text(header+body+footer,encoding='utf-8')
