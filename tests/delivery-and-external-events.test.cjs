'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DeliveryManager } = require('../electron/lib/delivery.cjs');
const { GitHubWebhookReceiver } = require('../electron/lib/github-webhook.cjs');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');

const SECRET = 'webhook-test-secret-0123456789';
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

function recordingRunner(replies = {}) {
  const calls = [];
  const runner = async (argv, options) => {
    calls.push({ argv, cwd: options?.cwd });
    const key = argv.slice(0, 3).join(' ');
    if (key === 'git status --porcelain') return 'M file.txt';
    if (key === 'git rev-parse HEAD') return 'abc123def456';
    if (key === 'gh pr list') return replies.existingPR || '';
    if (key === 'gh pr create') return 'https://github.com/acme/app/pull/7';
    return '';
  };
  return { calls, runner };
}

const FORBIDDEN_FLAGS = /^(--force|-f|--force-with-lease|--no-verify|--admin|--delete-branch|--merge|--squash|--rebase)$/;

test('B05-L34 the governed delivery path only issues fixed, capability-limited git/gh commands and always opens a draft PR', async () => {
  const { calls, runner } = recordingRunner();
  const delivery = new DeliveryManager({ repo: 'acme/app', cwd: '/unused', runner });
  const worktree = path.join(os.tmpdir(), 'wt');
  const hostileBranch = 'agent/x; rm -rf / && curl evil';
  const hostileTitle = 'T $(whoami) && evil `x`';

  await delivery.branch(worktree, hostileBranch);
  const sha = await delivery.commit(worktree, 'message "quoted"; $(whoami)');
  await delivery.push(worktree, hostileBranch);
  const url = await delivery.draftPR(worktree, { branch: hostileBranch, title: hostileTitle, body: 'body `x` | cat' });

  assert.equal(sha, 'abc123def456');
  assert.equal(url, 'https://github.com/acme/app/pull/7');
  assert.ok(calls.length >= 8);

  const GIT_SUBCOMMANDS = new Set(['fetch', 'checkout', 'add', 'status', 'commit', 'rev-parse', 'ls-remote', 'push']);
  for (const { argv, cwd } of calls) {
    assert.equal(cwd, worktree, 'commands run only inside the task worktree');
    assert.ok(['git', 'gh'].includes(argv[0]), `unexpected executable ${argv[0]}`);
    if (argv[0] === 'git') assert.ok(GIT_SUBCOMMANDS.has(argv[1]), `git ${argv[1]} is not an allowed delivery primitive`);
    if (argv[0] === 'gh') {
      assert.equal(argv[1], 'pr');
      assert.ok(['list', 'create'].includes(argv[2]), `gh pr ${argv[2]} is not allowed`);
    }
    assert.ok(argv.every((arg) => !FORBIDDEN_FLAGS.test(arg)), `forbidden flag in ${argv.join(' ')}`);
    assert.ok(argv.every((arg) => typeof arg === 'string'));
  }

  const pushCall = calls.find(({ argv }) => argv[1] === 'push').argv;
  assert.deepEqual(pushCall, ['git', 'push', '-u', 'origin', hostileBranch], 'the branch is one argv element, never shell-interpreted');

  const create = calls.find(({ argv }) => argv[2] === 'create').argv;
  assert.ok(create.includes('--draft'), 'PRs are always drafts; a human governs the merge');
  assert.equal(create[create.indexOf('--repo') + 1], 'acme/app');
  assert.equal(create[create.indexOf('--base') + 1], 'main');
  assert.equal(create[create.indexOf('--title') + 1], hostileTitle);
  assert.equal(create[create.indexOf('--head') + 1], hostileBranch);
});

test('B05-L34 an already-open PR is reused and no second PR is created', async () => {
  const { calls, runner } = recordingRunner({ existingPR: 'https://github.com/acme/app/pull/3' });
  const delivery = new DeliveryManager({ repo: 'acme/app', runner });
  assert.equal(await delivery.draftPR('/wt', { branch: 'agent/y', title: 't' }), 'https://github.com/acme/app/pull/3');
  assert.equal(calls.some(({ argv }) => argv[2] === 'create'), false);
});

