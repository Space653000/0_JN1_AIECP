'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');

test('provider registry exposes vendor-neutral roles including Ollama', () => {
  assert.deepEqual(PROVIDERS.ollama.roles, ['planner', 'reviewer', 'general']);
  assert.equal(PROVIDERS.ollama.mode, 'ollama');
});

test('Ollama command spec is local and requires an explicit model', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('ollama', 'reviewer', 'review work', { model: 'qwen3-coder:30b', cwd: 'C:\\repo' });
  assert.equal(spec.command, 'ollama');
  assert.deepEqual(spec.args, ['run', 'qwen3-coder:30b', 'review work']);
  assert.equal(spec.provider, 'ollama');
  assert.equal(spec.model, 'qwen3-coder:30b');
  assert.equal(spec.cwd, 'C:\\repo');
});

test('Ollama can obtain the model from AECP_OLLAMA_MODEL', () => {
  const previous = process.env.AECP_OLLAMA_MODEL;
  process.env.AECP_OLLAMA_MODEL = 'qwen3-coder:30b';
  try {
    const spec = new ProviderRouter().commandSpec('ollama', 'reviewer', 'review');
    assert.equal(spec.args[0], 'run');
    assert.equal(spec.args[1], 'qwen3-coder:30b');
  } finally {
    if (previous === undefined) delete process.env.AECP_OLLAMA_MODEL;
    else process.env.AECP_OLLAMA_MODEL = previous;
  }
});

test('Ollama without a model is rejected instead of silently selecting one', () => {
  const previous = process.env.AECP_OLLAMA_MODEL;
  delete process.env.AECP_OLLAMA_MODEL;
  try {
    assert.throws(() => new ProviderRouter().commandSpec('ollama', 'reviewer', 'work'), /requires a model/);
  } finally {
    if (previous !== undefined) process.env.AECP_OLLAMA_MODEL = previous;
  }
});

test('Codex builder keeps the bounded workspace sandbox', () => {
  const spec = new ProviderRouter().commandSpec('codex', 'builder', 'build', { model: 'test-model', cwd: 'C:\\repo' });
  assert.equal(spec.command, 'codex');
  assert.ok(spec.args.includes('--sandbox'));
  assert.ok(spec.args.includes('workspace-write'));
  assert.ok(spec.args.includes('--json'));
  assert.ok(spec.args.includes('--cd'));
  assert.ok(spec.args.includes('C:\\repo'));
  assert.ok(spec.args.includes('sandbox_workspace_write.network_access=false'));
});

test('fixed local-command provider uses only its registered executable and arguments', () => {
  const registry = { local: { command: 'trusted-local-worker', args: ['--bounded'], roles: ['builder'], mode: 'local-command' } };
  const spec = new ProviderRouter(registry).commandSpec('local', 'builder', 'TASK_TEXT_CANNOT_SELECT_EXECUTABLE', { cwd: 'C:\\repo' });
  assert.equal(spec.command, 'trusted-local-worker');
  assert.deepEqual(spec.args, ['--bounded', 'TASK_TEXT_CANNOT_SELECT_EXECUTABLE']);
  assert.equal(spec.cwd, 'C:\\repo');
});

test('unknown provider mode is rejected', () => {
  const registry = { local: { command: 'worker', roles: ['builder'], mode: 'unknown-mode' } };
  assert.throws(() => new ProviderRouter(registry).commandSpec('local', 'builder', 'work'), /Unsupported provider mode/);
});

test('raw Ollama is not exposed as a mutating builder', () => {
  assert.throws(() => new ProviderRouter().commandSpec('ollama', 'builder', 'edit files', { model: 'qwen3-coder:30b' }), /No provider for role: builder/);
});

test('Claude planner and reviewer run in plan-only permission mode', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('claude', 'planner', 'plan safely', { cwd: 'C:\\repo' });
  assert.ok(spec.args.includes('--permission-mode'));
  assert.ok(spec.args.includes('plan'));
  assert.ok(spec.args.includes('--max-turns'));
});

