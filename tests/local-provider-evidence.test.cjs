'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { MODES, NOTICE, classifyFailure, parseOllamaList, readSecret, workersRoot, runLocalEvidence } = require('../electron/lib/local-provider-evidence.cjs');
const { PEGA_ENV_KEY } = require('../electron/lib/pega-provider.cjs');

const KEY = 'sk-live-LOCAL-EVIDENCE-SECRET-0123456789';
const OLLAMA_TABLE = ['NAME ID SIZE MODIFIED', 'qwen3:4b-instruct   abc   2.5 GB   3 weeks ago', 'llama3.2:3b   def   2 GB   4 weeks ago', '$(calc)   ghi   1 GB   now', '-bad   jkl   1 GB   now'].join(String.fromCharCode(10));
const PASSING = { schema: 'aecp.provider-environment-evidence/v1', summary: { requested: 2, passed: 2, failed: 0 }, checks: [{ id: 'x.health', status: 'PASS' }, { id: 'x.smoke', status: 'PASS' }] };

function harness({ answers = [], secret = KEY, evidence = PASSING, verifyCode = 0, verifyStderr = '', verifyStdout = '', diagnose = null } = {}) {
  const log = { printed: [], asked: [], secretAsked: 0, verifyEnvs: [], diagnoseCalls: [], files: {}, order: [] };
  const queue = [...answers];
  const io = {
    print: (line) => { log.printed.push(line); log.order.push('print:' + line); },
    ask: async (question) => { log.asked.push(question); log.order.push('ask'); return queue.shift() ?? ''; },
    askSecret: async () => { log.secretAsked++; log.order.push('secret'); return secret; }
  };
  const deps = {
    now: () => new Date('2026-09-26T10:00:00Z'),
    rootDir: () => '/repo',
    artifactsDir: () => path.join('/repo', 'artifacts'),
    workersRoot: () => '/appdata/ai-engineering-control-plane/workers',
    tempWorkersRoot: () => '/tmp/aiecp-evidence-workers',
    listOllama: async () => OLLAMA_TABLE,
    spawnVerify: async (env) => { log.verifyEnvs.push(env); return { code: verifyCode, stdout: verifyStdout, stderr: verifyStderr, timedOut: false }; },
    readEvidence: async () => { if (!evidence) throw new Error('missing'); return evidence; },
    writeFile: async (file, content) => { log.files[path.basename(file)] = content; },
    diagnose: async (call) => { log.diagnoseCalls.push(call); return diagnose ? diagnose(call) : null; }
  };
  return { io, deps, log };
}
const summaryOf = (log) => JSON.parse(Object.entries(log.files).find(([name]) => !name.endsWith('.verifier.json'))[1]);

test('B0020 there are exactly three fixed modes, each mapped to a verifier mode, and anything else is refused before anything runs', async () => {
  assert.deepEqual(Object.keys(MODES).sort(), ['official', 'ollama', 'pega']);
  assert.deepEqual(Object.fromEntries(Object.entries(MODES).map(([name, spec]) => [name, spec.verifyMode])), { ollama: 'ollama', pega: 'codex-pega', official: 'codex-official' });
  for (const mode of ['all', 'rm -rf /', '', undefined, null, '__proto__', 'constructor', 'toString', 'pega ', 'PEGA', 'ollama;calc', 'opencode-ollama', 'local-command']) {
    const { io, deps, log } = harness();
    await assert.rejects(() => runLocalEvidence({ mode, io, deps }), (error) => error.code === 'USAGE', String(mode));
    assert.equal(log.verifyEnvs.length, 0, 'the verifier was never started');
    assert.equal(log.secretAsked, 0);
  }
});

test('B0020 ollama: the owner picks one of the installed models from a filtered list and only fixed variables reach the verifier', async () => {
  const { io, deps, log } = harness({ answers: ['2'] });
  const result = await runLocalEvidence({ mode: 'ollama', io, deps });
  assert.equal(result.passed, true);
  const listed = log.printed.filter((line) => /^\s+\d+\./.test(line)).map((line) => line.trim());
  assert.deepEqual(listed, ['1. qwen3:4b-instruct', '2. llama3.2:3b'], 'names that are not model names are filtered out');
  assert.deepEqual(Object.keys(log.verifyEnvs[0]).sort(), ['AECP_PROVIDER_EVIDENCE_PATH', 'AECP_PROVIDER_VERIFY_MODE', 'AECP_PROVIDER_VERIFY_MODEL', 'AECP_PROVIDER_VERIFY_TIMEOUT_MS']);
  assert.equal(log.verifyEnvs[0].AECP_PROVIDER_VERIFY_MODE, 'ollama');
  assert.equal(log.verifyEnvs[0].AECP_PROVIDER_VERIFY_MODEL, 'llama3.2:3b');
  assert.deepEqual(parseOllamaList(OLLAMA_TABLE), ['qwen3:4b-instruct', 'llama3.2:3b']);
  for (const bad of ['0', '3', 'x', '', '1; calc', '-1']) {
    const other = harness({ answers: [bad] });
    await assert.rejects(() => runLocalEvidence({ mode: 'ollama', io: other.io, deps: other.deps }), (error) => error.code === 'BAD_CHOICE', bad);
    assert.equal(other.log.verifyEnvs.length, 0);
  }
});

