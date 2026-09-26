'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {redactText,redactSensitive}=require('../electron/lib/redaction.cjs');

test('B04-L129 Bearer tokens must be redacted from all text surfaces',()=>{
  const textWithBearer='MCP token is Bearer sk_live_1234567890abcdefghij and safe to log';
  const redacted=redactText(textWithBearer);
  assert(!redacted.includes('sk_live_'),'Bearer token must be fully redacted');
  assert(redacted.includes('Bearer [REDACTED]'),'Bearer prefix must remain for clarity');
});

test('B04-L129 API keys and secrets redacted across common patterns',()=>{
  const testCases=[
    {input:'api_key = "secret_abc123defgh"',shouldNotContain:'secret_abc123defgh'},
    {input:'Authorization: Bearer ghp_abc1234567890def',shouldNotContain:'ghp_abc1234567890def'},
    {input:'github_pat_1234567890abcdefghij',shouldNotContain:'1234567890abcdefghij'},
    {input:'password: myP@ssw0rd123',shouldNotContain:'myP@ssw0rd123'}
  ];
  for(const{input,shouldNotContain}of testCases){
    const redacted=redactText(input);
    assert(!redacted.includes(shouldNotContain),`${input} must redact the secret`);
    assert(redacted.includes('[REDACTED]'),`${input} must show [REDACTED] marker`);
  }
});

test('B04-L129 Private keys are redacted as [REDACTED PRIVATE KEY]',()=>{
  const privKeyText='-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234...\n-----END RSA PRIVATE KEY-----';
  const redacted=redactText(privKeyText);
  assert(!redacted.includes('MIIEowIBAAKCAQEA'),'Private key material must be removed');
  assert(redacted.includes('[REDACTED PRIVATE KEY]'),'Must show [REDACTED PRIVATE KEY]');
});

test('B04-L179 redactSensitive removes bearer tokens from Result Capsule objects',()=>{
  const capsule={
    status:'completed',
    token:'Bearer sk_test_abc123def456',
    result:{data:'value'},
    authHeader:'Authorization: Bearer xyz789'
  };
  const redacted=redactSensitive(capsule,{secrets:['sk_test_abc123def456','xyz789']});
  assert.equal(redacted.token,'[REDACTED]','Bearer token field must be redacted');
  assert(!JSON.stringify(redacted).includes('sk_test_abc123def456'),'No token content in Result Capsule');
  assert(!JSON.stringify(redacted).includes('xyz789'),'No auth header content');
});

test('B04-L179 redactSensitive never logs bearer tokens in any Result Capsule route',()=>{
  const output={
    logs:[
      'Task completed: Bearer sk_live_validtoken123abc',
      'MCP response received'
    ],
    capsule:{
      kind:'aecp.result/v1',
      token:'Bearer ghp_abc123def456ghi789jkl',
      events:[]
    }
  };
  const redacted=redactSensitive(output,{secrets:[]});
  const stringified=JSON.stringify(redacted);
  assert(!stringified.includes('sk_live_validtoken123abc'),'No bearer token in logs');
  assert(!stringified.includes('ghp_abc123def456ghi789jkl'),'No GitHub token in capsule');
  assert(!stringified.match(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}/g),'No valid Bearer pattern remains');
});

test('B04-L129 secretKey detection marks fields for redaction',()=>{
  const object={
    api_key:'secret_xyz',
    apiKey:'secret_xyz2',
    password:'pass123',
    client_secret:'cs_abc',
    normal_field:'data',
    nested:{
      access_token:'at_123',
      regular_value:'ok'
    }
  };
  const redacted=redactSensitive(object);
  assert.equal(redacted.api_key,'[REDACTED]','api_key field redacted');
  assert.equal(redacted.apiKey,'[REDACTED]','apiKey field redacted');
  assert.equal(redacted.password,'[REDACTED]','password field redacted');
  assert.equal(redacted.normal_field,'data','normal field preserved');
  assert.equal(redacted.nested.access_token,'[REDACTED]','nested access_token redacted');
  assert.equal(redacted.nested.regular_value,'ok','nested regular value preserved');
});
