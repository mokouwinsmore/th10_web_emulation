from pathlib import Path
from zipfile import ZipFile
import hashlib,json
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
archive=root.parent/f'th10_web_{version}.zip'
target=(root/'artifacts'/f'[解压验证] {version} 空格').resolve()
with ZipFile(archive) as z:
 assert z.testzip() is None
 names=z.namelist()
 assert all(n.startswith('th10_web/') and (target/n).resolve().is_relative_to(target) for n in names)
 assert not any(any(x in n.lower() for x in ['oracle','node_modules','/reference/','/artifacts/','test-entry']) for n in names)
 assert sorted(n for n in names if n.endswith('.exe'))==['th10_web/dist/data/th10.exe','th10_web/dist/data/th10chs.exe','th10_web/tools/node.exe']
 z.extractall(target)
game=target/'th10_web';dist=game/'dist';manifest=json.loads((dist/'manifest.json').read_text())
assert manifest['game']=='th10'
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
assert (root/'index.html').read_bytes()==(dist/'index.html').read_bytes()
for p in (root/'runtime').iterdir():
 if p.suffix in ['.mjs','.js']:assert p.read_bytes()==(dist/'runtime'/p.name).read_bytes(),p.name
for variant in manifest['variants'].values():
 for name,digest in variant['hashes'].items():assert sha(dist/'data'/name)==digest,name
assert sha(dist/'native'/manifest['d3dx']['file'])==manifest['d3dx']['sha256']
music=hashlib.sha256();size=0
for p in sorted((dist/'data'/'thbgm').glob('*.bin')):
 data=p.read_bytes();music.update(data);size+=len(data)
assert size==manifest['music']['size'];assert music.hexdigest()==manifest['music']['sha256']
result={'archive':str(archive),'bytes':archive.stat().st_size,'files':len(names),'sha256':sha(archive),'extracted':str(game),'asset_hashes':'pass','music_bytes':size,'unexpected_executables':False}
(root/'artifacts'/'package-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
(archive.parent/(archive.name+'.sha256')).write_text(result['sha256']+'  '+archive.name+'\n',encoding='ascii')
print(json.dumps(result,ensure_ascii=False))
