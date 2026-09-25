'use strict';

// Loads the real electron/main.cjs against a fake Electron so its real IPC handlers can be called.
// main.cjs can only be loaded once per process, so each test file that uses this runs in its own process.
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const noop = () => {};

function loadMain({ userData: existingUserData = null } = {}) {
  const userData = existingUserData || fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-main-'));
  const handlers = {};
  const record = { openExternal: [], clipboard: [], console: [] };
  const control = { encryptionAvailable: true, chosenFolder: null, savePath: null, messageBoxResponse: 1 };
  const deep = (name) => new Proxy(function fake() {}, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => name : (prop === 'then' ? undefined : deep(`${name}.${String(prop)}`))),
    apply: () => deep(`${name}()`),
    construct: () => deep(`new ${name}`)
  });
  let ready = null;
  const app = {
    getPath: () => userData, getVersion: () => '0.0.0-test', getName: () => 'aecp', isPackaged: false, getAppPath: () => process.cwd(),
    whenReady: () => ({ then: (fn) => { ready = fn; return { catch: noop }; } }),
    on: noop, once: noop, quit: noop, setAppUserModelId: noop, requestSingleInstanceLock: () => true, setName: noop, setPath: noop,
    commandLine: { appendSwitch: noop }, disableHardwareAcceleration: noop
  };
  // Reversible stand-in for OS encryption: the ciphertext never contains the plaintext bytes.
  const safeStorage = {
    isEncryptionAvailable: () => control.encryptionAvailable,
    encryptString: (text) => Buffer.from(`ENC[${Buffer.from(text).reverse().toString('hex')}]`),
    decryptString: (buffer) => Buffer.from(/^ENC\[(.*)\]$/.exec(buffer.toString())[1], 'hex').reverse().toString()
  };
  const fakes = {
    app, safeStorage,
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; }, on: noop, removeHandler: noop },
    dialog: {
      showOpenDialog: async () => (control.chosenFolder ? { canceled: false, filePaths: [control.chosenFolder] } : { canceled: true, filePaths: [] }),
      showSaveDialog: async () => (control.savePath ? { canceled: false, filePath: control.savePath } : { canceled: true }),
      showMessageBox: async () => ({ response: control.messageBoxResponse })
    },
    shell: { openExternal: async (url) => { record.openExternal.push(url); }, openPath: async () => '' },
    clipboard: { writeText: (text) => record.clipboard.push(['write', text]), readText: () => { record.clipboard.push(['read']); return ''; } }
  };
  const electron = new Proxy(fakes, { get: (target, prop) => (prop in target ? target[prop] : deep(`electron.${String(prop)}`)) });

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { record.console.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')); original(...args); };
  }

  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
  };
  try { require(require.resolve('../../electron/main.cjs')); } finally { Module._load = originalLoad; }
  return { userData, handlers, record, control, safeStorage, start: () => ready(), dispose: () => { if (!existingUserData) fs.rmSync(userData, { recursive: true, force: true }); } };
}

module.exports = { loadMain };
