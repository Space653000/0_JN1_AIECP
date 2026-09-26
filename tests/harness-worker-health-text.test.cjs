'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');
const { translatePhrase } = require('../ui/i18n.js');

const STATUS = {
  schema: 'aecp.control-plane/v1', adapterSecurity: { ok: true }, resources: { schema: 'aecp.resources/v1', repositories: {} }, runs: [], tasks: [], approvals: [], locks: [],
  agents: [{
    id: 'codex-official', providerId: 'openai-official', providerName: 'OpenAI Official', workerId: 'codex-official',
    health: 'DEGRADED', healthDetail: 'Codex worker is configured, but live network use is not approved.'
  }, {
    id: 'codex-pega', providerId: 'pega', providerName: 'PEGA', workerId: 'codex-pega',
    health: 'NOT_CONFIGURED', healthDetail: 'Isolated CODEX_HOME is missing.'
  }],
  workers: [
    { id: 'codex-official', providerId: 'openai-official', providerName: 'OpenAI Official', role: 'builder', health: 'DEGRADED', healthDetail: 'Codex worker is configured, but live network use is not approved.' },
    { id: 'codex-pega', providerId: 'pega', providerName: 'PEGA', role: 'builder', health: 'AUTH_REQUIRED', healthDetail: 'Worker credential is not configured.' }
  ]
};

async function boot(files) {
  const ui = createUi({ files, responses: { getControlPlaneStatus: STATUS, getControlPlaneEvents: [] } });
  ui.document.body.dataset.aecpCommand = '1';
  await ui.callbacks.onControlPlaneEvent[0]();
  await ui.settle();
  return ui;
}

test('B0020 a DEGRADED worker waiting only for network approval gets a plain explanation, and the status is never turned green', async () => {
  const ui = await boot(['i18n.js', 'dashboard-projection.js', 'harness-console.js']);
  const html = ui.el('#hcApprovals')?.innerHTML || ui.evaluate('document.querySelector("#controlContent")?.innerHTML || document.body.innerHTML');
  assert.match(html, /Codex worker is configured, but live network use is not approved\./);
  assert.match(html, /This is normal while idle: AIECP only asks you to approve network access when it actually dispatches work\.|閒置時的正常狀態/);
  const degradedSpan = /<span class="status (\w+)">DEGRADED<\/span>/.exec(html);
  assert.ok(degradedSpan, 'the DEGRADED label is still shown as text, not just a colour');
  assert.notEqual(degradedSpan[1], 'ready', 'a DEGRADED worker waiting on approval is never shown as ready/green');
});

test('B0020 a worker degraded for a different reason gets no network hint, and other states are unaffected', async () => {
  const other = { ...STATUS, workers: [{ id: 'codex-pega', providerId: 'pega', providerName: 'PEGA', role: 'builder', health: 'DEGRADED', healthDetail: 'Custom Codex worker requires an explicit model.' }] };
  const ui = createUi({ files: ['i18n.js', 'dashboard-projection.js', 'harness-console.js'], responses: { getControlPlaneStatus: other, getControlPlaneEvents: [] } });
  ui.document.body.dataset.aecpCommand = '1';
  await ui.callbacks.onControlPlaneEvent[0]();
  await ui.settle();
  const html = ui.evaluate('document.querySelector("#controlContent")?.innerHTML || document.body.innerHTML');
  assert.doesNotMatch(html, /This is normal while idle|閒置時的正常狀態/);
  assert.match(html, /Custom Codex worker requires an explicit model\.|自訂的 Codex Worker 必須明確指定模型/);
});

test('B0020 the Chinese interface shows the health words and the hint translated; English mode keeps the original English', async () => {
  const zh = await boot(['i18n.js', 'dashboard-projection.js', 'harness-console.js']);
  const zhHtml = zh.evaluate('document.querySelector("#controlContent")?.innerHTML || document.body.innerHTML');
  assert.match(zhHtml, /閒置時的正常狀態|真正派工時才會請你核准網路/);
  assert.equal(zh.evaluate('window.AECPI18N.getLocale()'), 'zh-TW');
  const en = createUi({ files: ['i18n.js', 'dashboard-projection.js', 'harness-console.js'], storage: { 'aecp-locale': 'en' }, responses: { getControlPlaneStatus: STATUS, getControlPlaneEvents: [] } });
  en.document.body.dataset.aecpCommand = '1';
  await en.callbacks.onControlPlaneEvent[0]();
  await en.settle();
  const enHtml = en.evaluate('document.querySelector("#controlContent")?.innerHTML || document.body.innerHTML');
  assert.match(enHtml, /Codex worker is configured, but live network use is not approved\./);
  assert.match(enHtml, /This is normal while idle: AIECP only asks you to approve network access when it actually dispatches work\./);
  const officialCard = enHtml.slice(enHtml.indexOf('OFFICIAL HEALTH'), enHtml.indexOf('OFFICIAL HEALTH') + 400);
  assert.doesNotMatch(officialCard, /[一-鿿]/, 'no Chinese leaks into the English health card');
});

test('B0020 the health-related phrases used here are all translated (parseable via translatePhrase)', () => {
  for (const phrase of [
    'Codex worker is configured, but live network use is not approved.',
    'Codex worker credential is configured, but credential use is not approved.',
    'Isolated CODEX_HOME is missing.',
    'Worker credential is not configured.',
    'This is normal while idle: AIECP only asks you to approve network access when it actually dispatches work.'
  ]) assert.notEqual(translatePhrase(phrase), phrase, phrase);
});
