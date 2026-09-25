'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const noop = () => {};
const SENSITIVE_TOP_LEVEL = ['session', 'net', 'netLog', 'protocol', 'webContents', 'webFrameMain', 'desktopCapturer'];
const FORBIDDEN_WINDOW_CALL = /executeJavaScript|insertCSS|debugger|loadURL|sendInputEvent|session|cookies|webRequest|capturePage|printToPDF/;

const record = { openExternal: [], windows: [], windowCalls: [], topLevel: [], clipboard: [], fetches: 0 };
const handlers = {};
const windowEvents = {};
let windowOpenHandler = null;
let readyFn = null;

function fakeWindow(options) {
  record.windows.push(options);
  const webContents = new Proxy({
    setWindowOpenHandler: (fn) => { windowOpenHandler = fn; },
    on: (event, fn) => { windowEvents[event] = fn; },
    once: noop, send: noop, isDestroyed: () => false
  }, { get: (target, prop) => (prop in target ? target[prop] : (record.windowCalls.push(`webContents.${String(prop)}`), noop)) });
  const base = { webContents, loadFile: async () => {}, once: noop, on: noop, show: noop, isDestroyed: () => false, isMinimized: () => false, focus: noop, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) };
  return new Proxy(base, { get: (target, prop) => (prop in target ? target[prop] : (record.windowCalls.push(`window.${String(prop)}`), noop)) });
}

function loadMain() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-chatgpt-'));
  const app = {
    getPath: () => userData, getVersion: () => '0.0.0-test', getName: () => 'aecp', isPackaged: false, getAppPath: () => process.cwd(),
    whenReady: () => ({ then: (fn) => { readyFn = fn; return { catch: noop }; } }),
    on: noop, once: noop, quit: noop, setAppUserModelId: noop, requestSingleInstanceLock: () => true, setName: noop, setPath: noop,
    commandLine: { appendSwitch: noop }, disableHardwareAcceleration: noop
  };
  function BrowserWindow(options) { return fakeWindow(options); }
  BrowserWindow.getAllWindows = () => [];
  const fakes = {
    app, BrowserWindow,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(text), decryptString: (buffer) => buffer.toString() },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; }, on: noop, removeHandler: noop },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) },
    shell: { openExternal: async (url) => { record.openExternal.push(url); return undefined; }, openPath: async () => '' },
    clipboard: { writeText: (text) => record.clipboard.push(['write', text]), readText: () => { record.clipboard.push(['read']); return ''; } }
  };
  const electron = new Proxy(fakes, {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (SENSITIVE_TOP_LEVEL.includes(String(prop))) record.topLevel.push(String(prop));
      return new Proxy(function stub() {}, { get: (_t, inner) => (inner === 'then' ? undefined : noop), apply: () => undefined });
    }
  });
  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
  };
  try { require(require.resolve('../electron/main.cjs')); } finally { Module._load = originalLoad; }
  return { userData };
}

const realFetch = global.fetch;
global.fetch = (...args) => { record.fetches += 1; return realFetch(...args); };
const ctx = loadMain();

test.before(async () => { await readyFn(); });
test.after(() => {
  global.fetch = realFetch;
  fs.rmSync(ctx.userData, { recursive: true, force: true });
  setImmediate(() => process.exit(process.exitCode || 0));
});

const snapshot = () => ({ openExternal: record.openExternal.length, windows: record.windows.length, windowCalls: record.windowCalls.length, topLevel: record.topLevel.length, clipboard: record.clipboard.length, fetches: record.fetches });

test('B20-27-17 every path that reaches the official ChatGPT Web only hands the URL to the OS browser', async () => {
  assert.equal(record.windows.length, 1, 'only the AECP window exists after startup');
  const before = snapshot();

  assert.equal(await handlers['chatgpt:open']({}), true);
  assert.deepEqual(await handlers['agents:launch']({}, { agentId: 'chatgpt-web' }), { ok: true, id: 'chatgpt-web' });

  const after = snapshot();
  assert.deepEqual(record.openExternal.slice(before.openExternal), ['https://chatgpt.com/', 'https://chatgpt.com/']);
  assert.equal(after.windows, before.windows, 'no embedded ChatGPT window/view may be created');
  assert.deepEqual(record.windowCalls.slice(before.windowCalls), [], 'no call may be made on any window or webContents');
  assert.deepEqual(record.topLevel.slice(before.topLevel), [], 'no session/network/protocol API may be touched');
  assert.equal(after.clipboard, before.clipboard, 'opening ChatGPT never reads or writes the clipboard');
  assert.equal(after.fetches, before.fetches, 'AECP makes no network request to ChatGPT');
  assert.ok(record.windowCalls.every((call) => !FORBIDDEN_WINDOW_CALL.test(call)));
});

test('B20-27-17 the app window can neither open nor navigate to ChatGPT in-app', () => {
  const options = record.windows[0];
  assert.deepEqual([options.webPreferences.contextIsolation, options.webPreferences.nodeIntegration, options.webPreferences.sandbox, options.webPreferences.webSecurity], [true, false, true, true]);
  assert.equal(options.webPreferences.webviewTag, undefined);

  const before = record.openExternal.length;
  assert.deepEqual(windowOpenHandler({ url: 'https://chatgpt.com/c/123' }), { action: 'deny' });
  assert.deepEqual(record.openExternal.slice(before), ['https://chatgpt.com/c/123'], 'links are opened in the OS browser, not in-app');
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'http://chatgpt.com/', 'data:text/html,x']) {
    const count = record.openExternal.length;
    assert.deepEqual(windowOpenHandler({ url }), { action: 'deny' });
    assert.equal(record.openExternal.length, count, `${url} must not be opened at all`);
  }

  const navigate = (url) => { let prevented = false; windowEvents['will-navigate']({ preventDefault: () => { prevented = true; } }, url); return prevented; };
  assert.equal(navigate('https://chatgpt.com/'), true);
  assert.equal(navigate('https://chat.openai.com/'), true);
  assert.equal(navigate(pathToFileURL(path.resolve(__dirname, '..', 'ui', 'index.html')).href), false);
});

test('B20-27-17 the built-in ChatGPT Web provider is human-mediated: no health probe traffic, no stored credential, cannot be removed', async () => {
  const before = snapshot();
  const health = await handlers['provider:health']({}, { providerId: 'chatgpt-web' });
  assert.equal(health.status, 'READY');
  assert.match(health.detail, /Human-mediated official browser session/);
  assert.equal(record.fetches, before.fetches, 'the health check must not contact ChatGPT');
  assert.equal(record.openExternal.length, before.openExternal, 'the health check must not even open it');

  const state = await handlers['state:get']({});
  const provider = state.providers.find((item) => item.id === 'chatgpt-web');
  assert.ok(provider);
  assert.ok(!provider.hasCredential && !provider.requiresCredential && !provider.credentialRef);
  await assert.rejects(handlers['provider:delete']({}, { providerId: 'chatgpt-web' }), /cannot be deleted/);
});