async function withWebhook(fn) {
  const events = [];
  const receiver = new GitHubWebhookReceiver({ secret: SECRET, onEvent: async (event) => { events.push(event); } });
  const info = await receiver.start();
  const post = (body, headers = {}, url = '/github/webhook', method = 'POST') => fetch(`http://127.0.0.1:${info.port}${url}`, {
    method, body: method === 'POST' ? body : undefined, headers, signal: AbortSignal.timeout(3000)
  });
  try { await fn({ events, post, receiver }); } finally { await receiver.stop(); }
}

test('B05-L34 the webhook receiver rejects unsigned or wrongly signed deliveries and correlates signed ones to the workflow run', async () => {
  await withWebhook(async ({ events, post }) => {
    const body = JSON.stringify({ workflow_run: { id: 987, conclusion: 'success', head_sha: 'abc' } });
    const wrong = `sha256=${'0'.repeat(64)}`;

    assert.equal((await post(body)).status, 401, 'missing signature');
    assert.equal((await post(body, { 'x-hub-signature-256': wrong })).status, 401, 'wrong signature');
    assert.equal((await post(body, { 'x-hub-signature-256': sign(body).replace('sha256=', 'sha1=') })).status, 401, 'wrong algorithm prefix');
    assert.equal((await post(body + ' ', { 'x-hub-signature-256': sign(body) })).status, 401, 'signature over different bytes');
    assert.equal((await post(body, { 'x-hub-signature-256': sign(body) }, '/other')).status, 404);
    assert.equal((await post(null, {}, '/github/webhook', 'GET')).status, 404);
    assert.equal(events.length, 0, 'nothing unauthenticated may reach the Control Plane');

    const ok = await post(body, { 'x-hub-signature-256': sign(body), 'x-github-delivery': 'delivery-1', 'x-github-event': 'workflow_run' });
    assert.equal(ok.status, 202);
    assert.deepEqual(await ok.json(), { accepted: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'workflow_run');
    assert.equal(events[0].externalId, 'delivery-1');
    assert.equal(events[0].idempotencyKey, 'github:delivery-1');
    assert.equal(events[0].correlationId, '987');

    const bad = 'not json';
    assert.equal((await post(bad, { 'x-hub-signature-256': sign(bad) })).status, 400);
    assert.equal(events.length, 1);

    const noDelivery = await post(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'workflow_run' });
    assert.equal(noDelivery.status, 202);
    const replay = await post(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'workflow_run' });
    assert.equal(replay.status, 202);
    assert.equal(events[1].idempotencyKey, events[2].idempotencyKey, 'a replay of identical bytes gets the same idempotency key');
  });
});

