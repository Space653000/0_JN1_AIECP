'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeLocale,createI18n}=require('../ui/i18n.js');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('localization framework supports English and Traditional Chinese with persisted locale',()=>{
  const values=new Map();
  const storage={getItem:(k)=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const i18n=createI18n({initialLocale:'en-US',storage});
  assert.equal(i18n.getLocale(),'en');
  assert.equal(i18n.t('workspace.choose'),'Choose Workspace');
  i18n.setLocale('zh-TW');
  assert.equal(i18n.getLocale(),'zh-TW');
  assert.equal(i18n.t('workspace.choose'),'選擇工作區');
  assert.equal(values.get('aecp-locale'),'zh-TW');
  assert.equal(normalizeLocale('zh-Hant-TW'),'zh-TW');
});

test('HTML exposes keyboard and screen-reader landmarks',()=>{
  const html=read('ui/index.html');
  assert.match(html,/class="skip-link" href="#controlContent"/);
  assert.match(html,/id="languageButton"/);
  assert.match(html,/role="tab" aria-selected="true"/);
  assert.match(html,/id="toastRegion"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/id="closeProviderButton"[^>]*aria-label=/);
  assert.match(html,/\.\/i18n\.js/);
});

test('renderer updates ARIA tab state and supports Escape/arrow-key navigation',()=>{
  const app=read('ui/app.js');
  assert.match(app,/setAttribute\('aria-selected'/);
  assert.match(app,/event\.key === 'Escape'/);
  assert.match(app,/event\.key === 'ArrowLeft'/);
  assert.match(app,/event\.key === 'ArrowRight'/);
  assert.match(app,/AECPI18N/);
});

test('styles provide visible focus and reduced-motion support',()=>{
  const css=read('ui/styles.css');
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
  assert.match(css,/\.skip-link:focus/);
});
