import pathlib,re,json
root=pathlib.Path(__file__).resolve().parents[1]
base=(root/'runtime/interfaces.mjs').read_text()
interfaces=json.loads(base.split('export const interfaces=',1)[1].split(';',1)[0])
interfaces={k:v for k,v in interfaces.items() if not k.startswith('IDirect3D')}
source=(root/'reference/native/d3d9.h').read_text()
for match in re.finditer(r'DECLARE_INTERFACE(?:_IID_|_)?\(([^,]+),[^\n]+\)\s*\{(.*?)\n\};',source,re.S):
 interface,body=match.groups();methods=[]
 for method in re.finditer(r'STDMETHOD(?:_\([^,]+,\s*([^)]+)\)|\(([^)]+)\))\s*\(THIS(_)?\s*(.*?)\)\s*PURE;',body,re.S):
  one,two,argsflag,args=method.groups();methods.append([(one or two).strip(),1+(args.count(',')+1 if argsflag else 0)])
 if methods:interfaces[interface.strip()]=methods
(root/'runtime/interfaces.mjs').write_text('// Generated from Wine COM interface declarations.\nexport const interfaces='+json.dumps(interfaces,separators=(',',':'))+';\n')
print({k:len(v) for k,v in interfaces.items() if k.startswith('IDirect3D')})
