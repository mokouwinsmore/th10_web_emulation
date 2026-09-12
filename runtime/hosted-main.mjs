import {touchPoint} from './touch-coordinates.mjs';
const protocol = 'eagler-touhou/1', game = 'th10', saveRoot = '/savesth10';
const params = new URLSearchParams(location.search), hosted = params.get('hosted') === '1' && parent !== window;
const hostParams = hosted ? new URLSearchParams(parent.location.search) : params;
const performanceTelemetry = hostParams.get('th10Perf') === '1';
// A reference path only for explicit A/B diagnosis, not a quality setting.
const directViews = !(performanceTelemetry && hostParams.get('th10LegacyViews') === '1');
const cacheRenderState = !(performanceTelemetry && hostParams.get('th10LegacyRender') === '1');
const legacySubmission = performanceTelemetry && hostParams.get('th10LegacySubmission') === '1';
const fastReturns = !(performanceTelemetry && hostParams.get('th10LegacyReturns') === '1');
const debugGLErrors = performanceTelemetry && hostParams.get('th10GlErrors') === '1';
const canvas = document.querySelector('#canvas'), status = document.querySelector('#status');
let worker, audio, audioPort, configured = false, launched = false, dataBuffer, musicSource = null, serial = 0, lastPad = '';
let disposed = false, optionScheduled = false, controlsScheduled = false;
const requests = new Map(), nativePointers = new Set();
const emit = (event, payload = {}) => { if (hosted) parent.postMessage({protocol, game, event, ...payload}, location.origin); };
const reply = (request, ok, payload = {}) => { if (hosted && request) parent.postMessage({protocol, game, request, ok, ...payload}, location.origin); };
const send = message => { if (!disposed) worker?.postMessage(message); };
function fail(error) { const message = String(error?.message ?? error); status.textContent = message; emit('error', {error: message}); console.error(error); }
function rpc(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${type} timed out`)); }, 30000);
    requests.set(id, {resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); }});
    send({type, id, ...payload});
  });
}
function optionProxy(value, kind) {
  return new Proxy({...value}, {set(target, key, next) {
    target[key] = next;
    const controls = kind === 'controls';
    if (!(controls ? controlsScheduled : optionScheduled)) {
      if (controls) controlsScheduled = true; else optionScheduled = true;
      queueMicrotask(() => {
        if (controls) { controlsScheduled = false; send({type: 'touch-controls', controls: {...Module.eaglerControls}}); }
        else { optionScheduled = false; send({type: 'touch-options', options: {...Module.eaglerOptions}}); }
      });
    }
    return true;
  }});
}
let options = optionProxy({touchEnabled: false, touchMovementMode: 'touch', unlimitedTouch: false,
  touchFocusMode: 'hold-button', touchSensitivity: 100, doubleTapBombEnabled: false, touchBombZoneEnabled: false}, 'options');
let controls = optionProxy({fireEnabled: true, focusEnabled: false, joystickX: 0, joystickY: 0, bombSerial: 0, escapeSerial: 0}, 'controls');
const Module = window.Module = {canvas, touhouMusicMode: 'none'};
Object.defineProperties(Module, {
  eaglerOptions: {get: () => options, set: value => { options = optionProxy({...options, ...value}, 'options'); send({type: 'touch-options', options: {...options}}); }},
  eaglerControls: {get: () => controls, set: value => { controls = optionProxy({...controls, ...value}, 'controls'); send({type: 'touch-controls', controls: {...controls}}); }},
});
function fit() {
  const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight, scale = Math.min(width / 640, height / 480);
  document.documentElement.style.setProperty('--touhou-canvas-width', `${Math.max(1, Math.floor(640 * scale))}px`);
  document.documentElement.style.setProperty('--touhou-canvas-height', `${Math.max(1, Math.floor(480 * scale))}px`);
}
function cancel() { nativePointers.clear(); send({type: 'touch-cancel'}); }
function direct(type, point) {
  if (!launched || !Number.isInteger(point.id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const viewport = {width: innerWidth, height: innerHeight}, mapped = touchPoint(point.x, point.y, viewport, canvas.getBoundingClientRect());
  if (!mapped || type === 'down' && !mapped.inside) return;
  if (type === 'down') { nativePointers.add(point.id); resumeAudio(); send({type: 'focus', active: true}); }
  if (!nativePointers.has(point.id)) return;
  send({type: 'direct-touch', action: type, point: {id: point.id, x: mapped.x, y: mapped.y,
    gestureX: point.x * innerWidth, gestureY: point.y * innerHeight, threshold: innerHeight * 0.05,
    tapRadius: Math.min(innerWidth, innerHeight) * 0.08, bombZone: point.y > 0.9}});
  if (type === 'up' || type === 'cancel') nativePointers.delete(point.id);
}
function resumeAudio() { if (audio?.state === 'suspended') void audio.resume().catch(() => {}); }
async function prepareAudio() {
  if (audio) { resumeAudio(); return; }
  if (!window.AudioContext || !window.AudioWorkletNode) throw new Error('AudioWorklet is required for this runtime');
  audio = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'}); resumeAudio();
  await audio.audioWorklet.addModule(new URL('./audio-worklet.mjs', import.meta.url));
  const node = new AudioWorkletNode(audio, 'native-directsound', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]});
  const channel = new MessageChannel(); node.connect(audio.destination);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Audio worklet initialization timed out')), 15000);
    node.port.onmessage = ({data}) => { window.nativeAudio = data; if (data.type === 'ready') { clearTimeout(timer); resolve(); } };
    node.onprocessorerror = () => { clearTimeout(timer); reject(new Error('Audio worklet stopped')); };
  });
  node.port.postMessage({type: 'connect', port: channel.port1}, [channel.port1]); await ready; audioPort = channel.port2;
}
function savePath(path) {
  if (typeof path !== 'string' || !path.startsWith(saveRoot + '/') || path.includes('\\') || path.includes('\0') ||
      path.slice(saveRoot.length + 1).split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid save namespace');
  return path.slice(saveRoot.length + 1);
}
async function configure(message) {
  if (launched) throw new Error('Runtime cannot be reconfigured after launch');
  if (message.runtimePack || message.runtimeResources?.length) throw new Error('This TH10 runtime does not support practice or translation plugins');
  if (!['none', 'midi', 'wav'].includes(message.music)) throw new Error('TH10 accepts original PCM music or no background music');
  if (!Array.isArray(message.resources) || message.resources.length > 1) throw new Error('Invalid original music resources');
  musicSource = null;
  if (message.music === 'wav' && message.resources.length) {
    const resource = message.resources[0], url = new URL(resource.url, location.href);
    if (resource.path !== '/thbgm.dat' || url.origin !== location.origin || !['http:', 'https:', 'blob:'].includes(url.protocol)) throw new Error('Invalid TH10 original music resource');
    musicSource = {url: url.href};
  }
  // The generic launcher uses MIDI as its no-external-resource fallback. TH10
  // has no MIDI synthesizer; state this as "none" rather than claiming support.
  Module.touhouMusicMode = musicSource ? 'wav' : 'none';
  Module.eaglerOptions = message.options ?? {};
  configured = true;
  return {music: Module.touhouMusicMode};
}
addEventListener('message', async event => {
  if (!hosted || event.source !== parent || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.protocol !== protocol || message.game !== game) return;
  try {
    switch (message.command) {
      case 'configure': reply(message.request, true, await configure(message)); break;
      case 'resources':
        if (message.resources?.length) throw new Error('Extra runtime resources are not supported');
        reply(message.request, true); break;
      case 'launch': {
        if (!configured || launched || !dataBuffer) throw new Error('Runtime is not prepared for launch');
        await prepareAudio(); launched = true;
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({type: 'start', canvas: offscreen, audioPort, dataBuffer, language: 'jp',
          touchOptions: {...options}, musicSource, directViews, cacheRenderState, performanceTelemetry, legacySubmission, fastReturns, debugGLErrors}, [offscreen, audioPort, dataBuffer]);
        dataBuffer = null; reply(message.request, true); break;
      }
      case 'keyboard':
        if (typeof message.code !== 'string' || typeof message.down !== 'boolean') throw new Error('Invalid keyboard event');
        if (message.down) resumeAudio(); send({type: 'key', code: message.code, down: message.down, repeat: !!message.repeat}); break;
      case 'keyboard-clear': send({type: 'keyboard-clear'}); break;
      case 'touch-controls':
        for (const key of ['fireEnabled', 'focusEnabled', 'joystickX', 'joystickY', 'bombSerial', 'escapeSerial']) if (message[key] !== undefined) controls[key] = message[key];
        if (message.touchSensitivity !== undefined) options.touchSensitivity = message.touchSensitivity;
        resumeAudio(); break;
      case 'direct-touch': if (['down', 'move', 'up'].includes(message.type)) direct(message.type, message); break;
      case 'touch-cancel': cancel(); break;
      case 'list': {
        const value = await rpc('storage-command', {message: {command: 'list'}});
        reply(message.request, true, {files: value.files.map(file => ({...file, path: `${saveRoot}/${file.path}`}))}); break;
      }
      case 'read': case 'write': case 'remove': {
        const value = await rpc('storage-command', {message: {...message, path: savePath(message.path)}}); reply(message.request, true, {...value, path: message.path}); break;
      }
      case 'sync': reply(message.request, true, await rpc('storage-command', {message: {command: 'sync'}})); break;
      case 'exit': case 'quit': cancel(); send({type: 'quit'}); reply(message.request, true); break;
      default: if (message.request) reply(message.request, false, {error: 'Unsupported runtime command'});
    }
  } catch (error) { reply(message.request, false, {error: String(error?.message ?? error)}); if (message.command === 'launch') fail(error); }
});
// Direct iframe touch is still needed on browsers where the launcher does not
// own a pointer overlay. Do not also turn these events into a synthetic mouse.
for (const [eventName, type] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel'], ['lostpointercapture', 'cancel']]) {
  canvas.addEventListener(eventName, event => {
    if (!options.touchEnabled || event.pointerType === 'mouse') return;
    if (type === 'down') canvas.setPointerCapture(event.pointerId);
    direct(type, {id: event.pointerId, x: event.clientX / innerWidth, y: event.clientY / innerHeight}); event.preventDefault();
  }, {passive: false});
}
for (const type of ['keydown', 'keyup']) addEventListener(type, event => {
  if (!launched) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab'].includes(event.code)) event.preventDefault();
  send({type: 'key', code: event.code, down: type === 'keydown', repeat: event.repeat}); resumeAudio();
});
const loseFocus = () => { cancel(); send({type: 'blur'}); send({type: 'focus', active: false}); };
const gainFocus = () => send({type: 'focus', active: true});
const owner = hosted ? parent : window;
owner.addEventListener('blur', loseFocus); owner.addEventListener('focus', gainFocus);
document.addEventListener('visibilitychange', () => document.hidden ? loseFocus() : gainFocus());
addEventListener('resize', () => { cancel(); fit(); });
canvas.addEventListener('contextmenu', event => event.preventDefault());
let padFrame;
function pollPad() {
  if (disposed) return;
  const connected = Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected);
  const pad = connected ? {axes: Array.from(connected.axes), buttons: connected.buttons.map(button => button.pressed)} : null;
  const key = JSON.stringify(pad); if (key !== lastPad) { lastPad = key; send({type: 'gamepad', pad}); }
  padFrame = requestAnimationFrame(pollPad);
}
addEventListener('pagehide', () => {
  cancel(); disposed = true; worker?.terminate(); void audio?.close(); cancelAnimationFrame(padFrame);
  owner.removeEventListener('blur', loseFocus); owner.removeEventListener('focus', gainFocus);
  for (const request of requests.values()) request.reject(new Error('Runtime closed')); requests.clear();
});
async function initialize() {
  fit();
  if (!hosted || params.get('managedData') !== '1') throw new Error('请从 eagler-touhou 导入游戏包并打开风神录');
  if (!self.isSecureContext || !canvas.transferControlToOffscreen) throw new Error('This runtime requires HTTPS/localhost and OffscreenCanvas');
  worker = new Worker(new URL('./browser-worker.js', import.meta.url));
  worker.onerror = event => { for (const request of requests.values()) request.reject(new Error(event.message)); requests.clear(); fail(new Error(event.message)); };
  worker.onmessage = ({data}) => {
    if (data.type === 'rpc') { const pending = requests.get(data.id); requests.delete(data.id); data.ok ? pending?.resolve(data.value) : pending?.reject(new Error(data.error)); return; }
    if (data.type === 'touch-state') { window.nativeTouchState = data.state; return; }
    if (data.type === 'performance') {
      window.nativePerformance = data;
      const display = document.querySelector('#nativePerformance');
      if (performanceTelemetry && display) { display.hidden = false; display.textContent =
        `${data.build} · ${data.directViews ? 'cached' : 'reference'} · GL ${data.cacheRenderState ? 'cached' : 'reference'} · submit ${data.legacySubmission ? 'old' : 'v103'} · ret ${data.fastReturns ? 'fast' : 'old'}\nPresent ${data.fps.toFixed(1)} FPS · work ${data.workMs.toFixed(1)} ms/frame\nGL submit ${data.submitMs.toFixed(1)} ms/frame · draws ${data.drawCalls.toFixed(0)} → batches ${data.batches.toFixed(0)}`; }
      return;
    }
    window.nativeStatus = data;
    if (data.type === 'status') status.textContent = data.message;
    else if (data.type === 'first-frame') { status.hidden = true; emit('first-frame'); }
    else if (data.type === 'frame') emit('frame-health', {fps: data.fps, frame: data.frame});
    else if (data.type === 'error') fail(new Error(data.message));
    else if (data.type === 'exit') { launched = false; status.hidden = false; status.textContent = '游戏已退出'; emit('exit', {status: data.code, code: data.code}); }
  };
  const provider = window.parent.__eaglerPrepareManagedRuntimeDataV1;
  if (typeof provider !== 'function') throw new Error('Managed game DATA provider unavailable');
  const [prepared] = await Promise.all([provider({game, generation: params.get('gameGeneration') ?? ''}), rpc('storage-command', {message: {command: 'sync'}})]);
  if (!prepared?.buffer || Object.prototype.toString.call(prepared.buffer) !== '[object ArrayBuffer]' || prepared.buffer.byteLength <= 0) throw new Error('Invalid managed TH10 DATA');
  dataBuffer = prepared.buffer;
  status.textContent = 'Ready'; emit('transfer', {kind: 'game', mode: 'managed', loaded: dataBuffer.byteLength, total: dataBuffer.byteLength});
  emit('runtime-info', {renderer: `v86 x86 / WebGL 2 [perf-5 ${directViews ? 'cached' : 'reference'} / ${legacySubmission ? 'old-submit' : 'v103-submit'} / ${fastReturns ? 'fast-ret' : 'old-ret'}]`, touchAdapter: 'th10-host-touch/1', touchReplay: false});
  emit('ready', {saveRoot}); pollPad();
}
void initialize().catch(fail);
