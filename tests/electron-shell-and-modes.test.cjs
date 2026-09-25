'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { createUi } = require('./support/ui-harness.cjs');

const ctx = loadMain();
test.before(async () => { await ctx.start(); });
test.after(() => { ctx.dispose(); setImmediate(() => process.exit(process.exitCode || 0)); });

const UI_INDEX = path.join(__dirname, '..', 'ui', 'index.html');

test('B08-SHELL the real main window is created with context isolation, no Node integration, a sandbox and web security', () => {
  assert.equal(ctx.record.windows.length, 1, 'exactly one window is created at start-up');
  const { options } = ctx.record.windows[0];
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(path.basename(options.webPreferences.preload), 'preload.cjs');
});

test('B08-SHELL navigation away from the local UI is refused and new windows are denied, so no remote ChatGPT page is loaded into the privileged window', () => {
  const window = ctx.record.windows[0];
  const navigate = window.handlers['will-navigate'][0];
  for (const url of ['https://chatgpt.com/', 'https://evil.example/', 'file:///C:/Windows/System32/cmd.exe', 'http://localhost:9999/', `${require('node:url').pathToFileURL(UI_INDEX).href}/../other.html`]) {
    let prevented = false;
    navigate({ preventDefault: () => { prevented = true; } }, url);
    assert.equal(prevented, true, `${url} must not load in the app window`);
  }
  let localPrevented = false;
  navigate({ preventDefault: () => { localPrevented = true; } }, require('node:url').pathToFileURL(UI_INDEX).href);
  assert.equal(localPrevented, false, 'the packaged UI itself may navigate');

  const before = ctx.record.openExternal.length;
  assert.deepEqual(window.windowOpenHandler({ url: 'https://chatgpt.com/' }), { action: 'deny' });
  assert.deepEqual(ctx.record.openExternal.slice(before), ['https://chatgpt.com/'], 'an https link is handed to the OS browser, never opened in-app');
  assert.deepEqual(window.windowOpenHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(window.windowOpenHandler({ url: 'http://insecure.example/' }), { action: 'deny' });
  assert.equal(ctx.record.openExternal.length, before + 1, 'only https links are ever forwarded');
});

test('B08-SHELL the real preload exposes one frozen aecp API of fixed channel calls and never the ipcRenderer itself', () => {
  const exposed = {};
  const calls = [];
  const electron = { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { invoke: (channel, payload) => { calls.push([channel, payload]); return Promise.resolve(); }, on: () => {}, removeListener: () => {} } };
  const load = Module._load;
  Module._load = function patched(request, ...rest) { return request === 'electron' ? electron : load.call(this, request, ...rest); };
  const preload = require.resolve('../electron/preload.cjs');
  delete require.cache[preload];
  try { require(preload); } finally { Module._load = load; delete require.cache[preload]; }
  assert.deepEqual(Object.keys(exposed), ['aecp']);
  assert.ok(Object.isFrozen(exposed.aecp));
  const api = Object.keys(exposed.aecp);
  assert.ok(api.length > 20);
  assert.ok(!api.some((name) => /^(ipcRenderer|require|process|shell|exec|eval|spawn|fs)$/i.test(name)), 'no privileged object is exposed');
  assert.ok(api.every((name) => typeof exposed.aecp[name] === 'function'), 'every member is a plain function');
  exposed.aecp.openChatGPT({ url: 'https://evil.example/' });
  assert.deepEqual(calls.at(-1), ['chatgpt:open', undefined], 'the renderer cannot inject arguments into a no-argument channel');
  void fs;
});

const modeCards = (html) => Object.fromEntries([...html.matchAll(/<article class="execution-mode-card([^"]*)">[\s\S]*?<strong>([^<]+)<\/strong>\s*<span class="status ([a-z]+)">([^<]+)<\/span>[\s\S]*?<\/article>/g)].map((match) => [match[2], { recommended: /recommended/.test(match[1]), ready: match[4] === 'Ready' }]));

test('B08-MODES execution-mode readiness is factual: unavailable modes are never Ready, and Official Full MCP is never Ready however healthy MCP looks', async () => {
  const base = { getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [] };
  const bare = createUi({ responses: { ...base, listAgents: [{ id: 'codex-cli', name: 'Codex CLI', role: 'coding', available: false, version: 'Not found' }] } });
  await bare.settle();
  const none = modeCards(bare.el('#controlContent').innerHTML);
  assert.deepEqual(none['Web Safe Bridge'], { recommended: true, ready: true });
  assert.deepEqual(none['Local Autonomous'], { recommended: false, ready: false }, 'no detected local worker means not ready');
  assert.equal(none['Official Full MCP'].ready, false);

  const rich = createUi({ responses: {
    ...base,
    listAgents: [{ id: 'codex-cli', name: 'Codex CLI', role: 'coding', available: true, version: 'codex 1.0' }],
    listProviders: [{ id: 'mcp', name: 'Remote MCP', kind: 'remote-mcp', status: 'READY' }],
    getMcpStatus: { running: true }
  } });
  await rich.settle();
  const html = rich.el('#controlContent').innerHTML;
  const cards = modeCards(html);
  assert.deepEqual(cards['Local Autonomous'], { recommended: true, ready: true }, 'a detected worker makes Local Autonomous ready and recommended');
  assert.equal(cards['Official Full MCP'].ready, false, 'a running local MCP and a healthy remote MCP endpoint never make Official Full MCP ready');
  assert.match(html, /externally gated|never makes Official Full MCP ready/);
});
