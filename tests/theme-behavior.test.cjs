'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createThemeController, ORDER, KEY } = require('../ui/theme.js');

const memory = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: (k) => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)), values };
};
const media = (matches) => ({ matches });

test('B01-A11Y-L179 a fresh profile or an invalid stored value starts in system mode', () => {
  assert.equal(createThemeController({ storage: memory() }).theme, 'system');
  for (const bad of ['', 'blue', 'DARK', 'null', '0']) {
    assert.equal(createThemeController({ storage: memory({ [KEY]: bad }) }).theme, 'system', bad);
  }
  assert.equal(createThemeController().theme, 'system');
});

test('B01-A11Y-L179 a stored dark or light choice is restored', () => {
  assert.equal(createThemeController({ storage: memory({ [KEY]: 'dark' }) }).theme, 'dark');
  assert.equal(createThemeController({ storage: memory({ [KEY]: 'light' }) }).theme, 'light');
});

test('B01-A11Y-L179 system mode resolves to the OS preference and explicit choices ignore it', () => {
  const osLight = media(true);
  const osDark = media(false);
  assert.equal(createThemeController({ storage: memory(), media: osLight }).resolved(), 'light');
  assert.equal(createThemeController({ storage: memory(), media: osDark }).resolved(), 'dark');
  assert.equal(createThemeController({ storage: memory({ [KEY]: 'dark' }), media: osLight }).resolved(), 'dark');
  assert.equal(createThemeController({ storage: memory({ [KEY]: 'light' }), media: osDark }).resolved(), 'light');
  assert.equal(createThemeController({ storage: memory() }).resolved(), 'dark', 'no media support defaults to dark');
});

test('B01-A11Y-L179 system mode follows a live OS colour-scheme change', () => {
  const live = { matches: false };
  const controller = createThemeController({ storage: memory(), media: live });
  assert.equal(controller.resolved(), 'dark');
  live.matches = true;
  assert.equal(controller.resolved(), 'light');
  live.matches = false;
  assert.equal(controller.resolved(), 'dark');
});

test('B01-A11Y-L179 cycling goes system, dark, light and back, and persists every step', () => {
  const storage = memory();
  const controller = createThemeController({ storage, media: media(true) });
  assert.deepEqual(ORDER, ['system', 'dark', 'light']);
  const seen = [controller.theme];
  for (let i = 0; i < 6; i++) { seen.push(controller.cycle()); assert.equal(storage.values.get(KEY), controller.theme); }
  assert.deepEqual(seen, ['system', 'dark', 'light', 'system', 'dark', 'light', 'system']);
  assert.equal(createThemeController({ storage }).theme, 'system', 'a reload restores the last choice');
  controller.cycle();
  assert.equal(createThemeController({ storage }).theme, 'dark');
});

test('B01-A11Y-L179 an OS change only triggers a re-render while following the system', () => {
  const controller = createThemeController({ storage: memory(), media: media(true) });
  assert.equal(controller.followsSystem(), true);
  controller.cycle();
  assert.equal(controller.theme, 'dark');
  assert.equal(controller.followsSystem(), false);
  controller.cycle();
  assert.equal(controller.followsSystem(), false);
  controller.cycle();
  assert.equal(controller.followsSystem(), true);
});

test('B01-A11Y-L179 blocked or throwing storage never breaks theme switching', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const controller = createThemeController({ storage: broken, media: media(false) });
  assert.equal(controller.theme, 'system');
  assert.equal(controller.cycle(), 'dark');
  assert.equal(controller.resolved(), 'dark');
  assert.equal(controller.cycle(), 'light');
});

test('B01-A11Y-L179 the UI loads the theme module before app.js and app.js delegates to it', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  assert.ok(html.indexOf('./theme.js') > -1 && html.indexOf('./theme.js') < html.indexOf('./app.js'), 'theme.js is loaded before app.js');
  const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  assert.match(app, /AECPTheme\.createThemeController\(/);
  assert.match(app, /themeController\.cycle\(\)/);
  assert.match(app, /themeController\.resolved\(\)/);
  assert.match(app, /themeController\.followsSystem\(\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\('aecp-theme'/, 'app.js no longer keeps its own copy of the theme logic');
});
