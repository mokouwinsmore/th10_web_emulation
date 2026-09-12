// Each producer owns its keys. Releasing one producer cannot release another.
export class InputSources {
  constructor(onChange = () => {}) { this.sources = new Map(); this.onChange = onChange; }
  get keys() { return new Set([...this.sources.values()].flatMap(keys => [...keys])); }
  update(source, change) {
    const before = this.keys;
    const keys = this.sources.get(source) ?? new Set();
    change(keys);
    if (keys.size) this.sources.set(source, keys); else this.sources.delete(source);
    const after = this.keys;
    for (const key of before) if (!after.has(key)) this.onChange(key, false);
    for (const key of after) if (!before.has(key)) this.onChange(key, true);
    return after;
  }
  set(source, code, down) { return this.update(source, keys => down ? keys.add(code) : keys.delete(code)); }
  replace(source, codes) { return this.update(source, keys => { keys.clear(); for (const code of codes) keys.add(code); }); }
  clear(source) {
    if (source !== undefined) return this.replace(source, []);
    const before = this.keys; this.sources.clear();
    for (const code of before) this.onChange(code, false);
    return this.keys;
  }
}
