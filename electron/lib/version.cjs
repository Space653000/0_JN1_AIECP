'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid semantic version.');
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function versionFromTag(tag) {
  const normalized = normalizeVersion(tag);
  return parseVersion(normalized) ? normalized : null;
}

module.exports = { normalizeVersion, parseVersion, compareVersions, versionFromTag };
