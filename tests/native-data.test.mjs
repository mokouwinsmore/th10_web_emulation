import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeNativeData, NATIVE_DATA_SCHEMA, NATIVE_DATA_FILES} from '../runtime/native-data.mjs';
function fixture(edit = () => {}) {
  const contents = [Buffer.from('fixture-exe'), Buffer.from('fixture-dat'), Buffer.from('fixture-dll')];
  let offset = 0;
  const header = {schema: NATIVE_DATA_SCHEMA, files: NATIVE_DATA_FILES.map((name, i) => {
    const file = {name, offset, bytes: contents[i].length, sha256: createHash('sha256').update(contents[i]).digest('hex')}; offset += file.bytes; return file;
  })};
  edit(header); const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(12);
  prefix.write('TH10DAT1'); prefix.writeUInt32LE(json.length, 8);
  const bytes = Buffer.concat([prefix, json, ...contents]); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
}
test('native immutable DATA has bounded named files and verified hashes', async () => {
  const files = await decodeNativeData(fixture()); assert.deepEqual([...files.keys()], [...NATIVE_DATA_FILES]);
  assert.equal(new TextDecoder().decode(files.get('th10.dat')), 'fixture-dat');
});
test('native DATA rejects overlaps, traversal, unknown names and trailing content', async () => {
  for (const edit of [h => h.files[1].offset--, h => h.files[0].name = '../th10.exe', h => h.files[0].bytes = Infinity,
    h => h.files[0].sha256 = '0'.repeat(64), h => h.schema = 'wrong']) await assert.rejects(decodeNativeData(fixture(edit)));
  const bytes = new Uint8Array(fixture()), extra = new Uint8Array(bytes.length + 1); extra.set(bytes); await assert.rejects(decodeNativeData(extra.buffer));
});
