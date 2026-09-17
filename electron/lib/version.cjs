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

function selectHighestRelease(releases) {
  const valid = (Array.isArray(releases) ? releases : [])
    .map((item) => ({ ...item, version: versionFromTag(item?.tagName) }))
    .filter((item) => item.version);
  valid.sort((a, b) => compareVersions(b.version, a.version));
  return valid[0] || null;
}

function selectInstallerAsset(assets, version, arch) {
  const names = new Set((Array.isArray(assets) ? assets : []).map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean));
  const primary = `AI-Engineering-Control-Plane-Setup-${version}.exe`;
  const normalizedArch = arch === 'arm64' ? 'arm64' : 'x64';
  const fallback = `AI-Engineering-Control-Plane-Setup-${normalizedArch}-${version}.exe`;
  if (names.has(primary)) return primary;
  if (names.has(fallback)) return fallback;
  return null;
}

module.exports = { normalizeVersion, parseVersion, compareVersions, versionFromTag, selectHighestRelease, selectInstallerAsset };
