'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUi } = require('./support/ui-harness.cjs');
const { DICTIONARIES, createI18n, translatePhrase, DEFAULT_LOCALE } = require('../ui/i18n.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const store = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, value) };
};

test('the interface starts in Traditional Chinese, whatever language the browser reports', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-TW');
  assert.equal(createI18n({ storage: store() }).getLocale(), 'zh-TW');
  const ui = createUi({ files: ['i18n.js'] });
  assert.equal(ui.evaluate('window.AECPI18N.getLocale()'), 'zh-TW', 'a first run with nothing stored is Traditional Chinese');
  assert.equal(ui.evaluate("window.AECPI18N.t('workspace.choose')"), '選擇工作區');
  const english = createUi({ files: ['i18n.js'], storage: { 'aecp-locale': 'en' } });
  assert.equal(english.evaluate('window.AECPI18N.getLocale()'), 'en', 'the stored English choice is honoured');
  assert.equal(english.evaluate("window.AECPI18N.t('workspace.choose')"), 'Choose Workspace');
});

test('English stays available as a switchable extra and the choice is remembered', () => {
  const storage = store();
  const i18n = createI18n({ storage });
  assert.equal(i18n.setLocale('en'), 'en');
  assert.equal(storage.getItem('aecp-locale'), 'en');
  assert.equal(createI18n({ storage }).getLocale(), 'en', 'the next start uses the stored choice');
  assert.equal(i18n.tx('Choose folder'), 'Choose folder', 'English text is untouched');
  i18n.setLocale('zh-TW');
  assert.equal(i18n.tx('Choose folder'), '選擇資料夾');
  assert.equal(createI18n({ storage }).getLocale(), 'zh-TW');
  assert.deepEqual([...i18n.supported], ['en', 'zh-TW']);
});

test('every dictionary key exists in both languages', () => {
  assert.deepEqual(Object.keys(DICTIONARIES['zh-TW']).sort(), Object.keys(DICTIONARIES.en).sort());
});

test('every English text, label and placeholder written into ui/index.html has a Traditional Chinese translation', () => {
  const missing = [];
  const seen = new Set();
  for (const match of html.matchAll(/<([a-z0-9]+)([^>]*)>([^<]+)</gi)) {
    const text = match[3].split(/\s+/).join(' ').trim();
    if (!text || !/[A-Za-z]{3}/.test(text) || /data-i18n=/.test(match[2]) || ['script', 'style', 'title'].includes(match[1])) continue;
    seen.add(text);
  }
  for (const match of html.matchAll(/(aria-label|placeholder)="([^"]+)"/g)) seen.add(match[2]);
  const identity = new Set(['AI Engineering Control Plane', 'API', 'Responses', 'Chat Completions']);
  for (const text of seen) if (!identity.has(text) && translatePhrase(text) === text) missing.push(text);
  assert.ok(seen.size > 80, `the page has plenty of text to check (${seen.size})`);
  assert.deepEqual(missing, []);
});

test('messages the renderer produces at run time are translated too, including ones that carry a name or a number', () => {
  const samples = {
    'Workspace connected: demo': '已連線工作區：demo',
    'Task imported: Inspect': '已匯入任務：Inspect',
    'Backup exported: 12 files, credentials excluded.': '已匯出備份：12 個檔案，不含憑證。',
    'Risk: UNKNOWN': '風險：未知',
    'Needs me: YES · delivery approval': '需要我處理：是 · delivery approval',
    '3 repo(s) detected': '偵測到 3 個儲存庫',
    'Local MCP stopped.': '本機 MCP 已停止。',
    'STOP ALL will cancel every active mission. Continue?': '「全部停止」會取消所有進行中的 Mission。要繼續嗎？',
    'Install AECP v1.2.3? The installer is downloaded from the allowlisted private GitHub Release and SHA-256 verified before launch.': '要安裝 AIECP v1.2.3 嗎？安裝程式會從允許清單內的私人 GitHub Release 下載，並在啟動前通過 SHA-256 驗證。',
    '  Add Repo  ': '  新增儲存庫  '
  };
  for (const [english, chinese] of Object.entries(samples)) assert.equal(translatePhrase(english), chinese, english);
  assert.equal(translatePhrase('some text nobody translated'), 'some text nobody translated', 'unknown text is left alone rather than guessed');
  assert.equal(translatePhrase('run_1'), 'run_1', 'identifiers are never changed');
});

