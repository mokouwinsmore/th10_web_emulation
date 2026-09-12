// DATA contains immutable original game/compatibility binaries, never saves.
// The executable hash is independently checked by the runtime and touch adapter.
export const NATIVE_DATA_SCHEMA = 'eagler-touhou/th10-native-data/1';
export const NATIVE_DATA_LAYOUT_SOURCE = 'eagler-touhou/th10-native-data/1\nth10.exe\nth10.dat\nd3dx9_31.dll\n';
export const NATIVE_DATA_FILES = Object.freeze(['th10.exe', 'th10.dat', 'd3dx9_31.dll']);
const magic = new TextEncoder().encode('TH10DAT1');
export async function decodeNativeData(buffer, digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Native DATA must be an ArrayBuffer');
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || !magic.every((value, i) => bytes[i] === value)) throw new Error('Invalid native DATA signature');
  const headerLength = new DataView(buffer).getUint32(8, true), start = 12 + headerLength;
  if (headerLength < 1 || headerLength > 65536 || start > bytes.length) throw new Error('Invalid native DATA header length');
  const header = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(12, start)));
  if (header.schema !== NATIVE_DATA_SCHEMA || !Array.isArray(header.files) || header.files.length !== NATIVE_DATA_FILES.length) throw new Error('Unsupported native DATA schema');
  let offset = 0;
  for (const [index, file] of header.files.entries()) {
    if (file.name !== NATIVE_DATA_FILES[index] || file.offset !== offset || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || start + offset + file.bytes > bytes.length) throw new Error('Invalid native DATA file layout');
    offset += file.bytes;
  }
  if (start + offset !== bytes.length) throw new Error('Unexpected native DATA trailing bytes');
  const files = new Map();
  for (const file of header.files) {
    const content = bytes.subarray(start + file.offset, start + file.offset + file.bytes);
    const hash = Array.from(await digest(content), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256) throw new Error(`Native DATA hash mismatch: ${file.name}`);
    files.set(file.name, content);
  }
  return files;
}
