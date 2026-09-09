from pathlib import Path
import json,base64,struct
out=Path('artifacts/depth-check');out.mkdir(exist_ok=True);cases=[]
for base in [0.1,0.5,0.9]:
 for delta in [0,0.0000001,0.000001,0.00001,0.0001]:
  c=dict(name=f'depth-{base}-{delta}',width=16,height=16,format=22,clear=0xff000000,textures=[],draws=[],ops=[])
  for depth,color in [(base,0xffff0000),(base+delta,0xff00ff00)]:
   vertices=b''.join(struct.pack('<4fI',x,y,depth,1,color) for x,y in [(-0.5,-0.5),(15.5,-0.5),(-0.5,15.5),(15.5,15.5)])
   c['draws'].append(dict(texture=-1,vertices=base64.b64encode(vertices).decode(),stride=20,fvf=0x44,primitive=5,count=2,states=[[7,1],[14,1],[23,4],[15,0],[22,1],[27,0],[28,0],[137,0],[168,15]],stages=[[1,1]],transforms=[],viewport=base64.b64encode(struct.pack('<4I2f',0,0,16,16,0,1)).decode()))
  cases.append(c)
(out/'cases.json').write_text(json.dumps(cases))