test('B0020 pega: the key is announced as memory-only, read without echo, and appears in no output, file or argument', async () => {
  const { io, deps, log } = harness({ answers: ['Pega-Coding'] });
  const result = await runLocalEvidence({ mode: 'pega', io, deps });
  assert.equal(result.passed, true);
  const announced = log.order.findIndex((entry) => entry.startsWith('print:') && entry.includes('金鑰只存在這次執行的記憶體'));
  assert.ok(announced > -1 && announced < log.order.indexOf('secret'), 'the promise is made before the key is asked for');
  assert.equal(log.secretAsked, 1);
  assert.deepEqual(Object.keys(log.verifyEnvs[0]).sort(), ['AECP_PROVIDER_EVIDENCE_PATH', 'AECP_PROVIDER_VERIFY_CODEX_ROOT', 'AECP_PROVIDER_VERIFY_MODE', 'AECP_PROVIDER_VERIFY_PEGA_MODEL', 'AECP_PROVIDER_VERIFY_TIMEOUT_MS', PEGA_ENV_KEY].sort());
  assert.equal(log.verifyEnvs[0][PEGA_ENV_KEY], KEY, 'the key travels only in the verifier process environment');
  assert.equal(log.verifyEnvs[0].AECP_PROVIDER_VERIFY_CODEX_ROOT, '/tmp/aiecp-evidence-workers', 'PEGA uses a scratch workers folder, not the owner\'s real one');
  const everything = JSON.stringify({ printed: log.printed, asked: log.asked, files: log.files, summary: result.summary });
  assert.ok(!everything.includes(KEY) && !everything.includes('SECRET-0123456789'), 'the key is nowhere in what was printed or written');
  assert.equal(result.summary.model, 'Pega-Coding');
});

test('B0020 pega: a bad model name or an empty key stops before the verifier runs', async () => {
  for (const [answers, secret, code] of [[['bad model'], KEY, 'BAD_MODEL'], [['-x'], KEY, 'BAD_MODEL'], [[''], KEY, 'BAD_MODEL'], [['Pega-Coding'], '', 'NO_KEY']]) {
    const { io, deps, log } = harness({ answers, secret });
    await assert.rejects(() => runLocalEvidence({ mode: 'pega', io, deps }), (error) => error.code === code, code);
    assert.equal(log.verifyEnvs.length, 0);
  }
});

test('B0020 official: it uses the AIECP workers folder with the signed-in account and asks for no key', async () => {
  const { io, deps, log } = harness();
  await runLocalEvidence({ mode: 'official', io, deps });
  assert.equal(log.secretAsked, 0);
  assert.deepEqual(Object.keys(log.verifyEnvs[0]).sort(), ['AECP_PROVIDER_EVIDENCE_PATH', 'AECP_PROVIDER_VERIFY_CODEX_ROOT', 'AECP_PROVIDER_VERIFY_MODE', 'AECP_PROVIDER_VERIFY_TIMEOUT_MS']);
  assert.equal(log.verifyEnvs[0].AECP_PROVIDER_VERIFY_MODE, 'codex-official');
  assert.equal(log.verifyEnvs[0].AECP_PROVIDER_VERIFY_CODEX_ROOT, '/appdata/ai-engineering-control-plane/workers');
  assert.equal(workersRoot({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32'), path.join('C:\\Users\\u\\AppData\\Roaming', 'ai-engineering-control-plane', 'workers'));
});

test('B0020 the result says in words that it passed, and is marked as local evidence that never touches the matrix', async () => {
  const { io, deps, log } = harness({ answers: ['1'] });
  const result = await runLocalEvidence({ mode: 'ollama', io, deps });
  assert.ok(log.printed.some((line) => line.startsWith('結論：通過')));
  assert.ok(log.printed.filter((line) => line === NOTICE).length >= 2, 'the notice is shown at the start and at the end');
  const summary = summaryOf(log);
  assert.equal(summary.schema, 'aecp.local-provider-evidence/v1');
  assert.equal(summary.localOnly, true);
  assert.equal(summary.notRunnerEvidence, true);
  assert.equal(summary.touchesMatrix, false);
  assert.equal(summary.passed, true);
  assert.equal(summary.reason, null);
  assert.equal(result.summary.mode, 'ollama');
});

test('B0020 a failure is explained in plain words with a reason category, not just counts', async () => {
  const cases = [
    { label: '額度用完', diagnose: () => ({ stderr: 'ERROR: You\'ve hit your usage limit. Try again at Sep 29th, 2026 6:20 PM.', stdout: '', code: 1 }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'codex-official.real-smoke', status: 'FAIL', error: { code: 'CODEX_codex-official_SMOKE_FAILED' } }] }, detail: /Try again at Sep 29th/ },
    { label: '找不到 Codex', diagnose: () => ({ stderr: 'spawn codex ENOENT', stdout: '', code: -1 }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'ENOENT' } }] } },
    { label: '沙盒拒絕寫入', diagnose: () => ({ stderr: 'sandbox: Access is denied. (os error 5)', stdout: '', code: 1 }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'CODEX_codex-pega_EDIT_FAILED' } }] } },
    { label: '檔案沒有被建立', diagnose: () => null, evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'FILE_VERIFY_MISMATCH' } }] } },
    { label: '逾時', diagnose: () => ({ stderr: '', stdout: '', code: -1, timedOut: true }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'ERROR' } }] } },
    { label: '尚未登入或金鑰無效', diagnose: () => ({ stderr: 'Codex OFFICIAL isolated CODEX_HOME requires authentication.', stdout: '', code: 1 }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'OFFICIAL_AUTH_REQUIRED' } }] } },
    { label: '其他原因（請看證據檔）', diagnose: () => ({ stderr: 'something nobody predicted', stdout: '', code: 1 }), evidence: { summary: { requested: 1, failed: 1 }, checks: [{ id: 'c', status: 'FAIL', error: { code: 'WEIRD' } }] } }
  ];
  for (const scenario of cases) {
    const { io, deps, log } = harness({ evidence: scenario.evidence, verifyCode: 1, diagnose: scenario.diagnose });
    const result = await runLocalEvidence({ mode: 'official', io, deps });
    assert.equal(result.passed, false, scenario.label);
    assert.equal(result.reason.label, scenario.label);
    const conclusion = log.printed.find((line) => line.startsWith('結論：失敗'));
    assert.ok(conclusion && conclusion.includes(scenario.label), `${scenario.label}: the conclusion names the reason`);
    if (scenario.detail) assert.match(conclusion, scenario.detail, 'the tool\'s own message is kept');
    assert.equal(summaryOf(log).passed, false);
    assert.equal(summaryOf(log).reason.label, scenario.label);
    assert.equal(log.diagnoseCalls.length, 1, 'one fixed diagnostic call reads the real message');
    assert.equal(log.diagnoseCalls[0].prompt, 'Reply with one short greeting sentence.');
  }
});

