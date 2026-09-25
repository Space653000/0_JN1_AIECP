'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LockManager } = require('../electron/lib/lock-manager.cjs');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { makeBase, makeRouter, removeDir, waitFor } = require('./support/e2e-fixtures.cjs');

const expire = async (manager, key) => { manager.state.locks[key].expiresAt = new Date(Date.now() - 5000).toISOString(); await manager.persist(); };

test('G11-4 a recovered stale lock records why it was released, and the record survives a restart', async (t) => {
  const base = await makeBase('aecp-lock-reason-');
  t.after(async () => removeDir(base));
  const manager = new LockManager(path.join(base, 'locks'));
  await manager.init();
  await manager.acquire('repo:a', 'task-1', { meta: { secret: 'token-value' } });
  await manager.acquire('repo:b', 'task-2');
  await expire(manager, 'repo:a');
  const removed = await manager.recover();
  assert.deepEqual([...removed], ['repo:a'], 'callers still get the released keys');
  assert.equal(removed.released.length, 1);
  const [record] = removed.released;
  assert.deepEqual([record.key, record.owner, record.reason], ['repo:a', 'task-1', 'EXPIRED']);
  assert.ok(Date.parse(record.expiredAt) < Date.now() && Date.parse(record.releasedAt) >= Date.parse(record.expiredAt));
  assert.ok(!JSON.stringify(record).includes('token-value'), 'metadata is never copied into the record');
  assert.deepEqual(manager.list().map((lock) => lock.key), ['repo:b']);

  const reloaded = new LockManager(path.join(base, 'locks'));
  await reloaded.init();
  assert.deepEqual(reloaded.state.released.map((item) => [item.key, item.owner, item.reason]), [['repo:a', 'task-1', 'EXPIRED']], 'the reason is persisted, not only returned');
  assert.deepEqual([...(await reloaded.recover())], [], 'a second recovery releases nothing and records nothing new');
  assert.equal(reloaded.state.released.length, 1);
});

test('G11-4 the Control Plane journals each released lock with its owner and reason', async (t) => {
  const base = await makeBase('aecp-lock-event-');
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({}) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  await cp.locks.acquire('worktree:x', 'task-9');
  await expire(cp.locks, 'worktree:x');
  await cp.schedulerTick();
  const events = await waitFor(async () => (await cp.listEvents(500)).filter((event) => event.type === 'maintenance.gc' && event.releasedLocks), { label: 'the lock release event' });
  assert.deepEqual(events[0].releasedLocks.map((item) => [item.key, item.owner, item.reason]), [['worktree:x', 'task-9', 'EXPIRED']]);
  assert.match(await fs.readFile(path.join(base, 'runtime', 'events.jsonl'), 'utf8'), /"reason":"EXPIRED"/);
});
