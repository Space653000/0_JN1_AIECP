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
    'Install AECP v1.2.3? The installer is downloaded from the allowlisted private GitHub Release and SHA-256 verified before launch.': '要安裝 AECP v1.2.3 嗎？安裝程式會從允許清單內的私人 GitHub Release 下載，並在啟動前通過 SHA-256 驗證。',
    '  Add Repo  ': '  新增儲存庫  '
  };
  for (const [english, chinese] of Object.entries(samples)) assert.equal(translatePhrase(english), chinese, english);
  assert.equal(translatePhrase('some text nobody translated'), 'some text nobody translated', 'unknown text is left alone rather than guessed');
  assert.equal(translatePhrase('run_1'), 'run_1', 'identifiers are never changed');
});
