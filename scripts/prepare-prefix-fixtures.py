from pathlib import Path
import json,copy
root=Path('artifacts/prefix-check');root.mkdir(exist_ok=True)
source=json.loads(Path('artifacts/browser-quality-chs/pixels/stage1.json').read_text())[0]
cases=[]
for count in [1,10,20,30,31,32,33,34,35,36,37,38,39,40,60]:
 c=copy.deepcopy(source);c['name']='prefix-'+str(count);c['draws']=c['draws'][:count];c['ops']=[op for op in c['ops'] if op['before']<=count]
 textures=[];mapping={}
 for d in c['draws']:
  i=d['texture']
  if i<0:continue
  if i not in mapping:mapping[i]=len(textures);textures.append(c['textures'][i])
  d['texture']=mapping[i]
 c['textures']=textures;cases.append(c)
(root/'cases.json').write_text(json.dumps(cases))
