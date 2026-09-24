'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const API_KEY = 'sk-PLAINTEXT-CANARY-9f8e7d6c5b4a';
const noop = () => {};

// Loads the real electron/main.cjs against a fake Electron so the real IPC handlers run.
function loadMain() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-cred-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-cred-ws-'));
  const handlers = {};
  const control = { encryptionAvailable: true, chosenFolder: workspace, clipboard: [] };
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
  // Reversible stand-in for OS encryption: ciphertext never contains the plaintext bytes.
  const safeStorage = {
    isEncryptionAvailable: () => control.encryptionAvailable,
    encryptString: (text) => Buffer.from(`ENC[${Buffer.from(text).reverse().toString('hex')}]`),
    decryptString: (buffer) => Buffer.from(/^ENC\[(.*)\]$/.exec(buffer.toString())[1], 'hex').reverse().toString()
  };
  const fakes = {
    app, safeStorage,
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; }, on: noop, removeHandler: noop },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [control.chosenFolder] }),
      showMessageBox: async () => ({ response: 1 })
    },
    clipboard: { writeText: (text) => control.clipboard.push(text), readText: () => '' }
  };
  const electron = new Proxy(fakes, { get: (target, prop) => (prop in target ? target[prop] : deep(`electron.${String(prop)}`)) });

  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
  };
  const mainPath = require.resolve('../electron/main.cjs');
  try { require(mainPath); } finally { Module._load = originalLoad; }
  return { userData, workspace, handlers, control, safeStorage, start: () => ready() };
}

function allFileContents(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ file: full, text: fs.readFileSync(full).toString('latin1') });
    }
  };
  walk(dir);
  return out;
}

const ctx = loadMain();
const credentialsFile = () => path.join(ctx.userData, 'credentials.json');
const readCredentials = () => JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
let savedId = null;

test.before(async () => { await ctx.start(); });
test.after(() => {
  for (const dir of [ctx.userData, ctx.workspace]) fs.rmSync(dir, { recursive: true, force: true });
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('R1.4 a provider API key is stored only as OS-encrypted ciphertext behind an opaque credential reference', async () => {
  assert.ok(Object.keys(ctx.handlers).length > 50, 'real IPC handlers must be registered');
  const saved = await ctx.handlers['provider:save']({}, { name: 'Cred Test', kind: 'api', baseUrl: 'https://api.example.com/v1', defaultModel: 'm1', apiKey: API_KEY });
  savedId = saved.id;

  assert.equal(saved.credentialRef, `cred:${savedId}`);
  assert.equal(saved.hasCredential, true);
  assert.equal(JSON.stringify(saved).includes(API_KEY), false, 'the save response must not echo the key');

  const stored = readCredentials().values[savedId];
  assert.equal(stored, ctx.safeStorage.encryptString(API_KEY).toString('base64'), 'the credential must be the OS-encrypted value');
  assert.equal(Buffer.from(stored, 'base64').toString().includes(API_KEY), false);

  for (const { file, text } of allFileContents(ctx.userData)) assert.equal(text.includes(API_KEY), false, `${path.basename(file)} must not contain the plaintext key`);

  const state = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'state.json'), 'utf8'));
  assert.equal(state.providers.find((provider) => provider.id === savedId).credentialRef, `cred:${savedId}`);
});

test('R1.4 every read route returns only a credential flag or reference, never the key', async () => {
  const listed = await ctx.handlers['provider:list']({});
  const fromState = await ctx.handlers['state:get']({});
  const record = listed.find((provider) => provider.id === savedId);
  assert.equal(record.hasCredential, true);
  assert.equal(JSON.stringify(listed).includes(API_KEY), false);
  assert.equal(JSON.stringify(fromState).includes(API_KEY), false);
  assert.equal(JSON.stringify(await ctx.handlers['app:info']({})).includes(API_KEY), false);
});

test('R1.4 when OS encryption is unavailable the key is refused and never falls back to plaintext storage', async () => {
  ctx.control.encryptionAvailable = false;
  const canary = 'sk-SECOND-CANARY-1a2b3c4d5e6f';
  await assert.rejects(
    ctx.handlers['provider:save']({}, { name: 'No Enc', kind: 'api', baseUrl: 'https://api.example.com/v2', defaultModel: 'm2', apiKey: canary }),
    /OS credential encryption is unavailable/
  );
  await assert.rejects(ctx.handlers['workspace:select']({}).then(() => ctx.handlers['mcp:start']({})), /OS credential encryption is unavailable/);
  ctx.control.encryptionAvailable = true;

  for (const { file, text } of allFileContents(ctx.userData)) assert.equal(text.includes(canary), false, `${path.basename(file)} must not contain the refused key`);
  assert.equal(Object.keys(readCredentials().values).length, 1);
});

test('R1.4 clearing stored credentials removes the encrypted values and keeps the provider registration without a key', async () => {
  const result = await ctx.handlers['data:clear-credentials']({});
  assert.ok(result);
  const remaining = fs.existsSync(credentialsFile()) ? readCredentials().values : {};
  assert.deepEqual(Object.keys(remaining), []);
  const listed = await ctx.handlers['provider:list']({});
  assert.equal(listed.find((provider) => provider.id === savedId).hasCredential, false);
});
