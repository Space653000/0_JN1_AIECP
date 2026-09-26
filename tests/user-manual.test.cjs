'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANUAL_PATH = path.join(ROOT, 'docs', '使用手冊.md');

test('B08-L188 the Traditional Chinese user manual exists and covers every required topic', () => {
  assert.ok(fs.existsSync(MANUAL_PATH), 'docs/使用手冊.md exists');
  const text = fs.readFileSync(MANUAL_PATH, 'utf8');
  assert.ok(text.length > 2000, 'the manual has real content, not a stub');
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  assert.ok(chineseChars > 500, 'the manual is actually written in Chinese');

  const requiredHeadings = [
    '安裝與啟動', '選擇 Workspace', '供應商設定', '每個 Agent', '打招呼',
    'Harness', '常見錯誤', '備份與還原', '緊急停止'
  ];
  for (const heading of requiredHeadings) assert.match(text, new RegExp('##[^\\n]*' + heading), `a heading mentions "${heading}"`);

  for (const topic of ['ARM64', 'https://aiapi.t-cyber.com/v1', 'spawn codex ENOENT', 'requires authentication', '額度用完', '被鎖']) {
    assert.ok(text.includes(topic), `the manual mentions "${topic}"`);
  }
});

test('B08-L188 the manual contains no secret-shaped value and no personal path', () => {
  const text = fs.readFileSync(MANUAL_PATH, 'utf8');
  // Key/token-shaped strings: long runs of letters+digits, or an explicit key/secret prefix.
  assert.doesNotMatch(text, /\b(?:sk-|ghp_|ghs_|AKIA|xox[abp]-)[A-Za-z0-9_-]{10,}/, 'no API-key-shaped string');
  assert.doesNotMatch(text, /\b[A-Za-z0-9]{32,}\b/, 'no long opaque token-shaped string');
  assert.doesNotMatch(text, /C:\\Users\\[^\s\\]+/i, 'no real Windows user path');
  assert.doesNotMatch(text, /\/home\/[^\s/]+/, 'no real Linux home path');
  assert.doesNotMatch(text, /@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}/, 'no email address');
});

test('B08-L188 README links to the manual', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /\[.*使用手冊.*\]\(docs\/使用手冊\.md\)/, 'README links to docs/使用手冊.md');
});
