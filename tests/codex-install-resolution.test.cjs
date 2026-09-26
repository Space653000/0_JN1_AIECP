'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveKnownCommand, findOfficialCodexExe } = require('../electron/lib/command-resolver.cjs');

// A tiny fake Windows file system: paths are compared case-insensitively like NTFS.
const key = (value) => path.win32.normalize(String(value)).toLowerCase();
const LOCAL = 'C:\\Users\\u\\AppData\\Local';
const BASE = `${LOCAL}\\OpenAI\\Codex\\bin`;

function fakeFs(entries) {
  // entries: { path: { type: 'file'|'dir'|'link', mtime, real } }
  const map = new Map(Object.entries(entries).map(([p, v]) => [key(p), { path: p, ...v }]));
  const children = (dir) => [...map.values()].filter((item) => key(path.win32.dirname(item.path)) === key(dir) && key(item.path) !== key(dir));
  const dirent = (item) => ({ name: path.win32.basename(item.path), isDirectory: () => (item.direntAs || item.type) === 'dir', isSymbolicLink: () => (item.direntAs || item.type) === 'link', isFile: () => item.type === 'file' });
  return {
    readdir: (dir) => { const found = map.get(key(dir)); if (!found || found.type === 'file') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return children(dir).map(dirent); },
    lstat: (file) => { const item = map.get(key(file)); if (!item) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => item.type === 'file', isDirectory: () => item.type === 'dir', isSymbolicLink: () => item.type === 'link', mtimeMs: item.mtime || 0 }; },
    realpath: (file) => { const item = map.get(key(file)); if (!item) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return item.real || item.path; },
    exists: (file) => map.has(key(file))
  };
}

const install = (extra = {}) => ({
  [`${LOCAL}\\OpenAI`]: { type: 'dir' },
  [`${LOCAL}\\OpenAI\\Codex`]: { type: 'dir' },
  [BASE]: { type: 'dir' },
  [`${BASE}\\aaa111`]: { type: 'dir' },
  [`${BASE}\\aaa111\\rg.exe`]: { type: 'file', mtime: 5 },
  [`${BASE}\\bbb222`]: { type: 'dir' },
  [`${BASE}\\bbb222\\codex.exe`]: { type: 'file', mtime: 10 },
  ...extra
});
const resolve = (fs, over = {}) => resolveKnownCommand('codex', ['exec'], {
  platform: 'win32', env: { LOCALAPPDATA: LOCAL }, where: () => ['C:\\Users\\u\\bin\\codex.cmd'], exists: fs.exists,
  read: () => { throw new Error('unreadable'); }, execPath: 'C:\\node\\node.exe', readdir: fs.readdir, lstat: fs.lstat, realpath: fs.realpath, ...over
});

test('B0020 a codex.cmd wrapper on PATH is not launchable, so the official per-user install folder is used', () => {
  const fs = fakeFs(install());
  const result = resolve(fs);
  assert.equal(result.command, `${BASE}\\bbb222\\codex.exe`);
  assert.deepEqual(result.args, ['exec']);
  assert.equal(result.source, 'openai-codex-install');
});

test('B0020 only the folder that really holds codex.exe is chosen, never the one with only rg.exe', () => {
  const fs = fakeFs(install());
  assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: LOCAL }, ...fs }), `${BASE}\\bbb222\\codex.exe`);
});

test('B0020 with several installs the most recently modified codex.exe wins', () => {
  const fs = fakeFs(install({ [`${BASE}\\ccc333`]: { type: 'dir' }, [`${BASE}\\ccc333\\codex.exe`]: { type: 'file', mtime: 99 }, [`${BASE}\\ddd444`]: { type: 'dir' }, [`${BASE}\\ddd444\\codex.exe`]: { type: 'file', mtime: 3 } }));
  assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: LOCAL }, ...fs }), `${BASE}\\ccc333\\codex.exe`);
});

test('B0020 a native codex.exe found on PATH still wins over the install folder', () => {
  const onPath = 'C:\\Tools\\codex.exe';
  const fs = fakeFs(install({ [onPath]: { type: 'file' } }));
  const result = resolve(fs, { where: () => [onPath] });
  assert.equal(result.command, onPath);
  assert.equal(result.source, 'native');
});