test('Gemini is read-only for Harness roles and is not a builder', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('gemini', 'reviewer', 'review safely', { cwd: 'C:\\repo' });
  assert.ok(spec.args.includes('--approval-mode'));
  assert.ok(spec.args.includes('plan'));
  assert.throws(() => router.commandSpec('gemini', 'builder', 'edit files'), /No provider for role: builder/);
});

test('OpenCode builder receives deny-first v1 permissions', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('opencode', 'builder', 'edit only the worktree', {
    model: 'ollama/qwen3-coder:30b',
    cwd: 'C:\\repo',
    providerVersion: '1.18.30'
  });
  assert.ok(spec.args.includes('--auto'));
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.permission['*'], 'deny');
  assert.equal(config.permission.edit, 'allow');
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.bash['*'], 'deny');
});

test('OpenCode builder receives deny-first v2 permissions', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('opencode', 'builder', 'edit only the worktree', {
    model: 'ollama/qwen3-coder:30b',
    cwd: 'C:\\repo',
    providerVersion: '2.1.0'
  });
  assert.equal(spec.args.includes('--auto'), false);
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.ok(config.permissions.some((rule) => rule.action === 'external_directory' && rule.effect === 'deny'));
  assert.ok(config.permissions.some((rule) => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'deny'));
  assert.ok(config.permissions.some((rule) => rule.action === 'edit' && rule.effect === 'allow'));
  assert.ok(config.permissions.some((rule) => rule.action === 'execute' && rule.effect === 'deny'));
});

test('OpenCode local models do not request model-network approval but cloud models do', () => {
  const router = new ProviderRouter();
  assert.equal(router.capabilities('builder', 'opencode', { model: 'ollama/qwen3-coder:30b' }).network, false);
  assert.equal(router.capabilities('builder', 'opencode', { model: 'openai/gpt-code' }).network, true);
});

test('built-in CLI authentication is not exposed to AECP as a credential capability', () => {
  const router = new ProviderRouter();
  assert.equal(router.capabilities('builder', 'codex').credential, false);
  assert.equal(router.capabilities('planner', 'claude').credential, false);
  assert.equal(router.capabilities('reviewer', 'gemini').credential, false);
});

test('Claude planner and reviewer run in read-only plan permission mode', () => {
  const router = new ProviderRouter();
  const planner = router.commandSpec('claude', 'planner', 'plan safely', { cwd: 'C:\\repo' });
  const reviewer = router.commandSpec('claude', 'reviewer', 'review safely', { cwd: 'C:\\repo' });
  for (const spec of [planner, reviewer]) {
    assert.ok(spec.args.includes('--permission-mode'));
    assert.ok(spec.args.includes('plan'));
    assert.ok(spec.args.includes('--max-turns'));
  }
});

test('Gemini is reasoning-only in Harness and uses plan approval mode', () => {
  const router = new ProviderRouter();
  assert.throws(() => router.commandSpec('gemini', 'builder', 'edit files', { cwd: 'C:\\repo' }), /No provider for role: builder/);
  const spec = router.commandSpec('gemini', 'reviewer', 'review only', { cwd: 'C:\\repo' });
  assert.deepEqual(spec.args.slice(0, 2), ['--approval-mode', 'plan']);
});

test('OpenCode builder receives deny-first inline policy and explicit worktree directory', () => {
  const router = new ProviderRouter();
  const spec = router.commandSpec('opencode', 'builder', 'edit safely', {
    cwd: 'C:\\repo',
    model: 'ollama/qwen3-coder:30b',
    providerVersion: '1.18.30'
  });
  assert.ok(spec.args.includes('--auto'));
  assert.ok(spec.args.includes('--dir'));
  assert.ok(spec.args.includes('C:\\repo'));
  const policy = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(policy.permission['*'], 'deny');
  assert.equal(policy.permission.external_directory, 'deny');
  assert.equal(policy.permission.bash['*'], 'deny');
  assert.equal(policy.permission.webfetch, 'deny');
});

