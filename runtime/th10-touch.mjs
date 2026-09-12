import {TouchCore} from './touch-core.mjs';
import {installInstructionHooks} from './instruction-hooks.mjs';

export const TH10_TOUCH_EXE_SHA256 = '2f14760b6fbbf57549541583283badb9a19a4222b90f0a146d5aa17f01dc9040';
// TH10 Japanese 1.00a only. Evidence: original Player movement at 4250b0,
// PauseMenu active state at +4, and MsgVm skip flag at +7c (415eae).
const address = Object.freeze({player: 0x477834, pause: 0x477830, gui: 0x47770c, stage: 0x474c7c,
  replayMode: 0x491c00, frameFactor: 0x476f78});
const movementSites = [0x42524b, 0x425302];
const movDirection = [0x8b, 0x87, 0x54, 4, 0, 0];

export function installTh10Touch(host, {digest, options = {}, now = () => performance.now()} = {}) {
  if (digest !== TH10_TOUCH_EXE_SHA256) throw new Error('TH10 touch requires the verified Japanese 1.00a EXE');
  const m = host.m;
  const core = new TouchCore({options, now});
  const statistics = {inputSamples: 0, movementCalls: 0, touchMovements: 0, pointerEvents: 0, acceptedPointers: 0, touchKeySamples: 0};
  const valid = (pointer, length = 4) => Number.isInteger(pointer) && pointer >= 0x10000 && pointer + length <= m.memorySize;
  let lastPlayerState = null;
  const snapshot = () => {
    const player = m.u32(address.player), pause = m.u32(address.pause), gui = m.u32(address.gui);
    const paused = valid(pause, 8) ? m.u32(pause + 4) : 0;
    const message = valid(gui, 0x9ebc) ? m.u32(gui + 0x9eb8) : 0;
    const hasPlayer = valid(player, 0x4478), hasMessage = valid(message, 0x80);
    const playerState = hasPlayer ? m.u32(player + 0x458) : null;
    const mode = host.foreground === false ? 'inactive' : !hasPlayer || paused ? 'menu' :
      m.u32(address.replayMode) === 2 ? 'inactive' : hasMessage ? 'dialogue' : 'gameplay';
    return {mode, owner: hasPlayer ? `${player}:${m.u32(address.stage)}` : 'title', player: hasPlayer ? player : 0,
      playerState, pauseState: paused, message: hasMessage ? message : 0,
      skippable: hasMessage && !!(m.u32(message + 0x7c) & 1)};
  };
  const refresh = () => {
    const state = snapshot();
    if (lastPlayerState !== null && state.playerState !== lastPlayerState) core.cancel();
    lastPlayerState = state.playerState;
    core.setState(state);
    return state;
  };
  const originalInput = host.input.state;
  const sample = function () {
    refresh(); statistics.inputSamples++;
    const physical = this.keys;
    const touchKeys = core.sampleKeys();
    if (touchKeys.size) statistics.touchKeySamples++;
    this.keys = new Set([...physical, ...touchKeys]);
    try { return originalInput.call(this); }
    finally { this.keys = physical; }
  };
  // All instruction signatures are checked before any site is modified. The
  // original focus-effect setup has already run at either site. EDI is Player,
  // EBP/EBX and [ESP+c] are the original velocity locals. Continuing at 425373
  // preserves animation, integer positions, clamping, floats, options and hitboxes.
  const hooks = installInstructionHooks(m, movementSites.map(site => ({address: site,
    name: `TH10.touch.${site.toString(16)}`, expected: movDirection,
    resume() {
      statistics.movementCalls++;
      const state = refresh(), player = m.reg('EDI');
      let movement = null;
      if (state.player === player && state.playerState === 1) {
        const factor = m.f32(address.frameFactor);
        movement = core.movement({x: m.i32(player + 0x3cc) / 100, y: m.i32(player + 0x3d0) / 100,
          normalSpeed: m.i32(player + 0x3d4) / 100, focusSpeed: m.i32(player + 0x3d8) / 100,
          focused: !!m.u32(player + 0x4474), minX: -184, maxX: 184, minY: 32, maxY: 432,
          factorX: factor, factorY: factor, quantum: 0.01});
      }
      if (!movement) {
        m.reg('EAX', m.u32(player + 0x454)); // Precisely emulate the replaced MOV.
        return site + 6;
      }
      statistics.touchMovements++;
      const velocity = value => Math.trunc(value * 100 + Math.sign(value) * 1e-7);
      m.reg('EBP', velocity(movement.vx)); m.reg('EBX', velocity(movement.vy));
      m.i32(m.reg('ESP') + 0x0c, velocity(movement.vy));
      m.u32(player + 0x454, 0);
      return 0x425373;
    },
  })));
  host.input.state = sample;
  const adapter = {
    core, statistics,
    configure(options) { refresh(); core.configure(options); },
    controls(controls) { refresh(); core.updateControls(controls); },
    pointer(type, point) { refresh(); statistics.pointerEvents++; const accepted = core.pointer(type, point); if (accepted) statistics.acceptedPointers++; return accepted; },
    cancel() { core.cancel({controls: true}); },
    status() {
      const state = snapshot(), player = state.player;
      return {...state, ...statistics, enabled: core.options.touchEnabled,
        position: player ? {x: m.f32(player + 0x3c0), y: m.f32(player + 0x3c4),
          fixedX: m.i32(player + 0x3cc), fixedY: m.i32(player + 0x3d0), canvasX: m.f32(player + 0x3c0) + 224,
          canvasY: m.f32(player + 0x3c4) + 16} : null,
        focus: player ? !!m.u32(player + 0x4474) : false};
    },
    close() { core.cancel({controls: true}); if (host.input.state === sample) host.input.state = originalInput; hooks.close(); },
  };
  return adapter;
}
