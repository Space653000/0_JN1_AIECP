'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isWithinRoot, assertWithinRoot } = require('../electron/lib/path-safety.cjs');

test('accepts Workspace root itself', () => {
  const root = path.resolve('tmp', 'workspace');
  assert.equal(isWithinRoot(root, root), true);
});

test('accepts child path', () => {
  const root = path.resolve('tmp', 'workspace');
  assert.equal(isWithinRoot(root, path.join(root, 'src', 'app.js')), true);
});

test('rejects sibling/outside path', () => {
  const root = path.resolve('tmp', 'workspace');
  const outside = path.resolve('tmp', 'other');
  assert.equal(isWithinRoot(root, outside), false);
  assert.throws(() => assertWithinRoot(root, outside), /outside the active Workspace/);
});


test('canonicalizes Windows traversal even when tests run on a non-Windows host', () => {
  const root = 'C:\\work';
  assert.equal(isWithinRoot(root, 'C:\\work\\src\\app.js'), true);
  assert.equal(isWithinRoot(root, 'C:\\work\\..\\outside\\secret.txt'), false);
  assert.equal(isWithinRoot(root, 'C:\\work-evil\\secret.txt'), false);
});

test('canonical Windows path comparison is case-insensitive', () => {
  assert.equal(isWithinRoot('C:\\Work', 'c:\\work\\src\\app.js'), true);
});
