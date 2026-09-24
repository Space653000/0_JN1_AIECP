'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const samePath = (a, b) => process.platform === 'win32'
  ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
  : path.normalize(a) === path.normalize(b);

// Only the packaged UI document may be navigated to (hash and query changes stay in the same document).
function isAllowedNavigation(url, uiIndexPath) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (parsed.protocol !== 'file:' || parsed.hostname !== '') return false;
  let target;
  try { target = fileURLToPath(parsed); } catch { return false; }
  return samePath(target, path.resolve(uiIndexPath));
}

module.exports = { isAllowedNavigation };
