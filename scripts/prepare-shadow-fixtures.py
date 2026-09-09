from pathlib import Path
import copy,json
c=json.loads(Path('artifacts/browser-quality-chs/pixels/stage1.json').read_text())[0]
out=Path('artifacts/shadow-check');out.mkdir(exist_ok=True);cases=[]
for fog in [0,1]:
 for depth in [0,1]:
  q=copy.deepcopy(c);q['name']=f'shadow-f{fog}-z{depth}';q.pop('initialPixels',None);q['clear']=0xff708090;q['draws']=q['draws'][12:30];q['ops']=[];q['textures']=q['textures'][:3]
  for d in q['draws']:
   s=dict(d['states']);s[28]=fog;s[7]=depth;d['states']=list(s.items())
  cases.append(q)
(out/'cases.json').write_text(json.dumps(cases))
