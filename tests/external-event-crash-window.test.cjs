'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { makeBase, makeRouter, removeDir } = require('./support/e2e-fixtures.cjs');

const EVENT = { externalId: 'ext-1', idempotencyKey: 'github:delivery-1', eventType: 'workflow_run', correlationId: 'run-corr-1', payload: { n: 1 } };

async function boot(t, base) {
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({}) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  return cp;
}
const lines = async (file) => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
const correlated = async (cp) => (await cp.listEvents(500)).filter((event) => event.type === 'external.correlated' && event.externalId === 'ext-1');

test('G11-crash a crash between the received and the correlated write is repaired on the next start, exactly once', async (t) => {
  const base = await makeBase('aecp-ext-crash-');
  t.after(async () => removeDir(base));
  const first = await boot(t, base);
  // Simulate the process dying after the received record was written and before the correlated one.
  first.event = async () => { throw new Error('simulated crash before the correlated write'); };
  await assert.rejects(() => first.ingestExternalEvent(EVENT), /simulated crash/);
  assert.equal((await lines(first.ledger.file)).filter((entry) => entry.type === 'external.received').length, 1, 'received is durable');
  assert.deepEqual(await correlated(first), [], 'and the correlation is really missing');
  await first.shutdown();

  const restarted = await boot(t, base);
  const repaired = await correlated(restarted);
  assert.equal(repaired.length, 1, 'the missing correlation was written on start-up');
  assert.equal(repaired[0].correlationId, 'run-corr-1');
  assert.equal(repaired[0].idempotencyKey, 'github:delivery-1:correlated');
  assert.equal((await lines(restarted.ledger.file)).filter((entry) => entry.type === 'external.received').length, 1, 'no second received record');
  await restarted.shutdown();

  const again = await boot(t, base);
  assert.equal((await correlated(again)).length, 1, 'a further restart repairs nothing more: idempotent');
  assert.deepEqual(await again.ingestExternalEvent(EVENT), { duplicate: true }, 'replay protection is intact');
  assert.equal((await correlated(again)).length, 1);
});

test('G11-crash re-delivery of the same event before any restart also completes the missing correlation', async (t) => {
  const base = await makeBase('aecp-ext-redeliver-');
  t.after(async () => removeDir(base));
  const cp = await boot(t, base);
  const realEvent = cp.event.bind(cp);
  cp.event = async () => { throw new Error('simulated crash'); };
  await assert.rejects(() => cp.ingestExternalEvent(EVENT), /simulated crash/);
  cp.event = realEvent;
  assert.deepEqual(await cp.ingestExternalEvent(EVENT), { duplicate: true }, 'still reported as a duplicate delivery');
  assert.equal((await correlated(cp)).length, 1, 'but the correlation that was missing is now there');
  await cp.ingestExternalEvent(EVENT);
  assert.equal((await correlated(cp)).length, 1, 'and it is never written twice');
});

test('G11-crash an ordinary delivery is still received once and correlated once', async (t) => {
  const base = await makeBase('aecp-ext-normal-');
  t.after(async () => removeDir(base));
  const cp = await boot(t, base);
  assert.deepEqual(await cp.ingestExternalEvent(EVENT), { duplicate: false });
  assert.deepEqual(await cp.ingestExternalEvent(EVENT), { duplicate: true });
  assert.equal((await correlated(cp)).length, 1);
  assert.equal((await lines(cp.ledger.file)).filter((entry) => entry.type === 'external.received').length, 1);
});