test('B0020 a verifier that died without writing evidence is a failure, and no evidence at all is never read as a pass', async () => {
  const { io, deps, log } = harness({ evidence: null, verifyCode: 1, verifyStderr: 'spawn codex ENOENT' });
  const result = await runLocalEvidence({ mode: 'official', io, deps });
  assert.equal(result.passed, false);
  assert.equal(result.reason.id, 'CODEX_NOT_FOUND');
  const zero = harness({ evidence: { summary: { requested: 0, failed: 0 }, checks: [] } });
  assert.equal((await runLocalEvidence({ mode: 'official', io: zero.io, deps: zero.deps })).passed, false, 'zero checks proves nothing');
  const exit = harness({ evidence: PASSING, verifyCode: 1 });
  assert.equal((await runLocalEvidence({ mode: 'official', io: exit.io, deps: exit.deps })).passed, false, 'a non-zero exit is not a pass');
});

test('B0020 classification: quota wins over generic words and known reasons are recognised', () => {
  assert.equal(classifyFailure({ text: 'rate limit exceeded, you exceeded your current quota' }).id, 'QUOTA');
  assert.equal(classifyFailure({ text: 'x', timedOut: true }).id, 'TIMEOUT');
  assert.equal(classifyFailure({ codes: ['PEGA_AUTH_REQUIRED'] }).id, 'AUTH');
  assert.equal(classifyFailure({ text: 'HTTP 401 Unauthorized' }).id, 'AUTH');
  assert.equal(classifyFailure({ text: 'connect ECONNREFUSED 127.0.0.1:11434' }).id, 'NETWORK');
  assert.equal(classifyFailure({ text: 'model "nope" not found' }).id, 'MODEL');
  assert.equal(classifyFailure({}).id, 'OTHER');
});

test('B0020 the key prompt does not echo, supports backspace and cancels with Ctrl-C', async () => {
  const modes = [];
  const stdin = new PassThrough();
  stdin.setRawMode = (on) => { modes.push(on); stdin.isRaw = on; };
  const written = [];
  const stdout = { write: (text) => written.push(String(text)) };
  const bounded = Promise.race([readSecret({ stdin, stdout, prompt: 'key: ' }), new Promise((_, reject) => setTimeout(() => reject(new Error('readSecret did not resolve on Enter')), 2000))]);
  stdin.write('sec');
  stdin.write(String.fromCharCode(127));
  stdin.write('ret' + String.fromCharCode(13));
  assert.equal(await bounded, 'seret', 'Backspace removed the c');
  assert.equal(written.join(''), 'key: ' + String.fromCharCode(10), 'only the prompt and a newline were printed, never the typed characters');
  assert.deepEqual(modes, [true, false], 'raw mode is switched on and restored');
  const second = new PassThrough();
  second.setRawMode = () => {};
  const boundedCancel = Promise.race([readSecret({ stdin: second, stdout: { write: () => {} } }), new Promise((_, reject) => setTimeout(() => reject(new Error('readSecret did not reject on Ctrl-C')), 2000))]);
  second.write(String.fromCharCode(3));
  await assert.rejects(() => boundedCancel, (error) => error.code === 'CANCELLED');
});