test('the per-agent panel, its results and the Worker health details are all translated, and the product is named AIECP in Chinese', async () => {
  const { createUi } = require('./support/ui-harness.cjs');
  const view = { schema: 'aecp.agent-settings/v1', ollamaModels: ['qwen3:4b-instruct'], agents: [
    { id: 'chatgpt-web', name: 'ChatGPT Web', kind: 'web', controllable: false, model: null, modelSource: 'default', effort: null, effortSupported: false, efforts: [], sayHi: { supported: false, network: false, keyConfigured: null } },
    { id: 'ollama', name: 'Local Ollama', kind: 'local', model: null, modelSource: 'default', effort: null, effortSupported: true, efforts: ['low', 'medium', 'high'], sayHi: { supported: true, network: false, keyConfigured: null } },
    { id: 'codex-official', name: 'Codex OFFICIAL (OpenAI Official)', kind: 'codex-worker', model: 'm', modelSource: 'settings', effort: null, effortSupported: true, efforts: ['low'], sayHi: { supported: true, network: true, keyConfigured: null } },
    { id: 'codex-pega', name: 'Codex PEGA', kind: 'codex-worker', model: null, modelSource: 'default', effort: null, effortSupported: true, efforts: ['low'], sayHi: { supported: true, network: true, keyConfigured: false } }
  ] };
  const ui = createUi({ responses: { getState: { currentWorkspace: { name: 'W', rootPath: '/w', repositories: [] }, providers: [] }, listTasks: [], getAgentSettings: view, listAgents: [{ id: 'ollama', name: 'Local Ollama', role: 'local-models', available: true, version: 'v' }] } });
  await ui.settle();
  const pieces = ui.el('#agentList').innerHTML.split(/<[^>]*>/).map((piece) => piece.split(/\s+/).join(' ').trim()).filter((piece) => /[A-Za-z]{3}/.test(piece));
  const identity = new Set(['Local Ollama', 'Codex PEGA', 'ChatGPT Web', 'qwen3:4b-instruct', 'local-models · v', 'Codex OFFICIAL (OpenAI Official)', 'codex-worker · m']);
  const untranslated = [...new Set(pieces)].filter((piece) => !identity.has(piece) && translatePhrase(piece) === piece);
  assert.deepEqual(untranslated, []);
  assert.equal(translatePhrase('Codex OFFICIAL (OpenAI Official)'), 'Codex OFFICIAL（OpenAI 官方）');
  for (const english of ['Codex worker is configured, but live network use is not approved.', 'Codex OFFICIAL isolated CODEX_HOME requires authentication.', 'Ollama CLI is available, but an explicit model is required before invocation.', 'Ollama is not installed or not on PATH.', 'No answer within 60 seconds.', 'The PEGA key is not set yet.']) {
    assert.notEqual(translatePhrase(english), english, english);
  }
  const zh = [translatePhrase('Opens in your normal browser. AECP does not inject, scrape, or modify chatgpt.com.'), translatePhrase('Model and effort are chosen on the ChatGPT website itself (AIECP does not control the official website).'), createI18n({ storage: null }).t('workspace.notSet')];
  for (const text of zh) assert.doesNotMatch(text, /\bAECP\b/, 'the product name in Chinese text is AIECP');
  assert.match(translatePhrase('Opens in your normal browser. AECP does not inject, scrape, or modify chatgpt.com.'), /AIECP/);
  assert.equal(translatePhrase('AECP_GITHUB_TOKEN'), 'AECP_GITHUB_TOKEN', 'identifiers are untouched');
});
