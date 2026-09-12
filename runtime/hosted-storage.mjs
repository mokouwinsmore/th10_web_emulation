const reserved = new Set(['th10.exe', 'th10.dat', 'thbgm.dat']);
export function savePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.includes('\0')) throw new Error('Invalid save path');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || reserved.has(parts[0].toLowerCase())) throw new Error('Invalid save path');
  return value.toLowerCase();
}

// User files stay separate from the immutable game resource map. The worker
// and pre-launch shell use the same commands and persistence barrier.
export class HostedStorage {
  constructor(storage, files = new Map()) { this.storage = storage; this.files = files; this.dirty = new Map(); this.tail = Promise.resolve(); }
  async restore() {
    const entries = await this.storage.load();
    for (const [name, bytes] of entries) {
      const path = savePath(name);
      this.files.set(path, bytes == null ? null : new Uint8Array(bytes));
    }
  }
  write(path, bytes) {
    path = savePath(path);
    if (!(bytes instanceof Uint8Array)) {
      if (!Array.isArray(bytes) || !bytes.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('Invalid save bytes');
      bytes = new Uint8Array(bytes);
    }
    const copy = bytes.slice(); this.files.set(path, copy); this.dirty.set(path, copy);
  }
  // Native files may already have been installed/deleted in the shared overlay
  // before the Win32 flush callback arrives. Capture its exact latest version.
  capture(path, bytes) {
    path = savePath(path);
    if (bytes !== null && !(bytes instanceof Uint8Array)) throw new Error('Invalid native save bytes');
    const copy = bytes === null ? null : bytes.slice();
    this.files.set(path, copy); this.dirty.set(path, copy);
  }
  remove(path) { path = savePath(path); if (!this.files.get(path)) throw new Error('Save file missing'); this.files.set(path, null); this.dirty.set(path, null); }
  read(path) { const bytes = this.files.get(savePath(path)); if (!bytes) throw new Error('Save file missing'); return Array.from(bytes); }
  list() { return [...this.files].filter(([, bytes]) => bytes != null).map(([path, bytes]) => ({path, size: bytes.length})); }
  sync() {
    const batch = new Map(this.dirty);
    const operation = this.tail.then(async () => {
      for (const [path, bytes] of batch) {
        await this.storage.save(path, bytes);
        if (this.dirty.get(path) === bytes) this.dirty.delete(path);
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async command(message) {
    switch (message.command) {
      case 'list': return {files: this.list()};
      case 'read': return {path: message.path, bytes: this.read(message.path)};
      case 'write': this.write(message.path, message.bytes); return {};
      case 'remove': this.remove(message.path); return {};
      case 'sync': await this.sync(); return {};
      default: throw new Error('Unknown storage command');
    }
  }
}
