'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackup } = require('../electron/lib/backup-manager.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-backup-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state.json'), '{"ok":true}');
  fs.writeFileSync(path.join(root, 'runtime', 'control-plane.json'), '{"tasks":[]}');
  return root;
}

test('a backup taken while a store is being rewritten does not include the half-written temp file', async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'runtime', 'control-plane.json.tmp-2848-7'), '{"tasks":[');
  fs.writeFileSync(path.join(root, 'runtime', 'worker.json.tmp-2848-deadbeef'), '{"half":');
  const backup = await createBackup(root, { appVersion: 'test' });
  assert.deepEqual(backup.files.map((file) => file.path).sort(), ['runtime/control-plane.json', 'state.json']);
});

test('a file that is renamed away between listing and reading does not fail the whole backup', async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'runtime', 'vanishes.json'), '{}');
  const realReadFile = fsp.readFile;
  fsp.readFile = async function readFile(target, ...rest) {
    if (String(target).endsWith('vanishes.json')) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    return realReadFile.call(this, target, ...rest);
  };
  t.after(() => { fsp.readFile = realReadFile; });
  const backup = await createBackup(root, { appVersion: 'test' });
  assert.deepEqual(backup.files.map((file) => file.path).sort(), ['runtime/control-plane.json', 'state.json']);
});

test('other read failures are still reported instead of being swallowed', async (t) => {
  const root = fixture(t);
  const realReadFile = fsp.readFile;
  fsp.readFile = async function readFile(target, ...rest) {
    if (String(target).endsWith('control-plane.json')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return realReadFile.call(this, target, ...rest);
  };
  t.after(() => { fsp.readFile = realReadFile; });
  await assert.rejects(() => createBackup(root, { appVersion: 'test' }), /EACCES/);
});
