// v86 exposes its WASM state through grow-safe Proxy objects. Creating a view
// for each scalar Proxy access is expensive at the host/guest API boundary.
// Keep ordinary typed-array views instead, rebuilding them when Memory.buffer
// changes. No WASM offsets, signedness or guest RAM sizes are hard-coded here.
export class WasmStateViews {
  constructor(memory, source, fields) {
    this.memory = memory;
    this.source = source;
    this.fields = [...fields];
    this.buffer = null;
    this.views = null;
  }

  current() {
    const buffer = this.memory.buffer;
    if (buffer === this.buffer) return this.views;
    const next = Object.create(null);
    for (const name of this.fields) {
      const source = this.source[name];
      // subarray(0, 0) gives us the real constructor and byte offset without
      // copying RAM, and also works with v86's non-typed-array Proxy facade.
      const sample = source.subarray(0, 0);
      if (!ArrayBuffer.isView(sample) || sample.buffer !== buffer) {
        throw new Error(`Invalid v86 state view: ${name}`);
      }
      next[name] = new sample.constructor(buffer, sample.byteOffset, source.length);
    }
    this.views = next;
    this.buffer = buffer;
    return next;
  }
}
