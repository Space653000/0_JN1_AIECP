'use strict';

// Automated reviewer gate. It re-does what the human-in-the-loop review checked by hand:
//   1. scope      - only allowed paths changed since <base>
//   2. audit      - traceability audit passes in strict mode
//   3. evidence   - every newly IMPLEMENTED clause cites a test that really loads product code
//   4. sabotage   - every newly IMPLEMENTED clause is covered by a recorded sabotage entry, and the gate
//                   REPLAYS each entry itself; a test that still passes with the behavior broken fails the gate
//   5. sync       - working tree clean and HEAD equal to origin
//   6. ci         - GitHub Actions for HEAD: AECP Security and AECP CI succeeded (with --ci)
//
//   node scripts/review-gate.cjs --base <sha> --mode tests|fix [--ci] [--skip-replay]
//
// Sabotage log: .ai/sabotage-log.jsonl, one JSON object per line:
//   {"ids":["B04-L11"],"file":"electron/lib/x.cjs","from":"exact text","to":"replacement","tests":["tests/x.test.cjs"]}
// Exit code 0 = accepted, 1 = rejected (reasons printed), 2 = the gate could not run.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sabotage } = require('./sabotage-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const NEVER = [/^Blueprint\//, /^\.github\//, /^\.ai\/ACCEPTANCE\.md$/, /^package-lock\.json$/];
const TESTS_MODE_ALLOWED = [/^tests\//, /^\.ai\//, /^scripts\/(sabotage-check|review-gate|traceability-audit)\.cjs$/, /^package\.json$/];
// docs/ and README.md are user-facing documentation the owner has asked work orders to add or update
// (e.g. work order 0020's Traditional Chinese user manual); they carry no executable behavior.
const FIX_MODE_ALLOWED = [...TESTS_MODE_ALLOWED, /^electron\//, /^ui\//, /^docs\//, /^README\.md$/];

function disallowedFiles(files, mode) {
  const allowed = mode === 'fix' ? FIX_MODE_ALLOWED : TESTS_MODE_ALLOWED;
  return files.filter((file) => NEVER.some((re) => re.test(file)) || !allowed.some((re) => re.test(file)));
}

// A test that never loads product code cannot prove product behavior.
function loadsProductCode(text) {
  return /(?:require|import)\(\s*['"`]\.\.\/(?:electron|ui)\//.test(text)
    || /(?:require|import)\(\s*['"`]\.\/support\//.test(text)
    || /(?:require|import)\(\s*['"`]\.\.\/scripts\//.test(text)
    || /fake-electron-main|e2e-fixtures/.test(text);
}

function newlyImplemented(before, after) {
  const was = new Map((before?.items || []).map((item) => [item.id, item.status]));
  return (after?.items || []).filter((item) => item.status === 'IMPLEMENTED' && was.get(item.id) !== 'IMPLEMENTED');
}

function parseLog(text) {
  return String(text || '').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`sabotage log line ${index + 1} is not valid JSON`); }
  });
}

function run(cmd, args, options = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npm', env, ...options });
}
const git = (...args) => run('git', args);

function gitShowJson(ref, file) {
  const result = git('show', `${ref}:${file}`);
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

function checkScope(base, mode, problems) {
  const files = git('diff', '--name-only', `${base}..HEAD`).stdout.split(/\r?\n/).filter(Boolean);
  const bad = disallowedFiles(files, mode);
  if (bad.length) problems.push(`scope: files not allowed in "${mode}" mode: ${bad.join(', ')}`);
  return files;
}

function checkAudit(problems) {
  const result = run('node', ['scripts/traceability-audit.cjs', '--strict']);
  if (result.status !== 0) problems.push('audit: traceability-audit --strict failed');
}

function checkEvidence(fresh, problems) {
  for (const item of fresh) {
    const tests = (item.evidence || []).filter((entry) => entry.kind === 'test');
    if (!tests.length) { problems.push(`evidence: ${item.id} is IMPLEMENTED without test evidence`); continue; }
    const real = tests.some((entry) => {
      const file = path.join(ROOT, entry.file);
      return fs.existsSync(file) && loadsProductCode(fs.readFileSync(file, 'utf8'));
    });
    if (!real) problems.push(`evidence: ${item.id} cites only tests that never load product code (electron/, ui/, support helpers)`);
  }
}

function checkSabotage(base, fresh, skipReplay, problems) {
  const before = new Set(parseLog(git('show', `${base}:.ai/sabotage-log.jsonl`).stdout || ''));
  const all = fs.existsSync(path.join(ROOT, '.ai/sabotage-log.jsonl'))
    ? parseLog(fs.readFileSync(path.join(ROOT, '.ai/sabotage-log.jsonl'), 'utf8')) : [];
  const oldCount = parseLog(git('show', `${base}:.ai/sabotage-log.jsonl`).stdout || '').length;
  const entries = all.slice(oldCount);
  void before;
  const covered = new Set(entries.flatMap((entry) => entry.ids || []));
  for (const item of fresh) if (!covered.has(item.id)) problems.push(`sabotage: no recorded sabotage entry covers ${item.id}`);
  for (const [index, entry] of entries.entries()) {
    if (!Array.isArray(entry.ids) || !entry.ids.length || typeof entry.file !== 'string' || typeof entry.from !== 'string'
      || typeof entry.to !== 'string' || !Array.isArray(entry.tests) || !entry.tests.length) {
      problems.push(`sabotage: entry ${index + 1} is malformed`); continue;
    }
    if (!(/^(electron|ui|scripts)\//.test(entry.file) || entry.file === 'package.json') || /^scripts\/(review-gate|sabotage-check)\.cjs$/.test(entry.file)) { problems.push(`sabotage: entry ${index + 1} breaks ${entry.file}; it must break product code (electron/, ui/ or product scripts/)`); continue; }
    if (skipReplay) continue;
    const outcome = sabotage({ root: ROOT, file: entry.file, from: entry.from, to: entry.to, tests: entry.tests });
    if (outcome.status !== 0) problems.push(`sabotage: entry ${index + 1} (${entry.ids.join(', ')}) ${outcome.status === 1 ? 'NOT DETECTED - the tests still pass with the behavior broken' : 'could not run: ' + outcome.reason}`);
    if (git('status', '--porcelain', '--', entry.file).stdout.trim()) problems.push(`sabotage: entry ${index + 1} left ${entry.file} modified`);
  }
  return entries.length;
}

function checkSync(problems) {
  if (git('status', '--porcelain').stdout.trim()) problems.push('sync: working tree is not clean');
  git('fetch', 'origin', '--quiet');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const remote = git('rev-parse', `origin/${branch}`).stdout.trim();
  if (head !== remote) problems.push(`sync: HEAD ${head.slice(0, 7)} is not pushed (origin/${branch} is ${remote.slice(0, 7)})`);
  return head;
}

function checkCi(head, problems, waitMs = 25 * 60 * 1000) {
  const started = Date.now();
  for (;;) {
    const result = run('gh', ['run', 'list', '--commit', head, '--json', 'name,status,conclusion']);
    if (result.status !== 0) { problems.push('ci: gh run list failed'); return; }
    const runs = JSON.parse(result.stdout || '[]');
    const need = ['AECP Security', 'AECP CI'];
    const find = (name) => runs.find((entry) => entry.name === name);
    const state = need.map((name) => find(name));
    if (state.every((entry) => entry && entry.status === 'completed')) {
      for (const [i, entry] of state.entries()) if (entry.conclusion !== 'success') problems.push(`ci: ${need[i]} concluded ${entry.conclusion} on ${head.slice(0, 7)}`);
      return;
    }
    if (Date.now() - started > waitMs) { problems.push('ci: timed out waiting for AECP Security and AECP CI'); return; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000);
  }
}

function main(argv) {
  const opt = { base: null, mode: 'tests', ci: false, skipReplay: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opt.base = argv[++i];
    else if (argv[i] === '--mode') opt.mode = argv[++i];
    else if (argv[i] === '--ci') opt.ci = true;
    else if (argv[i] === '--skip-replay') opt.skipReplay = true;
  }
  if (!opt.base || !['tests', 'fix'].includes(opt.mode) || git('rev-parse', '--verify', opt.base).status !== 0) {
    process.stderr.write('usage: node scripts/review-gate.cjs --base <sha> --mode tests|fix [--ci] [--skip-replay]\n');
    return 2;
  }
  const problems = [];
  checkScope(opt.base, opt.mode, problems);
  checkAudit(problems);
  const before = gitShowJson(opt.base, '.ai/TRACEABILITY.json');
  const after = JSON.parse(fs.readFileSync(path.join(ROOT, '.ai/TRACEABILITY.json'), 'utf8'));
  const fresh = newlyImplemented(before, after);
  checkEvidence(fresh, problems);
  const replayed = checkSabotage(opt.base, fresh, opt.skipReplay, problems);
  const head = checkSync(problems);
  if (opt.ci) checkCi(head, problems);
  process.stdout.write(`gate: ${fresh.length} newly IMPLEMENTED clause(s), ${replayed} sabotage entr${replayed === 1 ? 'y' : 'ies'} replayed, head ${head.slice(0, 7)}\n`);
  if (problems.length) { process.stdout.write(`REJECTED\n${problems.map((p) => `- ${p}`).join('\n')}\n`); return 1; }
  process.stdout.write('ACCEPTED\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { disallowedFiles, loadsProductCode, newlyImplemented, parseLog };