test('B05-L34 a malformed or wrong-length signature is answered 401 promptly and never hangs or crashes the receiver', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await withWebhook(async ({ events, post, receiver }) => {
      const body = JSON.stringify({ workflow_run: { id: 1 } });
      const good = sign(body);
      const hex = good.slice('sha256='.length);
      const malformed = {
        'too short': 'sha256=abc',
        'empty digest': 'sha256=',
        'one char short': `sha256=${hex.slice(0, -1)}`,
        'one char long': `sha256=${hex}0`,
        'double length': `sha256=${hex}${hex}`,
        'multibyte digest': `sha256=${'é'.repeat(32)}`,
        'prefix only': 'sha256',
        'wrong case prefix': `SHA256=${hex}`
      };
      for (const [label, signature] of Object.entries(malformed)) {
        const response = await post(body, { 'x-hub-signature-256': signature });
        assert.equal(response.status, 401, label);
      }
      assert.equal(receiver.verify(Buffer.from(body), 'sha256=abc'), false, 'verify() returns false instead of throwing');
      assert.equal(receiver.verify(Buffer.from(body), undefined), false);
      assert.equal(receiver.verify(Buffer.from(body), 42), false);
      assert.equal(receiver.verify(Buffer.from(body), good), true);
      assert.equal(events.length, 0, 'nothing malformed reaches the Control Plane');

      const ok = await post(body, { 'x-hub-signature-256': good, 'x-github-delivery': 'after-malformed' });
      assert.equal(ok.status, 202, 'the receiver keeps serving after rejecting malformed signatures');
      assert.equal(events.length, 1);
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'no unhandled promise rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('B05-L118 external events are journaled with their correlation id but never change task state, and replays are deduplicated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-external-'));
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    cp.state.runs['run-x'] = { id: 'run-x', state: 'RUNNING', taskIds: ['t-run', 't-queued'], events: [] };
    cp.state.tasks['t-run'] = { id: 't-run', runId: 'run-x', state: 'RUNNING', delivery: { sha: 'abc' }, ci: { state: 'PENDING' } };
    cp.state.tasks['t-queued'] = { id: 't-queued', runId: 'run-x', state: 'QUEUED' };
    const before = JSON.stringify({ runs: cp.state.runs, tasks: cp.state.tasks });

    const workflow = { externalId: 'd-1', idempotencyKey: 'github:d-1', correlationId: '555', eventType: 'workflow_run', payload: { workflow_run: { id: 555, conclusion: 'success', head_sha: 'abc' } } };
    const dispatch = { externalId: 'd-2', idempotencyKey: 'github:d-2', correlationId: null, eventType: 'repository_dispatch', payload: { action: 'aecp.event', client_payload: { taskId: 't-run', state: 'DONE', ci: 'PASSED' } } };
    assert.deepEqual(await cp.ingestExternalEvent(workflow), { duplicate: false });
    assert.deepEqual(await cp.ingestExternalEvent(dispatch), { duplicate: false });
    assert.deepEqual(await cp.ingestExternalEvent(workflow), { duplicate: true });
    await assert.rejects(cp.ingestExternalEvent({ eventType: 'workflow_run' }), /idempotencyKey or externalId/);

    assert.equal(JSON.stringify({ runs: cp.state.runs, tasks: cp.state.tasks }), before, 'external events must not mutate task or run state');

    const readLedger = async () => (await fs.readFile(cp.ledger.file, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const ledger = await readLedger();
    const received = ledger.filter((event) => event.type === 'external.received');
    assert.deepEqual(received.map((event) => [event.externalId, event.correlationId, event.eventType]), [['d-1', '555', 'workflow_run'], ['d-2', null, 'repository_dispatch']]);
    assert.ok(received.every((event) => event.schema === 'aecp.event-ledger/v1' && event.idempotencyKey.startsWith('github:')));

    // Each accepted delivery is also correlated: the external.correlated event has its own idempotency key,
    // so the ledger does not swallow it as a duplicate of external.received, and it reaches the event journal.
    const correlated = ledger.filter((event) => event.type === 'external.correlated');
    assert.deepEqual(correlated.map((event) => [event.externalId, event.correlationId, event.idempotencyKey]),
      [['d-1', '555', 'github:d-1:correlated'], ['d-2', null, 'github:d-2:correlated']]);
    const journal = (await cp.listEvents(100)).filter((event) => event.type === 'external.correlated');
    assert.deepEqual(journal.map((event) => [event.externalId, event.correlationId, event.idempotencyKey]),
      [['d-1', '555', 'github:d-1:correlated'], ['d-2', null, 'github:d-2:correlated']]);
    assert.ok(journal.every((event) => event.schema === 'aecp.event/v1'));

    // A replay of an already-ingested delivery writes nothing at all: not to the ledger, not to the journal.
    const ledgerLines = (await readLedger()).length;
    const journalLines = (await cp.listEvents(1000)).length;
    assert.deepEqual(await cp.ingestExternalEvent(workflow), { duplicate: true });
    assert.deepEqual(await cp.ingestExternalEvent(dispatch), { duplicate: true });
    assert.equal((await readLedger()).length, ledgerLines, 'a duplicate delivery adds nothing to the ledger');
    assert.equal((await cp.listEvents(1000)).length, journalLines, 'a duplicate delivery adds nothing to the event journal');

    // The dedup state is rebuilt from disk: a restarted Control Plane still treats the delivery as a duplicate.
    await cp.shutdown();
    const restarted = new ControlPlane({ rootDir: path.join(root, 'runtime') });
    await restarted.init();
    try {
      assert.deepEqual(await restarted.ingestExternalEvent(workflow), { duplicate: true });
      assert.equal((await restarted.listEvents(1000)).length, journalLines);
      assert.deepEqual(await restarted.ingestExternalEvent({ ...workflow, externalId: 'd-3', idempotencyKey: 'github:d-3' }), { duplicate: false });
      assert.equal((await restarted.listEvents(1000)).filter((event) => event.type === 'external.correlated').length, 3);
    } finally {
      await restarted.shutdown();
    }
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
