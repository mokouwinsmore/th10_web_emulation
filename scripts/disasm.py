import struct,sys
from pathlib import Path
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
root=Path(__file__).resolve().parent.parent
path=Path(sys.argv[3]) if len(sys.argv)>3 else root.parent/'[th10] 东方风神录 (汉化版+日文版)'/'th10.exe'
b=path.read_bytes();pe=struct.unpack_from('<I',b,0x3c)[0];opt=pe+24;base=struct.unpack_from('<I',b,opt+28)[0];sections=opt+struct.unpack_from('<H',b,pe+20)[0]
def offset(va):
 rva=va-base
 for i in range(struct.unpack_from('<H',b,pe+6)[0]):
  vsize,addr,size,pos=struct.unpack_from('<IIII',b,sections+i*40+8)
  if addr<=rva<addr+max(size,vsize):return pos+rva-addr
 raise ValueError(hex(va))
start=int(sys.argv[1],0);end=int(sys.argv[2],0)
for ins in Cs(CS_ARCH_X86,CS_MODE_32).disasm(b[offset(start):offset(start)+end-start],start):print(f'{ins.address:08x} {ins.mnemonic:9} {ins.op_str}')
