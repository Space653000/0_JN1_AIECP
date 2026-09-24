'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const { isAllowedNavigation } = require('../electron/lib/navigation-policy.cjs');
const { WindowsUiAdapter, isBrowserProcess } = require('../electron/lib/windows-ui-adapter.cjs');
const { IPC_SCHEMAS, createValidatedIpc } = require('../electron/lib/ipc-validation.cjs');

const ROOT = path.resolve(__dirname, '..');
const UI_INDEX = path.join(ROOT, 'ui', 'index.html');

function loadPreloadWithFakeElectron() {
  const exposed = {};
  const invoked = [];
  const ipcRenderer = {
    invoke: (...args) => { invoked.push(args); return Promise.resolve(true); },
    on() {},
    removeListener() {}
  };
  const contextBridge = { exposeInMainWorld: (name, api) => { exposed[name] = api; } };
  const originalLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return { contextBridge, ipcRenderer };
    return originalLoad.call(this, request, ...rest);
  };
  const preloadPath = require.resolve('../electron/preload.cjs');
  delete require.cache[preloadPath];
  try { require(preloadPath); } finally { Module._load = originalLoad; delete require.cache[preloadPath]; }
  return { exposed, invoked, ipcRenderer };
}

test('R1.1 the app window can never be navigated to ChatGPT or any page other than the packaged UI', () => {
  assert.equal(isAllowedNavigation(pathToUrl(UI_INDEX), UI_INDEX), true);
  for (const url of ['https://chatgpt.com/', 'https://chat.openai.com/', 'http://chatgpt.com/', 'javascript:alert(1)', 'data:text/html,x', 'file://evil-host/share/index.html', pathToUrl(path.join(ROOT, 'ui', 'other.html')), 'not a url']) {
    assert.equal(isAllowedNavigation(url, UI_INDEX), false, `${url} must be refused`);
  }
});

function pathToUrl(file) {
  return require('node:url').pathToFileURL(file).href;
}

test('R1.1 UI Automation refuses to inspect browser windows (ChatGPT DOM) by default', async () => {
  for (const name of ['chrome', 'msedge', 'firefox', 'brave']) assert.equal(isBrowserProcess(name), true, `${name} is a browser`);
  assert.equal(isBrowserProcess('notepad'), false);

  const adapter = new WindowsUiAdapter();
  adapter.listWindows = async () => [{ pid: 4242, processName: 'chrome', title: 'ChatGPT', browser: true }];
  await assert.rejects(adapter.inspect(4242), /never inspects ChatGPT\/browser DOM/);
});

test('R1.1 chatgpt:open takes no renderer payload, so the renderer cannot choose or script what is opened', async () => {
  assert.equal(IPC_SCHEMAS['chatgpt:open'].mode, 'none');
  const handlers = {};
  const ipc = createValidatedIpc({ handle: (channel, fn) => { handlers[channel] = fn; } });
  const received = [];
  ipc.handle('chatgpt:open', async (_event, payload) => { received.push(payload); return true; });

  await assert.rejects(handlers['chatgpt:open']({}, { url: 'https://evil.example/', script: 'document.cookie' }));
  await assert.rejects(handlers['chatgpt:open']({}, 'https://evil.example/'));
  assert.equal(await handlers['chatgpt:open']({}), true);
  assert.deepEqual(received, [undefined]);
});

test('R1.1 the renderer bridge exposes only fixed IPC functions and no raw Electron, DOM or session access', () => {
  const { exposed, invoked, ipcRenderer } = loadPreloadWithFakeElectron();
  const api = exposed.aecp;
  assert.ok(api && Object.isFrozen(api));
  assert.deepEqual(Object.keys(exposed), ['aecp']);

  for (const [name, value] of Object.entries(api)) assert.equal(typeof value, 'function', `${name} must be a function`);
  for (const forbidden of ['ipcRenderer', 'webContents', 'webFrame', 'session', 'cookies', 'executeJavaScript', 'require', 'process', 'shell']) {
    assert.equal(forbidden in api, false, `${forbidden} must not be exposed`);
  }
  assert.notEqual(Object.values(api).includes(ipcRenderer), true);

  api.openChatGPT('https://evil.example/', { script: 'document.cookie' });
  assert.deepEqual(invoked, [['chatgpt:open', undefined]]);
});

test('R1.1 no AECP code scrapes, scripts or intercepts a browser session, and ChatGPT is only opened externally', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(cjs|mjs|js)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'electron'));
  walk(path.join(ROOT, 'ui'));
  assert.ok(files.length > 20);

  const forbidden = /executeJavaScript\(|\.session\.cookies|webRequest\.|<webview|new BrowserView|new WebContentsView|debugger\.attach|loadURL\(\s*['"`]https?:\/\/(?:chatgpt|chat\.openai)/;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, forbidden, `${path.relative(ROOT, file)} must not touch a browser session`);
  }

  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
  const chatgptLines = main.split(/\r?\n/).filter((text) => /https?:\/\/chatgpt\.com/.test(text));
  assert.ok(chatgptLines.length >= 2);
  for (const line of chatgptLines) assert.match(line, /shell\.openExternal\('https:\/\/chatgpt\.com\/'\)/);
});
