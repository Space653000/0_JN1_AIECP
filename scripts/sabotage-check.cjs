'use strict';

// Mutation check helper: temporarily breaks one exact piece of source text, runs the given tests and
// expects them to FAIL, then always restores the file. A test that still passes does not prove the behavior.
//
//   node scripts/sabotage-check.cjs <file> <exact text to break> <replacement> <test file> [<test file> ...]
//
// Use an empty replacement ("") to delete the text. Exit code 0 = the tests noticed the break (good),
// 1 = the tests still passed (the evidence is too weak), 2 = the check could not run.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function sabotage({ root, file, from, to, tests }) {
  const target = path.resolve(root, file);
  if (!target.startsWith(path.resolve(root) + path.sep)) return { status: 2, reason: 'target is outside the repository' };
  if (!fs.existsSync(target)) return { status: 2, reason: 'target file does not exist' };
  const original = fs.readFileSync(target, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const needle = from.replace(/\r?\n/g, eol);
  const count = original.split(needle).length - 1;
  if (count !== 1) return { status: 2, reason: `the text must match exactly once, it matched ${count} times` };
  if (!tests.length) return { status: 2, reason: 'no test files given' };
  fs.writeFileSync(target, original.replace(needle, to.replace(/\r?\n/g, eol)));
  let result;
  try {
    // When this helper itself runs inside `node --test`, the child would inherit the test-runner context and
    // stop printing a failure summary, so the variable is removed.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    result = spawnSync('npm', ['exec', '--', 'node', '--test', ...tests], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', env });
  } finally {
    fs.writeFileSync(target, original);
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) return { status: 2, reason: String(result.error.message || result.error) };
  const failed = /# fail [1-9]/.test(output) || /ℹ fail [1-9]/.test(output);
  return failed ? { status: 0, reason: 'DETECTED: the tests failed with the behavior broken' }
    : { status: 1, reason: 'NOT DETECTED: the tests still pass with the behavior broken' };
}

function main(argv) {
  const [file, from, to, ...tests] = argv;
  if (!file || from === undefined || to === undefined || !tests.length) {
    process.stderr.write('usage: node scripts/sabotage-check.cjs <file> <exact text> <replacement> <test file> [...]\n');
    return 2;
  }
  const outcome = sabotage({ root: path.resolve(__dirname, '..'), file, from, to, tests });
  process.stdout.write(`${outcome.reason}\n`);
  return outcome.status;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { sabotage };
