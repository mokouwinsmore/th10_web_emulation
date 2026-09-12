import {mkdirSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createTouchSession} from './native/touch-session.mjs';
import {installInstructionHooks} from '../runtime/instruction-hooks.mjs';
const trace = [], samples = []; let hits = 0, polls = 0;
const session = await createTouchSession({attach(host) {
  const m = host.m, sample = host.input.state.bind(host.input);
  host.input.state = () => { polls++; return sample(); };
  return installInstructionHooks(m, [0x42524b, 0x425302].map(address => ({address,
    name: `TouchProbe.${address.toString(16)}`, expected: [0x8b, 0x87, 0x54, 4, 0, 0],
    resume() {
      hits++;
      if (trace.length < 8) trace.push({address, player: m.reg('EDI'), stack: m.reg('ESP'), frame: host.d3d.frames});
      m.reg('EAX', m.u32(m.reg('EDI') + 0x454)); return address + 6;
    },
  })));
}});
try {
  session.frames(480); samples.push({action: 'title', ...session.state(), hits, polls});
  for (let i = 0; i < 5; i++) { session.key('KeyZ', 90); samples.push({action: `confirm${i}`, ...session.state(), hits, polls}); }
  session.frames(120); samples.push({action: 'game', ...session.state(), hits, polls});
  session.key('Escape', 45); samples.push({action: 'pause', ...session.state(), hits, polls});
  session.key('Escape', 45); samples.push({action: 'resume', ...session.state(), hits, polls});
  const report = {date: new Date().toISOString(), backend: 'v86 with Windows GDI diagnostic renderer', trace, samples};
  mkdirSync('artifacts/validation/touch-audit', {recursive: true});
  writeFileSync('artifacts/validation/touch-audit/native-state.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.ok(samples.find(sample => sample.action === 'game').player, 'must actually enter a stage');
  assert.ok(hits > 0, 'must execute a real Player movement branch');
} finally { session.close(); }