test('OpenCode local model capability does not require provider network approval', () => {
  const router = new ProviderRouter();
  const local = router.capabilities('builder', 'opencode', { model: 'ollama/qwen3-coder:30b' });
  const cloud = router.capabilities('builder', 'opencode', { model: 'anthropic/claude-sonnet' });
  assert.equal(local.network, false);
  assert.equal(local.local, true);
  assert.equal(cloud.network, true);
});


test('provider health reports READY for available CLI providers', async () => {
  const calls=[];
  const runner=async(command,args)=>{
    calls.push([command,args]);
    return {code:0,stdout:'codex 1.2.3\n',stderr:'',timedOut:false,aborted:false};
  };
  const router=new ProviderRouter({codex:{command:'codex',roles:['builder'],mode:'cli',network:false,credential:false}},{runner,platform:'win32'});
  const health=await router.health('codex');
  assert.equal(health.status,'READY');
  assert.equal(health.version,'codex 1.2.3');
  assert.deepEqual(calls[0],['codex',['--version']]);
});

test('Ollama health is DEGRADED when CLI exists but no explicit model is configured', async () => {
  const previous=process.env.AECP_OLLAMA_MODEL;
  delete process.env.AECP_OLLAMA_MODEL;
  try {
    const runner=async()=>({code:0,stdout:'ollama version 0.12.0',stderr:'',timedOut:false,aborted:false});
    const router=new ProviderRouter({ollama:{command:'ollama',roles:['planner'],mode:'ollama',network:false,credential:false}},{runner});
    const health=await router.health('ollama');
    assert.equal(health.status,'DEGRADED');
    assert.match(health.detail,/explicit model/i);
  } finally {
    if(previous===undefined) delete process.env.AECP_OLLAMA_MODEL;
    else process.env.AECP_OLLAMA_MODEL=previous;
  }
});

test('provider health does not probe network without explicit NETWORK approval', async () => {
  let fetched=false;
  const router=new ProviderRouter({
    company:{id:'company',mode:'openai-compatible',baseUrl:'https://example.test/v1',defaultModel:'model-a',roles:['planner'],network:true}
  },{fetchImpl:async()=>{fetched=true;throw new Error('must not run');}});
  const health=await router.health('company',{networkApproved:false});
  assert.equal(health.status,'DEGRADED');
  assert.equal(fetched,false);
  assert.match(health.detail,/NETWORK approval/i);
});

test('provider health reports AUTH_REQUIRED for missing or unapproved configured credentials', async () => {
  const missing=new ProviderRouter({
    company:{id:'company',mode:'openai-compatible',baseUrl:'https://example.test/v1',defaultModel:'model-a',roles:['planner'],requiresCredential:true,apiKey:''}
  });
  assert.equal((await missing.health('company',{networkApproved:true,credentialApproved:true})).status,'AUTH_REQUIRED');

  let fetched=false;
  const unapproved=new ProviderRouter({
    company:{id:'company',mode:'openai-compatible',baseUrl:'https://example.test/v1',defaultModel:'model-a',roles:['planner'],requiresCredential:true,apiKey:'secret'}
  },{fetchImpl:async()=>{fetched=true;return {ok:true,status:200};}});
  const health=await unapproved.health('company',{networkApproved:true,credentialApproved:false});
  assert.equal(health.status,'AUTH_REQUIRED');
  assert.equal(fetched,false);
});

test('provider health probes approved endpoint and maps HTTP and transport states', async () => {
  const base={id:'company',mode:'openai-compatible',baseUrl:'https://example.test/v1',defaultModel:'model-a',roles:['planner'],apiKey:'secret',requiresCredential:true};
  const ready=new ProviderRouter({company:base},{fetchImpl:async(url,opts)=>{
    assert.equal(url.href,'https://example.test/v1/models');
    assert.equal(opts.headers.authorization,'Bearer secret');
    return {ok:true,status:200};
  }});
  assert.equal((await ready.health('company',{networkApproved:true,credentialApproved:true})).status,'READY');

  const auth=new ProviderRouter({company:base},{fetchImpl:async()=>({ok:false,status:401})});
  assert.equal((await auth.health('company',{networkApproved:true,credentialApproved:true})).status,'AUTH_REQUIRED');

  const degraded=new ProviderRouter({company:base},{fetchImpl:async()=>({ok:false,status:503})});
  assert.equal((await degraded.health('company',{networkApproved:true,credentialApproved:true})).status,'DEGRADED');

  const unavailable=new ProviderRouter({company:base},{fetchImpl:async()=>{throw new Error('connection refused');}});
  assert.equal((await unavailable.health('company',{networkApproved:true,credentialApproved:true})).status,'UNAVAILABLE');
});

