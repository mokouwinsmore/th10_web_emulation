// Narrow, explicitly verified instruction substitutions. Unlike replace(),
// these are not function calls: ESP, flags and the x87 stack remain untouched.
// The caller must emulate every overwritten instruction, or select a verified
// continuation. No instruction decoder or guessed trampoline is involved.
export function installInstructionHooks(machine, specifications) {
  const sites = specifications.map(spec => {
    const expected = Uint8Array.from(spec.expected);
    if (!Number.isInteger(spec.address) || expected.length < 5 || typeof spec.resume !== 'function') {
      throw new Error('Invalid instruction hook specification');
    }
    const original = machine.bytes(spec.address, expected.length);
    if (!original.every((byte, index) => byte === expected[index])) {
      throw new Error(`Instruction mismatch for ${spec.name} at 0x${spec.address.toString(16)}`);
    }
    return {...spec, expected, original};
  });
  for (let i = 0; i < sites.length; i++) for (let j = 0; j < i; j++) {
    if (sites[i].address < sites[j].address + sites[j].expected.length &&
        sites[j].address < sites[i].address + sites[i].expected.length) throw new Error('Overlapping instruction hooks');
  }
  const previous = machine.onImport;
  const callbacks = new Map();
  const dispatch = entry => {
    const resume = callbacks.get(entry);
    if (!resume) return previous(entry);
    const next = resume(machine);
    if (!Number.isInteger(next) || next < 0x400000 || next >= machine.memorySize) throw new Error('Invalid hook continuation');
    machine.reg('EIP', next);
  };
  const installed = [];
  machine.onImport = dispatch;
  try {
    for (const site of sites) {
      const entry = {dll: 'instruction-hook', name: site.name};
      callbacks.set(entry, site.resume);
      const stub = machine.registerImport(entry);
      const patch = new Uint8Array(site.expected.length).fill(0x90);
      patch[0] = 0xe9;
      new DataView(patch.buffer).setInt32(1, stub - site.address - 5, true);
      machine.write(site.address, patch);
      installed.push(site);
    }
  } catch (error) {
    for (const site of installed.reverse()) machine.write(site.address, site.original);
    if (machine.onImport === dispatch) machine.onImport = previous;
    throw error;
  }
  let closed = false;
  return {
    sites: sites.map(({name, address}) => ({name, address})),
    close() {
      if (closed) return;
      closed = true;
      for (const site of installed) machine.write(site.address, site.original);
      if (machine.onImport === dispatch) machine.onImport = previous;
    },
  };
}
