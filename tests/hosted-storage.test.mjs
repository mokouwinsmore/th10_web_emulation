import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HostedStorage, savePath} from '../runtime/hosted-storage.mjs';

test('save namespace rejects escape and game resource writes', () => {
  for (const path of ['../a', '/a', 'a/../b', 'C:/a', 'a\\b', 'th10.dat', 'TH10.EXE', 'a//b']) assert.throws(() => savePath(path));
  assert.equal(savePath('replay/th10_01.rpy'), 'replay/th10_01.rpy');
});
test('restore failure propagates and persistence failure remains retryable', async () => {
  const fail = new HostedStorage({load: async () => { throw new Error('restore failed'); }});
  await assert.rejects(fail.restore(), /restore failed/);
  let failing = true; const persisted = new Map();
  const service = new HostedStorage({load: async () => [], save: async (path, bytes) => { if (failing) throw new Error('disk full'); persisted.set(path, bytes); }});
  service.write('scoreth10.dat', [1, 2]);
  assert.equal(persisted.size, 0);
  await assert.rejects(service.sync(), /disk full/);
  failing = false; await service.sync();
  assert.deepEqual([...persisted.get('scoreth10.dat')], [1, 2]);
  service.remove('scoreth10.dat'); await service.sync();
  assert.equal(persisted.get('scoreth10.dat'), null);
});
test('a later mutation is not lost during an earlier asynchronous sync', async () => {
  let release; const gate = new Promise(resolve => release = resolve), persisted = new Map();
  const service = new HostedStorage({save: async (path, bytes) => { await gate; persisted.set(path, bytes); }});
  service.write('nested/config.cfg', [1]); const first = service.sync();
  service.write('nested/config.cfg', [2]); release(); await first;
  assert.equal(service.dirty.size, 1); await service.sync();
  assert.deepEqual([...persisted.get('nested/config.cfg')], [2]);
});
