// Bounded local profiling carrier. Uses the real hosted runtime protocol, but
// does not build/watch the launcher or claim launcher integration acceptance.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname} from 'node:path';

export async function performanceFixture(project, {source = true} = {}) {
  const generated = resolve(project, 'artifacts/validation/th10-touch');
  const manifest = JSON.parse(await readFile(resolve(generated, 'runtime/runtime-files.json'), 'utf8'));
  const files = new Map();
  for (const name of Object.keys(manifest.files)) {
    if (name.split('/').some(part => !part || part === '..' || part.includes('\\'))) throw Error('Invalid runtime member');
    files.set('/' + name, resolve(generated, 'runtime', name));
    if (source && (/^runtime\/[a-z0-9-]+\.(mjs|js)$/.test(name) || name === 'th10.html')) files.set('/' + name, resolve(project, name));
  }
  files.set('/game.data', resolve(generated, 'content/th10.data'));
  const html = `<!doctype html><title>TH10 isolated performance fixture</title>
<style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<script>
window.__eaglerPrepareManagedRuntimeDataV1=async()=>({buffer:await(await fetch('/game.data')).arrayBuffer()});
window.fixtureReady=false;window.fixtureErrors=[];let serial=0;const pending=new Map();
window.command=(command,extra={})=>new Promise((resolve,reject)=>{
 const request=++serial,timer=setTimeout(()=>{pending.delete(request);reject(Error('Fixture command timeout'));},30000);
 pending.set(request,{resolve,reject,timer});document.querySelector('iframe').contentWindow.postMessage({protocol:'eagler-touhou/1',game:'th10',command,request,...extra},location.origin);
});
addEventListener('message',event=>{
 if(event.source!==document.querySelector('iframe').contentWindow||event.origin!==location.origin)return;
 const m=event.data;if(m.protocol!=='eagler-touhou/1'||m.game!=='th10')return;
 if(m.event==='ready')window.fixtureReady=true;
 if(m.event==='error')window.fixtureErrors.push(m.error);
 const p=pending.get(m.request);if(p){clearTimeout(p.timer);pending.delete(m.request);m.ok?p.resolve(m):p.reject(Error(m.error));}
});
window.fixtureLaunch=async()=>{await command('configure',{music:'none',resources:[],options:{touchEnabled:false}});await command('launch');};
</script><iframe src="/th10.html?hosted=1&managedData=1"></iframe>`;
  const requests = new Map();
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/') {res.setHeader('Content-Type', 'text/html');res.end(html);return;}
      const file = files.get(path);
      if (!file) {res.writeHead(404).end();return;}
      const info = await stat(file);
      if (!info.isFile() || info.size > 32 * 1024 * 1024) throw Error('Fixture file exceeds budget');
      requests.set(path, (requests.get(path) ?? 0) + info.size);
      const types = {'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'};
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      const stream = createReadStream(file);stream.on('error', () => res.destroy());res.on('close', () => stream.destroy());stream.pipe(res);
    } catch {res.writeHead(500).end();}
  });
  await new Promise((done, fail) => {server.once('error', fail);server.listen(0, '127.0.0.1', done);});
  return {url:`http://127.0.0.1:${server.address().port}/`,requests,
    close:()=>new Promise(done=>{server.close(done);server.closeAllConnections();})};
}
