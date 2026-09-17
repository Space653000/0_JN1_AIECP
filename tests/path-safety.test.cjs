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