test('B0020 links, folders pretending to be the file, look-alike names and paths outside the base are refused', () => {
  const refused = (extra, why) => {
    const fs = fakeFs({ [`${LOCAL}\\OpenAI`]: { type: 'dir' }, [`${LOCAL}\\OpenAI\\Codex`]: { type: 'dir' }, [BASE]: { type: 'dir' }, ...extra });
    assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: LOCAL }, ...fs }), null, why);
    const result = resolve(fs);
    assert.equal(result.source, 'unresolved', `${why}: falls back to the old, closed behaviour`);
    assert.equal(result.command, 'codex');
  };
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.exe`]: { type: 'link', real: 'C:\\Windows\\System32\\cmd.exe' } }, 'a symbolic link named codex.exe');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.exe`]: { type: 'dir' } }, 'a folder named codex.exe');
  refused({ [`${BASE}\\x`]: { type: 'link', real: 'C:\\Evil' }, [`${BASE}\\x\\codex.exe`]: { type: 'file' } }, 'a linked (junction) install folder');
  refused({ [`${BASE}\\x`]: { type: 'link', direntAs: 'dir', real: 'C:\\Evil' }, [`${BASE}\\x\\codex.exe`]: { type: 'file' } }, 'an install folder that the listing calls a folder but that is really a link');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.EXE.txt`]: { type: 'file' }, [`${BASE}\\x\\mycodex.exe`]: { type: 'file' }, [`${BASE}\\x\\codex.exe.bak`]: { type: 'file' } }, 'look-alike file names');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.exe`]: { type: 'file', real: 'C:\\Users\\u\\AppData\\Local\\OpenAI\\Codex\\binEVIL\\x\\codex.exe' } }, 'a real path that only shares the base name as a prefix');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.exe`]: { type: 'file', real: `${BASE}\\..\\evil\\codex.exe` } }, 'a real path that climbs out with ..');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\codex.exe`]: { type: 'file', real: 'D:\\elsewhere\\codex.exe' } }, 'a real path on another drive');
  refused({ [`${BASE}\\x`]: { type: 'dir' }, [`${BASE}\\x\\deeper`]: { type: 'dir' }, [`${BASE}\\x\\deeper\\codex.exe`]: { type: 'file' } }, 'a file two levels down: only direct child folders are looked at');
  refused({ [`${BASE}\\codex.exe`]: { type: 'file' } }, 'a file directly in the base rather than in a child folder');
});

test('B0020 a different letter case in the path is still the same folder on Windows', () => {
  const fs = fakeFs(install({ [`${BASE}\\bbb222\\codex.exe`]: { type: 'file', mtime: 10, real: `${LOCAL.toUpperCase()}\\OPENAI\\CODEX\\BIN\\bbb222\\codex.exe` } }));
  assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: LOCAL }, ...fs }), `${BASE}\\bbb222\\codex.exe`);
});

test('B0020 without a usable LOCALAPPDATA, or when nothing is installed, nothing is found', () => {
  const fs = fakeFs(install());
  for (const env of [{}, { LOCALAPPDATA: '' }, { LOCALAPPDATA: 'relative\\path' }]) assert.equal(findOfficialCodexExe({ env, ...fs }), null, JSON.stringify(env));
  assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: 'C:\\Nowhere' }, ...fs }), null);
  const relative = fakeFs({ 'relative\\OpenAI': { type: 'dir' }, 'relative\\OpenAI\\Codex': { type: 'dir' }, 'relative\\OpenAI\\Codex\\bin': { type: 'dir' }, 'relative\\OpenAI\\Codex\\bin\\h': { type: 'dir' }, 'relative\\OpenAI\\Codex\\bin\\h\\codex.exe': { type: 'file' } });
  assert.equal(findOfficialCodexExe({ env: { LOCALAPPDATA: 'relative' }, ...relative }), null, 'a relative base is never trusted, even if a matching tree exists');
});

test('B0020 it only ever applies to codex on Windows: other commands and other platforms behave exactly as before', () => {
  const fs = fakeFs(install());
  const other = resolveKnownCommand('claude', ['x'], { platform: 'win32', env: { LOCALAPPDATA: LOCAL }, where: () => [], exists: fs.exists, readdir: fs.readdir, lstat: fs.lstat, realpath: fs.realpath, execPath: 'C:\\n\\node.exe' });
  assert.equal(other.source, 'unresolved');
  for (const platform of ['linux', 'darwin']) {
    const result = resolveKnownCommand('codex', ['x'], { platform, env: { LOCALAPPDATA: LOCAL }, exists: fs.exists, readdir: fs.readdir, lstat: fs.lstat, realpath: fs.realpath });
    assert.deepEqual(result, { command: 'codex', args: ['x'], source: 'direct' }, platform);
  }
});
