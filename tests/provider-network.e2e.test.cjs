'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('OpenAI-compatible provider is approval-gated and works against a loopback endpoint', async () => {
  let seen = null;
  const server = await listen((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: '{"tasks":[{"title":"Local API task","objective":"verify","dependencies":[],"risk":"GREEN"}]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }));
    });
  });

  const port = server.address().port;
  const router = new ProviderRouter({
    company: {
      mode: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      defaultModel: 'company-model',
      roles: ['planner', 'reviewer'],
      apiKey: 'test-secret',
      network: true,
      credential: true
    }
  });

  try {
    await assert.rejects(
      () => router.execute('planner', 'plan', { provider: 'company' }),
      (error) => error?.code === 'APPROVAL_REQUIRED' && error?.action === 'NETWORK'
    );
    await assert.rejects(
      () => router.execute('planner', 'plan', { provider: 'company', networkApproved: true }),
      (error) => error?.code === 'APPROVAL_REQUIRED' && error?.action === 'CREDENTIAL'
    );

    const result = await router.execute('planner', 'plan', {
      provider: 'company',
      networkApproved: true,
      credentialApproved: true,
      timeoutMs: 5000
    });
    assert.equal(result.code, 0);
    assert.equal(result.provider, 'company');
    assert.equal(result.model, 'company-model');
    assert.match(result.stdout, /Local API task/);
    assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(seen.url, '/v1/chat/completions');
    assert.equal(seen.authorization, 'Bearer test-secret');
    assert.equal(seen.body.model, 'company-model');
    assert.equal(seen.body.messages[0].content, 'plan');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
