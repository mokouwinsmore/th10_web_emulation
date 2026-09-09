from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib,json
root=Path(__file__).resolve().parent.parent;version=json.loads((root/'package.json').read_text())['version'];target=root.parent/f'th10_web_{version}.zip'
files=[p for p in (root/'dist').rglob('*') if p.is_file()]
files.extend(root/name for name in ['启动风神录网页版.cmd','游玩说明.txt','README.md','package.json','scripts/serve.mjs','tools/node.exe','tools/Node.LICENSE'])
files.extend(p for p in (root/'docs').rglob('*') if p.is_file())
for p in files:
 if not p.is_file():raise FileNotFoundError(p)
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(files):z.write(p,'th10_web/'+p.relative_to(root).as_posix())
print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'files':len(files),'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest()},ensure_ascii=False))
