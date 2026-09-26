'use strict';

// One-line local provider evidence for the owner:  npm run evidence:local -- <ollama|pega|official>
//
// It maps three fixed modes onto the existing scripts/provider-environment-verify.cjs (fixed script, fixed environment
// variable names, no free-form command), asks only for what the mode needs, writes its result under artifacts/ and says
// in plain words whether it worked and why not. This is LOCAL run evidence for the owner. It is not the evidence of the
// GitHub self-hosted Runner and it never touches the traceability matrix.
// The PEGA key is read without echo, kept only in this process's memory, handed to the verifier through its environment
// and never written to a file, a command line or the terminal.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { MODEL_PATTERN } = require('./agent-settings.cjs');
const { PEGA_ENV_KEY } = require('./pega-provider.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const VERIFY_SCRIPT = path.join(ROOT, 'scripts', 'provider-environment-verify.cjs');
const SCHEMA = 'aecp.local-provider-evidence/v1';
const FIXED_PROMPT = 'Reply with one short greeting sentence.';
const NOTICE = '這是本機執行證據，不是 GitHub 自架 Runner 的正式證據，也不會改動矩陣狀態。';

// The whole surface: three modes, each with the verifier mode it stands for and what it has to ask.
const MODES = Object.freeze({
  ollama: Object.freeze({ verifyMode: 'ollama', label: 'Ollama 本機模型', asks: 'ollama-model' }),
  pega: Object.freeze({ verifyMode: 'codex-pega', label: 'PEGA（Codex Worker）', asks: 'pega' }),
  official: Object.freeze({ verifyMode: 'codex-official', label: 'OpenAI 官方（Codex OFFICIAL）', asks: 'official' })
});

// Plain-language failure reasons. The first match wins; order matters (a quota message must not become "other").
const REASONS = Object.freeze([
  { id: 'QUOTA', label: '額度用完', test: /usage limit|quota|rate limit|insufficient_quota|try again at|purchase more credits|額度/i },
  { id: 'CODEX_NOT_FOUND', label: '找不到 Codex', test: /spawn codex ENOENT|codex(?:\.exe)?['" ]?(?: is)? not (?:found|recognized)|'codex' is not recognized|CODEX_.*NOT_FOUND/i },
  { id: 'AUTH', label: '尚未登入或金鑰無效', test: /requires authentication|not authenticated|OFFICIAL_AUTH_REQUIRED|PEGA_AUTH_REQUIRED|401|unauthori[sz]ed|invalid api key|invalid_api_key|AUTH_REQUIRED/i },
  { id: 'SANDBOX', label: '沙盒拒絕寫入', test: /sandbox|access is denied|拒絕存取|EPERM|operation not permitted|read-only file system/i },
  { id: 'FILE_NOT_CREATED', label: '檔案沒有被建立', test: /FILE_VERIFY|ENOENT.*worker_result|worker_result.*ENOENT|EDIT_VERIFY_FAILED|no such file or directory/i },
  { id: 'TIMEOUT', label: '逾時', test: /timed out|timeout|ETIMEDOUT|逾時/i },
  { id: 'MODEL', label: '模型不存在或沒有指定', test: /model.*(?:not found|does not exist|not supported|required)|MODEL_REQUIRED|PEGA_MODEL_REQUIRED|unknown model/i },
  { id: 'NETWORK', label: '連不上網路或端點', test: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|could not be reached|ENDPOINT_UNREACHABLE/i },
  { id: 'SMOKE_FAILED', label: '模型沒有依指示回覆', test: /SMOKE_FAILED|smoke token missing/i }
]);

// Turns whatever text and codes we have into one plain reason, keeping the original message (for example "try again at ...").
function classifyFailure({ codes = [], text = '', timedOut = false } = {}) {
  const haystack = [...codes, String(text || '')].join('\n');
  if (timedOut) return { id: 'TIMEOUT', label: '逾時', detail: firstLine(text) };
  for (const reason of REASONS) {
    if (reason.test.test(haystack)) return { id: reason.id, label: reason.label, detail: firstLine(text) || codes.join(', ') };
  }
  return { id: 'OTHER', label: '其他原因（請看證據檔）', detail: firstLine(text) || codes.join(', ') };
}

function firstLine(text) {
  const lines = String(text || '').split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
  return (lines.find((line) => /limit|quota|try again|error|fail|denied|not found|ENOENT|timed out|authenticat/i.test(line)) || lines[0] || '').slice(0, 300);
}

// Installed model names from `ollama list`, filtered to the same pattern the settings use.
function parseOllamaList(output) {
  return String(output || '').split(String.fromCharCode(10)).slice(1)
    .map((line) => line.trim().split(/\s+/)[0] || '')
    .filter((name) => MODEL_PATTERN.test(name))
    .slice(0, 50);
}

// Reads a secret without echoing it: raw mode, no output, Backspace edits, Ctrl-C aborts.
function readSecret({ stdin = process.stdin, stdout = process.stdout, prompt = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (prompt) stdout.write(prompt);
    let buffer = '';
    const wasRaw = Boolean(stdin.isRaw);
    const done = (error) => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode?.(wasRaw); stdin.pause?.(); } catch { /* not a terminal */ }
      stdout.write(String.fromCharCode(10));
      if (error) reject(error); else resolve(buffer);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        const code = ch.charCodeAt(0);
        
        if (ch === String.fromCharCode(13) || ch === String.fromCharCode(10)) return done();
        if (code === 3) return done(Object.assign(new Error('Cancelled.'), { code: 'CANCELLED' }));
        if (code === 8 || code === 127) { buffer = buffer.slice(0, -1); continue; }
        if (code >= 32) buffer += ch;
      }
    };
    try { stdin.setRawMode?.(true); } catch { /* piped input: read it as is */ }
    stdin.resume?.();
    stdin.on('data', onData);
  });
}

