'use strict';

const path = require('node:path');

function canonicalForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(root, candidate) {
  const base = canonicalForCompare(root);
  const target = canonicalForCompare(candidate);
  if (base === target) return true;
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertWithinRoot(root, candidate) {
  if (!isWithinRoot(root, candidate)) throw new Error('Requested path is outside the active Workspace.');
  return path.resolve(candidate);
}

module.exports = { canonicalForCompare, isWithinRoot, assertWithinRoot };
