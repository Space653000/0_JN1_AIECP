'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { createUi } = require('./support/ui-harness.cjs');

const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-adapters-'));
const emptyBin = path.join(sandbox, 'empty');
const fakeBin = path.join(sandbox, 'with-codex');
const realPath = process.env.PATH;
const CLI_IDS = ['codex-cli', 'claude-code', 'gemini-cli', 'opencode', 'ollama'];

test.before(async () => {
  fs.mkdirSync(emptyBin);
  fs.mkdirSync(fakeBin);
  if (process.platform === 'win32') fs.copyFileSync(process.execPath, path.join(fakeBin, 'codex.exe'));
  else { fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\necho "codex-cli 9.9.9"\n'); fs.chmodSync(path.join(fakeBin, 'codex'), 0o755); }
  await ctx.start();
});
test.after(() => {
  process.env.PATH = realPath;
  fs.rmSync(sandbox, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

const agentsUi = async (agents) => {
  const ui = createUi({ responses: { getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [], listAgents: agents, listBrowserWindows: [] } });
  await ui.settle();
  return ui;
};
const buttonFor = (html, id) => new RegExp(`<button[^>]*data-agent-id="${id}"[^>]*>`).exec(html)?.[0] || '';

test('B15-L117 when detection finds nothing, every local adapter is reported unavailable and the UI shows and enables nothing for it', async () => {
  process.env.PATH = emptyBin;
  const agents = await H('agents:list');
  process.env.PATH = realPath;
  assert.deepEqual(agents.map((agent) => agent.id), ['chatgpt-web', ...CLI_IDS]);
  for (const agent of agents.filter((item) => CLI_IDS.includes(item.id))) {
    assert.equal(agent.available, false, `${agent.id} must not be reported available when it cannot be run`);
    assert.doesNotMatch(agent.version, /\d+\.\d+/, 'no fabricated version string');
  }
  assert.equal(agents[0].available, true, 'the official ChatGPT web surface is an external browser page, not a detected process');

  const ui = await agentsUi(agents);
  const html = ui.el('#agentList').innerHTML;
  for (const id of CLI_IDS) {
    assert.match(buttonFor(html, id), /disabled/, `${id} launch button is disabled`);
  }
  assert.doesNotMatch(buttonFor(html, 'chatgpt-web'), /disabled/);
  assert.equal((html.match(/Not detected/g) || []).length, CLI_IDS.length, 'every unavailable adapter says so');
});

test('B15-L117 launching an adapter is re-checked in the main process: an undetectable adapter cannot be launched', async () => {
  process.env.PATH = emptyBin;
  try {
    for (const id of CLI_IDS) await assert.rejects(() => H('agents:launch', { agentId: id }), /not installed or not on PATH/, id);
    await assert.rejects(() => H('agents:launch', { agentId: 'made-up-agent' }), /Unsupported agent/);
  } finally { process.env.PATH = realPath; }
});

test('B15-L117 only the adapter that really runs is reported available, with the version it printed', async () => {
  process.env.PATH = `${fakeBin}${path.delimiter}${emptyBin}`;
  const agents = await H('agents:list');
  process.env.PATH = realPath;
  const byId = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  assert.equal(byId['codex-cli'].available, true);
  assert.match(byId['codex-cli'].version, /\d+\.\d+/);
  for (const id of CLI_IDS.filter((item) => item !== 'codex-cli')) assert.equal(byId[id].available, false, id);
  const html = (await agentsUi(agents)).el('#agentList').innerHTML;
  assert.doesNotMatch(buttonFor(html, 'codex-cli'), /disabled/);
  for (const id of CLI_IDS.filter((item) => item !== 'codex-cli')) assert.match(buttonFor(html, id), /disabled/, id);
});

test('B15-L117 a failed browser-window detection leaves the dock unavailable instead of inventing a window', async () => {
  const ui = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    listBrowserWindows: () => { throw new Error('PowerShell exited with an error'); }
  } });
  await ui.settle();
  assert.equal(ui.el('#dockBrowserLeftButton').disabled, true);
  assert.equal(ui.el('#dockBrowserRightButton').disabled, true);
  assert.match(ui.el('#browserWindowSelect').innerHTML, /No allowlisted browser window detected/);
  const withWindow = createUi({ responses: {
    getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [],
    listBrowserWindows: [{ process: 'chrome', pid: 4242, handle: 1 }]
  } });
  await withWindow.settle();
  assert.equal(withWindow.el('#dockBrowserLeftButton').disabled, false, 'the buttons enable only when a window was really detected');
  assert.match(withWindow.el('#browserWindowSelect').innerHTML, /chrome · PID 4242/);
});

test('B15-L117 the desktop adapter only reports allowlisted browser windows it actually parsed, and a failed detection throws', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const realExecFile = cp.execFile;
  let reply = { stdout: '[]', stderr: '' };
  const fake = (command, args, options, callback) => {
    if (reply.error) { callback(reply.error, '', ''); return {}; }
    callback(null, reply.stdout, reply.stderr);
    return {};
  };
  fake[util.promisify.custom] = async () => { if (reply.error) throw reply.error; return { stdout: reply.stdout, stderr: reply.stderr }; };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  cp.execFile = fake;
  const adapterPath = require.resolve('../electron/lib/windows-desktop-adapter.cjs');
  delete require.cache[adapterPath];
  try {
    const { WindowsDesktopAdapter } = require('../electron/lib/windows-desktop-adapter.cjs');
    const adapter = new WindowsDesktopAdapter();
    reply = { stdout: '', stderr: '' };
    assert.deepEqual(await adapter.listBrowserWindows(), [], 'no output means no windows, not a guess');
    reply = { stdout: JSON.stringify([{ process: 'notepad', pid: 10, handle: 1 }, { process: 'chrome', pid: -3, handle: 2 }, { process: 'chrome', pid: 4242, handle: 99 }, { process: 'msedge', pid: 'x', handle: 1 }]), stderr: '' };
    assert.deepEqual(await adapter.listBrowserWindows(), [{ process: 'chrome', pid: 4242, handle: 99 }], 'only allowlisted browsers with valid ids survive');
    reply = { stdout: JSON.stringify({ process: 'firefox', pid: 7, handle: 3 }), stderr: '' };
    assert.deepEqual(await adapter.listBrowserWindows(), [{ process: 'firefox', pid: 7, handle: 3 }]);
    reply = { stdout: 'not json at all', stderr: '' };
    await assert.rejects(() => adapter.listBrowserWindows());
    reply = { stdout: '', stderr: 'Access is denied' };
    await assert.rejects(() => adapter.listBrowserWindows(), /Access is denied/);
    reply = { error: new Error('spawn powershell.exe ENOENT') };
    await assert.rejects(() => adapter.listBrowserWindows(), /ENOENT/);
  } finally {
    cp.execFile = realExecFile;
    Object.defineProperty(process, 'platform', platform);
    delete require.cache[adapterPath];
  }
});
