'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The real stylesheet is parsed: the two theme blocks are the only place colour values live.
const CSS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'styles.css'), 'utf8');

function block(selector) {
  const start = CSS.indexOf(selector + ' {');
  assert.ok(start >= 0, `${selector} block exists in ui/styles.css`);
  const end = CSS.indexOf('}', start);
  const tokens = {};
  for (const match of CSS.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}
const DARK = block(':root');
const LIGHT = { ...DARK, ...block(':root[data-theme="light"]') };
const THEMES = { dark: DARK, light: LIGHT };

const rgb = (hex) => {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is a 6-digit hex colour`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

for (const [name, t] of Object.entries(THEMES)) {
  const check = (fg, bg, min, why) => {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= min, `${name}: ${why} ${fg} ${t[fg]} on ${bg} ${t[bg]} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  };

  test(`${name} theme: body text, secondary text and faint text reach 4.5:1 on the page and on cards`, () => {
    for (const surface of ['--bg', '--panel', '--panel-2', '--sidebar']) {
      check('--text', surface, 4.5, 'text');
      check('--muted', surface, 4.5, 'secondary text');
      check('--faint', surface, 4.5, 'faint text');
    }
    check('--text', '--panel-3', 4.5, 'text');
    check('--muted', '--panel-3', 4.5, 'secondary text');
  });

  test(`${name} theme: the accent used as text and the three status colours reach 4.5:1 on the page and on cards`, () => {
    for (const surface of ['--bg', '--panel-2']) {
      for (const colour of ['--accent-fg', '--good', '--warn', '--bad', '--blue']) check(colour, surface, 4.5, 'coloured text');
    }
  });

  test(`${name} theme: text on the accent fill (primary button) reaches 4.5:1 and the fill itself is a visible boundary`, () => {
    check('--accent-text', '--accent', 4.5, 'primary button label');
    check('--accent', '--bg', 3, 'accent fill');
  });

  test(`${name} theme: the emergency-stop label reaches 4.5:1 on the danger fill`, () => {
    check('--bad-text', '--bad', 4.5, 'emergency stop label');
  });

  test(`${name} theme: control borders reach 3:1 against the page and against cards`, () => {
    for (const surface of ['--bg', '--panel-2']) check('--line-strong', surface, 3, 'control border');
  });
}

test('the two themes define the same token set, so no colour silently falls back to the other theme', () => {
  const lightOnly = block(':root[data-theme="light"]');
  for (const key of Object.keys(lightOnly)) assert.ok(key in DARK, `${key} is defined in the dark block too`);
  for (const key of ['--bg', '--panel', '--panel-2', '--panel-3', '--sidebar', '--line', '--line-strong', '--text', '--muted', '--faint', '--accent', '--accent-fg', '--accent-text', '--good', '--warn', '--bad']) {
    assert.ok(key in lightOnly, `the light theme sets ${key}`);
  }
});

test('the two themes use the ChatGPT/Codex-style palette the owner asked for', () => {
  assert.deepEqual(
    ['--bg', '--panel-2', '--panel-3', '--line', '--text', '--muted', '--accent', '--warn', '--bad'].map((k) => DARK[k]),
    ['#212121', '#2f2f2f', '#3a3a3a', '#424242', '#ececec', '#b4b4b4', '#19c37d', '#f5b74f', '#ff6b6b']
  );
  assert.deepEqual(
    ['--bg', '--panel-2', '--line', '--text', '--muted', '--accent'].map((k) => LIGHT[k]),
    ['#ffffff', '#f7f7f8', '#e5e5e5', '#0d0d0d', '#6e6e80', '#10a37f']
  );
});

test('the palette is the only place colour values live: rules outside the theme blocks use tokens', () => {
  const afterTokens = CSS.slice(CSS.indexOf(':root[data-theme="light"]'));
  const body = afterTokens.slice(afterTokens.indexOf('}') + 1);
  const hard = [...body.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
  assert.deepEqual(hard, ['#11151b', '#fff'], 'only the skip-link fallbacks inside var(--x, fallback) remain');
});

test('keyboard focus stays visible and reduced motion is still honoured', () => {
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(CSS, /data-motion="reduced"/);
});
