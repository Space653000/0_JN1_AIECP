'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isAllowedNavigation } = require('../electron/lib/navigation-policy.cjs');
const { withinClipboardWriteLimit, MAX_CLIPBOARD_WRITE_BYTES } = require('../electron/lib/protocol.cjs');

const uiIndex = path.join(__dirname, '..', 'ui', 'index.html');
const uiUrl = pathToFileURL(uiIndex).href;

test('B04-ELECTRON-L34 navigation is limited to the packaged UI document', () => {
  assert.equal(isAllowedNavigation(uiUrl, uiIndex), true);
  assert.equal(isAllowedNavigation(uiUrl + '#tab-harness', uiIndex), true);
  assert.equal(isAllowedNavigation(uiUrl + '?locale=zh-TW', uiIndex), true);
});

test('B04-ELECTRON-L34 other file destinations, remote origins and malformed input are denied', () => {
  const other = pathToFileURL(path.join(__dirname, '..', 'package.json')).href;
  const outside = pathToFileURL(path.resolve(path.sep, 'Windows', 'System32', 'drivers', 'etc', 'hosts')).href;
  for (const url of [other, outside, 'file://attacker-host/share/index.html', 'https://chatgpt.com/', 'http://127.0.0.1/',
    'javascript:alert(1)', 'data:text/html,<script>1</script>', 'about:blank', '', 'not a url', undefined, null]) {
    assert.equal(isAllowedNavigation(url, uiIndex), false, String(url));
  }
});

test('B04-ELECTRON-L34 a sibling file with the UI name prefix is not the UI document', () => {
  const sibling = pathToFileURL(path.join(path.dirname(uiIndex), 'index.html.bak')).href;
  const parent = pathToFileURL(path.join(path.dirname(uiIndex), '..', 'index.html')).href;
  assert.equal(isAllowedNavigation(sibling, uiIndex), false);
  assert.equal(isAllowedNavigation(parent, uiIndex), false);
});

test('B11-8-L137 clipboard write limit is measured in UTF-8 bytes', () => {
  assert.equal(MAX_CLIPBOARD_WRITE_BYTES, 128 * 1024);
  assert.equal(withinClipboardWriteLimit('a'.repeat(128 * 1024)), true);
  assert.equal(withinClipboardWriteLimit('a'.repeat(128 * 1024 + 1)), false);
  assert.equal(withinClipboardWriteLimit(''), true);
});

test('B11-8-L137 CJK text under the character count but over the byte limit is rejected', () => {
  const cjk = '繁'.repeat(50000);
  assert.ok(cjk.length < 128 * 1024, 'fewer than 128 Ki characters');
  assert.ok(Buffer.byteLength(cjk, 'utf8') > 128 * 1024, 'more than 128 KiB in UTF-8');
  assert.equal(withinClipboardWriteLimit(cjk), false);
  assert.equal(withinClipboardWriteLimit('繁'.repeat(43690)), true);
  assert.equal(withinClipboardWriteLimit(12345), false);
  assert.equal(withinClipboardWriteLimit(undefined), false);
});
