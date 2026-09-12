// Uniform state belongs to a linked program, not to the currently bound draw.
// Snapshot values only on change; never retain caller-owned mutable arrays.
export class UniformCache {
  constructor(gl, locations) { this.gl = gl; this.locations = locations; this.values = new Map(); }
  set(name, method, args) {
    const location = this.locations.get(name);
    if (location == null) return false; // Optimized out of this shader variant.
    const previous = this.values.get(name);
    const vector = method.endsWith('v'), source = vector ? args.at(-1) : args;
    const transpose = method.startsWith('uniformMatrix') ? args[0] : undefined;
    let same = previous?.method === method && previous.transpose === transpose && previous.data.length === source.length;
    if (same) for (let i = 0; i < source.length; i++) if (!Object.is(previous.data[i], source[i])) { same = false; break; }
    if (same) return false;
    this.gl[method](location, ...args);
    if (previous?.data.length === source.length) {
      previous.method = method; previous.transpose = transpose;
      for (let i = 0; i < source.length; i++) previous.data[i] = source[i];
    } else this.values.set(name, {method, transpose, data: Array.from(source)});
    return true;
  }
}
