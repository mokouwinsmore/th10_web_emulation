// Headless x86 acceptance harness using an explicit local resource directory.
// Windows GDI here is a diagnostic backend, NOT browser/mobile render evidence.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {JitMachine} from '../../runtime/jit-machine.mjs';
import {Win32Host} from '../../runtime/win32.mjs';
import {Scheduler} from '../../runtime/scheduler.mjs';
import {loadLibrary} from '../../runtime/library.mjs';
import {installGDI} from '../../runtime/gdi.mjs';
import {installLzss} from '../../runtime/lzss.mjs';
import {installD3DXFastPaths} from '../../runtime/d3dx-fast.mjs';
import {installTextureEdges} from '../../runtime/texture-edges.mjs';
import {WindowsFonts} from './windows-fonts.mjs';

export async function createTouchSession({resources = '../../th10_web/dist', attach} = {}) {
  const root = resolve(resources), manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  const variant = manifest.variants.jp, files = new Map(variant.files.map(name => [name, readFileSync(resolve(root, 'data', name))]));
  const exe = files.get(variant.program), digest = createHash('sha256').update(exe).digest('hex');
  if (digest !== variant.sha256) throw new Error('Test resource EXE hash mismatch');
  const blockSize = manifest.music.blockSize, blocks = new Map();
  files.set('thbgm.dat', {length: manifest.music.size, subarray(start, end) {
    end = Math.min(end, this.length);
    const result = new Uint8Array(Math.max(0, end - start));
    for (let offset = start; offset < end;) {
      const index = Math.floor(offset / blockSize);
      let block = blocks.get(index);
      if (!block) { block = readFileSync(resolve(root, 'data/thbgm', `${String(index).padStart(4, '0')}.bin`)); blocks.set(index, block); }
      const count = Math.min(end - offset, block.length - offset % blockSize);
      if (count <= 0) throw new Error('Incomplete music test resource');
      result.set(block.subarray(offset % blockSize, offset % blockSize + count), offset - start); offset += count;
    }
    while (blocks.size > 64) blocks.delete(blocks.keys().next().value);
    return result;
  }});
  const m = await JitMachine.create(exe), host = new Win32Host(m, files, {language: 'jp', program: variant.program});
  const fonts = new WindowsFonts(); let scheduler, adapter;
  try {
    const library = loadLibrary(m, readFileSync(resolve(root, 'native/d3dx9_31.dll')), 0x1000000, 'd3dx9_31.dll');
    host.d3dxLibrary = library;
    installGDI(host, fonts); installLzss(host); installD3DXFastPaths(m, library, host); installTextureEdges(host);
    m.call(library.entry, {args: [library.base, 1, 0]});
    adapter = attach?.(host, digest);
    scheduler = new Scheduler(m, host);
    let steps = 0;
    const session = {m, host, adapter, digest, manifest,
      frames(count, before) {
        const target = host.d3d.frames + count; let previous = -1, stalled = 0;
        while (host.d3d.frames < target && host.exitCode === undefined) {
          if (previous !== host.d3d.frames) { previous = host.d3d.frames; stalled = 0; before?.(session); }
          scheduler.step(500000);
          if (++stalled > 600 || ++steps > 5000000) throw new Error('Native touch probe exceeded instruction budget');
        }
        if (host.exitCode !== undefined) throw new Error(`Game exited: ${host.exitCode}`);
      },
      key(code, count = 45) { host.input.keys.add(code); session.frames(3); host.input.keys.delete(code); session.frames(count - 3); },
      state() {
        const player = m.u32(0x477834), callback = player ? m.u32(player + 8) : 0, gui = m.u32(0x47770c);
        return {frame: host.d3d.frames, time: host.millis, stage: m.u32(0x474c7c), flags: m.u32(0x474ca0),
          replayMode: m.u32(0x491c00), player, callbackFlags: callback ? m.u32(callback + 4) : null,
          playerState: player ? m.u32(player + 0x458) : null, gui, message: gui ? m.u32(gui + 0x9eb8) : null,
          position: player ? {x: m.i32(player + 0x3cc), y: m.i32(player + 0x3d0), fx: m.f32(player + 0x3c0), fy: m.f32(player + 0x3c4)} : null,
          focus: player ? m.u32(player + 0x4474) : null, speed: player ? [m.i32(player + 0x3d4), m.i32(player + 0x3d8)] : null};
      },
      close() { adapter?.close?.(); scheduler.close(); fonts.close(); m.close(); blocks.clear(); },
    };
    return session;
  } catch (error) { adapter?.close?.(); scheduler?.close(); fonts.close(); m.close(); throw error; }
}
