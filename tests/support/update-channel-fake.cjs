'use strict';

// A scripted GitHub release channel for the real electron/main.cjs update flow.
// Call install() BEFORE loading main.cjs: main destructures execFile/spawn from child_process at load time.
// `gh` is answered locally (list/view/download/auth); the installer that would be launched is only recorded.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'Space653000/0_JN1_AIECP';
const NAME = (version, arch) => `AI-Engineering-Control-Plane-Setup-${arch}-${version}.exe`;

function install({ mode = 'good', latest = '9.9.9', current = '0.0.0-test', universal = false, authenticated = true } = {}) {
  const record = { execFile: [], gh: [], spawned: [], terminals: [], ghRepos: new Set() };
  const options = { mode, latest, current, universal, authenticated };
  const realExecFile = cp.execFile;
  const realSpawn = cp.spawn;
  const installerBytes = (tag) => Buffer.from(`fake installer for ${tag}\n`.repeat(20));
  const assetsFor = (version) => [
    ...(options.universal ? [{ name: `AI-Engineering-Control-Plane-Setup-${version}.exe` }] : []),
    { name: NAME(version, 'x64') }, { name: NAME(version, 'arm64') }, { name: 'SHA256SUMS.txt' }
  ];

  function gh(args) {
    record.gh.push(args);
    const repoAt = args.indexOf('--repo');
    if (repoAt >= 0) record.ghRepos.add(args[repoAt + 1]);
    if (args[0] === '--version') return 'gh version 2.99.0';
    if (args[0] === 'auth') { if (!options.authenticated) throw new Error('You are not logged into any GitHub hosts.'); return 'Logged in to github.com'; }
    if (args[0] === 'release' && args[1] === 'list') return JSON.stringify([
      { tagName: `v${options.current}`, name: 'current', isPrerelease: false, publishedAt: '2026-01-01T00:00:00Z' },
      { tagName: `v${options.latest}`, name: 'latest', isPrerelease: false, publishedAt: '2026-09-01T00:00:00Z' }
    ]);
    if (args[0] === 'release' && args[1] === 'view') {
      const tag = args[2];
      return JSON.stringify({ tagName: tag, name: tag, isPrerelease: false, publishedAt: '2026-09-01T00:00:00Z', url: `https://github.com/${REPO}/releases/tag/${tag}`, assets: assetsFor(tag.replace(/^v/, '')) });
    }
    if (args[0] === 'release' && args[1] === 'download') {
      const tag = args[2];
      const dir = args[args.indexOf('--dir') + 1];
      const version = tag.replace(/^v/, '');
      const patterns = args.flatMap((value, index) => (value === '--pattern' ? [args[index + 1]] : []));
      const asset = patterns.find((name) => name !== 'SHA256SUMS.txt');
      fs.mkdirSync(dir, { recursive: true });
      const bytes = installerBytes(tag);
      fs.writeFileSync(path.join(dir, asset), bytes);
      let digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (options.mode === 'tampered' && tag === `v${options.latest}`) digest = digest.replace(/^./, (c) => (c === '0' ? '1' : '0'));
      const sums = options.mode === 'no-entry' && tag === `v${options.latest}` ? `${digest}  some-other-file.exe\n` : `${digest}  ${asset}\n`;
      fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), sums);
      void version;
      return '';
    }
    throw new Error(`fake gh does not implement: ${args.join(' ')}`);
  }

  cp.execFile = function execFile(command, args, opts, callback) {
    record.execFile.push({ command, args: [...(args || [])] });
    if (command === 'gh') {
      let out;
      try { out = gh(args); } catch (error) { process.nextTick(() => callback(Object.assign(error, { stdout: '', stderr: error.message }), '', error.message)); return { kill() {} }; }
      process.nextTick(() => callback(null, out, ''));
      return { kill() {} };
    }
    return realExecFile.apply(this, arguments);
  };
  cp.spawn = function spawn(command, args, opts, ...rest) {
    if (typeof command === 'string' && /\.exe$/i.test(command) && command.replace(/\\/g, '/').includes('/updates/')) {
      record.spawned.push({ command, args: [...(args || [])] });
      return { unref() {}, on() {}, kill() {} };
    }
    if (typeof command === 'string' && /^(?:pwsh|powershell)(?:.exe)?$/i.test(command)) {
      record.terminals.push({ command, args: [...(args || [])] });
      return { unref() {}, on() {}, kill() {} };
    }
    return realSpawn.call(this, command, args, opts, ...rest);
  };
  return { record, options, restore() { cp.execFile = realExecFile; cp.spawn = realSpawn; }, REPO };
}

module.exports = { install, REPO, NAME };