function workersRoot(env = process.env, platform = process.platform) {
  const base = platform === 'win32' ? (env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')) : path.join(os.homedir(), '.config');
  return path.join(base, 'ai-engineering-control-plane', 'workers');
}

function stamp(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-'); }

// io: { ask(question), askSecret(question), print(line) }   deps: everything that touches the outside world.
async function runLocalEvidence({ mode, io, deps }) {
  const spec = Object.hasOwn(MODES, mode) ? MODES[mode] : null;
  if (!spec) {
    const error = new Error('用法：npm run evidence:local -- <' + Object.keys(MODES).join('|') + '>');
    error.code = 'USAGE';
    throw error;
  }
  io.print('AIECP 本機供應商證據：' + spec.label);
  io.print(NOTICE);

  const env = {};
  let model = null;
  let secret = '';
  if (spec.asks === 'ollama-model') {
    const models = parseOllamaList(await deps.listOllama());
    if (!models.length) { const error = new Error('找不到已安裝的 Ollama 模型（ollama list 是空的）。'); error.code = 'NO_MODELS'; throw error; }
    io.print('已安裝的 Ollama 模型：');
    models.forEach((name, index) => io.print(`  ${index + 1}. ${name}`));
    const answer = Number((await io.ask('請輸入要測試的編號：')).trim());
    if (!Number.isInteger(answer) || answer < 1 || answer > models.length) { const error = new Error('編號不在清單內。'); error.code = 'BAD_CHOICE'; throw error; }
    model = models[answer - 1];
    env.AECP_PROVIDER_VERIFY_MODEL = model;
  } else if (spec.asks === 'pega') {
    model = (await io.ask('PEGA 模型名稱（例如 Pega-Coding）：')).trim();
    if (!MODEL_PATTERN.test(model)) { const error = new Error('模型名稱格式不正確。'); error.code = 'BAD_MODEL'; throw error; }
    io.print('金鑰只存在這次執行的記憶體，不會寫進檔案、命令列或畫面。');
    secret = await io.askSecret('請輸入 PEGA 金鑰（輸入時不會顯示）：');
    if (!secret) { const error = new Error('沒有輸入金鑰。'); error.code = 'NO_KEY'; throw error; }
    env.AECP_PROVIDER_VERIFY_PEGA_MODEL = model;
    env[PEGA_ENV_KEY] = secret;
    env.AECP_PROVIDER_VERIFY_CODEX_ROOT = deps.tempWorkersRoot();
  } else {
    env.AECP_PROVIDER_VERIFY_CODEX_ROOT = deps.workersRoot();
    io.print('使用 AIECP 自己的 workers 資料夾（已登入的官方帳號）：' + deps.workersRoot());
  }

  const startedAt = deps.now();
  const evidencePath = path.join(deps.artifactsDir(), `local-evidence-${mode}-${stamp(startedAt)}.verifier.json`);
  env.AECP_PROVIDER_VERIFY_MODE = spec.verifyMode;
  env.AECP_PROVIDER_EVIDENCE_PATH = evidencePath;
  env.AECP_PROVIDER_VERIFY_TIMEOUT_MS = '300000';
  io.print('執行中，請稍候（最多 5 分鐘）…');

  const run = await deps.spawnVerify(env);
  let evidence = null;
  try { evidence = await deps.readEvidence(evidencePath); } catch { /* the verifier died before writing */ }
  const failedChecks = (evidence?.checks || []).filter((check) => check.status === 'FAIL');
  const codes = [...failedChecks.map((check) => check.error?.code).filter(Boolean), evidence?.fatal?.code].filter(Boolean);
  const passed = Boolean(evidence) && evidence.summary?.failed === 0 && evidence.summary?.requested > 0 && run.code === 0;

  let reason = null;
  if (!passed) {
    let text = [run.stderr, run.stdout].filter(Boolean).join(String.fromCharCode(10));
    let timedOut = Boolean(run.timedOut);
    // The verifier only keeps safe error codes, so one fixed greeting is repeated to read the tool's own message.
    const probe = await deps.diagnose({ mode, model, env: { ...env }, prompt: FIXED_PROMPT }).catch(() => null);
    if (probe) { text = [probe.stderr, probe.stdout, text].filter(Boolean).join(String.fromCharCode(10)); timedOut = timedOut || Boolean(probe.timedOut); }
    reason = classifyFailure({ codes, text, timedOut });
  }

  const summaryPath = path.join(deps.artifactsDir(), `local-evidence-${mode}-${stamp(startedAt)}.json`);
  const summary = {
    schema: SCHEMA,
    notice: NOTICE,
    localOnly: true,
    notRunnerEvidence: true,
    touchesMatrix: false,
    mode,
    verifierMode: spec.verifyMode,
    model,
    generatedAt: startedAt.toISOString(),
    passed,
    reason: reason ? { id: reason.id, label: reason.label, detail: reason.detail } : null,
    verifierEvidence: path.basename(evidencePath),
    checks: (evidence?.checks || []).map((check) => ({ id: check.id, status: check.status, errorCode: check.error?.code || null }))
  };
  await deps.writeFile(summaryPath, JSON.stringify(summary, null, 2) + String.fromCharCode(10));

  io.print('');
  io.print(passed ? `結論：通過。${spec.label} 在這台電腦上實際回覆了。` : `結論：失敗。原因：${reason.label}${reason.detail ? '（' + reason.detail + '）' : ''}`);
  io.print(NOTICE);
  io.print('結果檔：' + path.relative(deps.rootDir(), summaryPath));
  return { passed, reason, summaryPath, summary };
}

function realDeps() {
  const { ProviderRouter } = require('./provider-router.cjs');
  const { CodexWorkerRuntime, WORKER_IDS } = require('./codex-worker-runtime.cjs');
  const { PEGA_PROVIDER_ID, PEGA_WORKER_ID, PEGA_BASE_URL, makePegaProvider } = require('./pega-provider.cjs');
  const tmpRoots = [];
  const capture = (command, args, { env = {}, timeoutMs = 300000 } = {}) => new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < 1024 * 1024) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 1024 * 1024) stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(error.message), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: Number.isInteger(code) ? code : -1, stdout, stderr, timedOut }); });
  });
  return {
    now: () => new Date(),
    rootDir: () => ROOT,
    artifactsDir: () => path.join(ROOT, 'artifacts'),
    workersRoot: () => workersRoot(),
    tempWorkersRoot: () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiecp-local-evidence-')); tmpRoots.push(dir); return dir; },
    listOllama: async () => (await capture('ollama', ['list'], { timeoutMs: 8000 })).stdout,
    spawnVerify: (env) => capture(process.execPath, [VERIFY_SCRIPT], { env, timeoutMs: 330000 }),
    readEvidence: async (file) => JSON.parse(await fs.promises.readFile(file, 'utf8')),
    writeFile: async (file, content) => { await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file, content, 'utf8'); },
    diagnose: async ({ mode, model, env, prompt }) => {
      if (mode === 'ollama') return capture('ollama', ['run', model, prompt], { timeoutMs: 120000 });
      const runtime = new CodexWorkerRuntime(env.AECP_PROVIDER_VERIFY_CODEX_ROOT);
      const registry = {};
      let provider;
      if (mode === 'official') {
        const profile = await runtime.prepareOfficial({});
        const inspection = await runtime.inspect(WORKER_IDS.OFFICIAL);
        provider = 'openai-official';
        registry[provider] = { id: provider, command: 'codex', roles: ['builder'], mode: 'codex-cli', network: true, credential: false, requiresCredential: false, requiresAuthFiles: true, authPresent: inspection.authPresent, workerId: WORKER_IDS.OFFICIAL, workerName: 'Codex OFFICIAL', providerName: 'OpenAI Official', defaultModel: null, codexHome: profile.codexHome, runtimeEnv: { ...profile.env }, kind: 'codex-worker' };
      } else {
        const profile = await runtime.prepareCustom({ workerId: PEGA_WORKER_ID, workerName: 'Codex PEGA', providerId: PEGA_PROVIDER_ID, providerName: 'PEGA', baseUrl: PEGA_BASE_URL, model, wireApi: 'responses', envKey: PEGA_ENV_KEY, apiKey: env[PEGA_ENV_KEY] });
        provider = PEGA_PROVIDER_ID;
        registry[provider] = makePegaProvider({ model, wireApi: 'responses', apiKey: env[PEGA_ENV_KEY], codexHome: profile.codexHome, runtimeEnv: { ...profile.env } });
      }
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aiecp-local-evidence-cwd-'));
      try {
        const result = await new ProviderRouter(registry).execute('builder', prompt, { provider, model: model || undefined, cwd, timeoutMs: 120000, networkApproved: true, credentialApproved: true, skipGitRepoCheck: true });
        return { code: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
      } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
    },
    cleanup: () => { for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

async function main(argv = process.argv.slice(2)) {
  const readline = require('node:readline');
  const deps = realDeps();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const io = {
    print: (line) => process.stdout.write(line + String.fromCharCode(10)),
    ask: (question) => new Promise((resolve) => rl.question(question, resolve)),
    askSecret: async (question) => { rl.pause(); const value = await readSecret({ prompt: question }); rl.resume(); return value; }
  };
  try {
    const result = await runLocalEvidence({ mode: argv[0], io, deps });
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(String(error.message || error) + String.fromCharCode(10));
    process.exitCode = error.code === 'USAGE' ? 2 : 1;
  } finally {
    rl.close();
    deps.cleanup();
  }
}

if (require.main === module) main();

module.exports = { MODES, REASONS, NOTICE, FIXED_PROMPT, SCHEMA, classifyFailure, parseOllamaList, readSecret, workersRoot, runLocalEvidence };
