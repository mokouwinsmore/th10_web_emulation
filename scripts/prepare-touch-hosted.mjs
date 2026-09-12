import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, cp, stat} from 'node:fs/promises';
import {resolve, relative, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NATIVE_DATA_SCHEMA, NATIVE_DATA_FILES, NATIVE_DATA_LAYOUT_SOURCE, decodeNativeData} from '../runtime/native-data.mjs';
import {TH10_TOUCH_EXE_SHA256} from '../runtime/th10-touch.mjs';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtimeOnly = process.argv[2] === '--runtime-only';
const resources = resolve((runtimeOnly ? undefined : process.argv[2]) ?? resolve(project, '../../th10_web/dist'));
const output = resolve(process.argv[3] ?? resolve(project, 'artifacts/validation/th10-touch'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({bytes: bytes.length, sha256: hash(bytes)});
const layout = `sha256-${hash(NATIVE_DATA_LAYOUT_SOURCE)}`;
if (output === resources || output === project || output === dirname(project)) throw new Error('Choose a separate generated output directory');
if (runtimeOnly) {
  // Update an already prepared local runtime, without reading/copying game
  // DATA, font archives or vendor binaries. Preserve their existing identities.
  const runtime = resolve(output, 'runtime');
  const manifest = JSON.parse(await readFile(resolve(runtime, 'runtime-files.json'), 'utf8'));
  if (manifest.schema !== 'eagler-touhou/runtime-directory/1') throw Error('Prepare the complete runtime first');
  const modules = (await readdir(resolve(project, 'runtime'), {withFileTypes:true}))
    .filter(file => file.isFile() && /\.(mjs|js)$/.test(file.name)).map(file => `runtime/${file.name}`);
  const names = ['th10.html', ...modules];
  if (names.length > 128) throw Error('Runtime source file budget exceeded');
  const changed = [];let sourceBytesRead = 0;
  for (const name of names) {
    const source = resolve(project, name);
    if ((await stat(source)).size > 256 * 1024) throw Error(`Runtime source exceeds read budget: ${name}`);
    const bytes = await readFile(source);sourceBytesRead += bytes.length;
    if (sourceBytesRead > 2 * 1024 * 1024) throw Error('Runtime source byte budget exceeded');
    const entry = identity(bytes), previous = manifest.files[name];
    const destination = resolve(runtime, name);
    const destinationInfo = await stat(destination).catch(error => {if(error.code==='ENOENT')return null;throw error;});
    if (destinationInfo && destinationInfo.size > 256 * 1024) throw Error(`Runtime destination exceeds read budget: ${name}`);
    const current = await readFile(destination).catch(error => {if(error.code==='ENOENT')return null;throw error;});
    if (!current || !current.equals(bytes)) {await writeFile(destination, bytes);changed.push(name);}
    if (!previous || previous.sha256 !== entry.sha256 || previous.bytes !== entry.bytes) manifest.files[name] = entry;
  }
  await writeFile(resolve(runtime, 'runtime-files.json'), JSON.stringify(manifest, null, 2));
  const report = {date:new Date().toISOString(),mode:'runtime-only',changed,sourceBytesRead,
    runtimeFiles:Object.keys(manifest.files).length,gameDataRead:false,vendorRead:false};
  await writeFile(resolve(output, 'runtime-update-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
await mkdir(resolve(output, 'content'), {recursive: true});
await mkdir(resolve(output, 'runtime'), {recursive: true});
const original = JSON.parse(await readFile(resolve(resources, 'manifest.json'), 'utf8'));
const payloads = await Promise.all(NATIVE_DATA_FILES.map(name => readFile(resolve(resources, name === 'd3dx9_31.dll' ? 'native' : 'data', name))));
if (hash(payloads[0]) !== TH10_TOUCH_EXE_SHA256 || hash(payloads[1]) !== original.variants.jp.hashes['th10.dat'] || hash(payloads[2]) !== original.d3dx.sha256) throw new Error('Original source content hash mismatch');
let offset = 0;
const header = {schema: NATIVE_DATA_SCHEMA, files: NATIVE_DATA_FILES.map((name, i) => {
  const file = {name, offset, ...identity(payloads[i])}; offset += payloads[i].length; return file;
})};
const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(12);
prefix.write('TH10DAT1'); prefix.writeUInt32LE(json.length, 8);
const data = Buffer.concat([prefix, json, ...payloads]);
await decodeNativeData(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
await writeFile(resolve(output, 'content/th10.data'), data);
const runtime = resolve(output, 'runtime');
await cp(resolve(project, 'th10.html'), resolve(runtime, 'th10.html'));
await mkdir(resolve(runtime, 'runtime'), {recursive: true});
// These are runtime source modules, not native plugins or game resources.
// The hosted worker rejects a non-empty plugin list before executing the game.
for (const file of await readdir(resolve(project, 'runtime'), {withFileTypes: true})) {
  if (file.isFile() && /\.(?:mjs|js)$/.test(file.name)) await cp(resolve(project, 'runtime', file.name), resolve(runtime, 'runtime', file.name));
}
await cp(resolve(resources, 'vendor'), resolve(runtime, 'vendor'), {recursive: true});
await cp(resolve(resources, 'fonts/128'), resolve(runtime, 'fonts/128'), {recursive: true});
await cp(resolve(resources, 'fonts/blend.bin.gz'), resolve(runtime, 'fonts/blend.bin.gz'));
await writeFile(resolve(runtime, 'manifest.json'), JSON.stringify({game: 'th10', version: 'host-touch-1',
  variants: {jp: original.variants.jp}, music: original.music, d3dx: original.d3dx}, null, 2));
const files = {};
async function walk(path) {
  for (const entry of (await readdir(path, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Runtime output cannot contain symlinks');
    const child = resolve(path, entry.name), name = relative(runtime, child).replaceAll('\\', '/');
    if (entry.isDirectory()) await walk(child);
    else if (entry.isFile() && name !== 'runtime-files.json') files[name] = identity(await readFile(child));
  }
}
await walk(runtime);
await writeFile(resolve(runtime, 'runtime-files.json'), JSON.stringify({schema: 'eagler-touhou/runtime-directory/1', files}, null, 2));
const gameIdentity = identity(data);
const descriptor = {schema: 'eagler-touhou/package/1', game: 'th10', revision: `touch-${gameIdentity.sha256.slice(0, 16)}`,
  runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th10', dataFile: 'game-data', dataLayout: layout},
  files: {'game-data': {source: 'content/th10.data', target: '/th10.data', revision: gameIdentity.sha256.slice(0, 16), ...gameIdentity}},
  base: {files: ['game-data']}, components: {}};
const launcher = resolve(project, '../../../eagler-touhou');
const {validatePackageDescriptor} = await import(pathToFileURL(resolve(launcher, 'package/package-descriptor.mjs')));
validatePackageDescriptor(descriptor);
await writeFile(resolve(output, 'th10.package.json'), JSON.stringify(descriptor, null, 2));
const {zipSync, strToU8} = await import(pathToFileURL(resolve(launcher, 'node_modules/fflate/esm/index.mjs')));
const zip = zipSync({'package.json': strToU8(JSON.stringify(descriptor)), 'content/th10.data': new Uint8Array(data)}, {level: 0});
await writeFile(resolve(output, 'th10-touch.package.zip'), zip);
const report = {schema: 'eagler-touhou/th10-touch-build/1', output, runtimeFiles: Object.keys(files).length,
  runtimeBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0), gameData: {...gameIdentity, layout},
  packageBytes: (await stat(resolve(output, 'th10-touch.package.zip'))).size, touchReplay: false, nativePlugins: [],
  audio: 'native sound effects; background music not included in this touch-only package'};
await writeFile(resolve(output, 'build-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