test('fixed local-command health checks executable discovery without running task text', async () => {
  const calls=[];
  const runner=async(command,args)=>{
    calls.push([command,args]);
    return {code:0,stdout:'C:\\Tools\\worker.exe\n',stderr:'',timedOut:false,aborted:false};
  };
  const router=new ProviderRouter({
    worker:{command:'C:\\Tools\\worker.exe',args:['--bounded'],roles:['builder'],mode:'local-command'}
  },{runner,platform:'win32'});
  const health=await router.health('worker');
  assert.equal(health.status,'READY');
  assert.deepEqual(calls[0],['where.exe',['C:\\Tools\\worker.exe']]);
});


test('isolated Codex worker command uses its dedicated CODEX_HOME environment', () => {
  const router = new ProviderRouter({
    'codex-official': {
      id:'codex-official',
      command:'codex',
      roles:['builder'],
      mode:'codex-cli',
      network:true,
      credential:false,
      workerId:'codex-official',
      workerName:'Codex OFFICIAL',
      providerName:'OpenAI Official',
      codexHome:'C:\\AECP\\workers\\official',
      runtimeEnv:{CODEX_HOME:'C:\\AECP\\workers\\official'}
    }
  });
  const spec = router.commandSpec('codex-official', 'builder', 'build', { cwd:'C:\\repo' });
  assert.equal(spec.workerId, 'codex-official');
  assert.equal(spec.codexHome, 'C:\\AECP\\workers\\official');
  assert.equal(spec.env.CODEX_HOME, 'C:\\AECP\\workers\\official');
});

test('Codex worker direct execution cannot bypass NETWORK or CREDENTIAL approval', async () => {
  let calls = 0;
  const runner = async () => { calls += 1; return {code:0,stdout:'ok',stderr:'',timedOut:false,aborted:false}; };
  const router = new ProviderRouter({
    'codex-pega': {
      id:'codex-pega',
      command:'codex',
      roles:['builder'],
      mode:'codex-cli',
      network:true,
      credential:true,
      requiresCredential:true,
      apiKey:'secret',
      workerId:'codex-pega',
      codexHome:'C:\\AECP\\workers\\pega',
      runtimeEnv:{CODEX_HOME:'C:\\AECP\\workers\\pega',AECP_PEGA_API_KEY:'secret'},
      defaultModel:'pega-model'
    }
  }, {runner});
  await assert.rejects(
    () => router.execute('builder','build',{provider:'codex-pega'}),
    error => error?.code === 'APPROVAL_REQUIRED' && error?.action === 'NETWORK'
  );
  await assert.rejects(
    () => router.execute('builder','build',{provider:'codex-pega',networkApproved:true}),
    error => error?.code === 'APPROVAL_REQUIRED' && error?.action === 'CREDENTIAL'
  );
  const result = await router.execute('builder','build',{provider:'codex-pega',networkApproved:true,credentialApproved:true});
  assert.equal(result.code,0);
  assert.equal(calls,1);
});

test('Codex OFFICIAL health reports AUTH_REQUIRED when isolated home is not authenticated', async () => {
  const runner = async () => ({code:0,stdout:'codex 1.0.0',stderr:'',timedOut:false,aborted:false});
  const router = new ProviderRouter({
    'codex-official': {
      id:'codex-official',
      command:'codex',
      roles:['builder'],
      mode:'codex-cli',
      network:true,
      credential:false,
      workerId:'codex-official',
      codexHome:'C:\\AECP\\workers\\official',
      requiresAuthFiles:true,
      authPresent:false
    }
  }, {runner});
  const health = await router.health('codex-official');
  assert.equal(health.status,'AUTH_REQUIRED');
});
