'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fss=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {redactText,redactSensitive}=require('../electron/lib/redaction.cjs');
const {EvidenceManager}=require('../electron/lib/evidence-manager.cjs');
const {ContextBus}=require('../electron/lib/context-bus.cjs');
const {safeNetworkUrl}=require('../electron/lib/provider-router.cjs');
const {ControlPlane}=require('../electron/lib/control-plane.cjs');

test('redactText removes common bearer API GitHub URL and private-key secrets',()=>{
  const privateKey='-----BEGIN PRIVATE KEY-----\nSUPERSECRET\n-----END PRIVATE KEY-----';
  const input=[
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456',
    'api_key=abcdefghijk-secret-value',
    'sk-abcdefghijklmnopqrstuvwxyz',
    'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    'https://user:password@example.test/v1',
    privateKey
  ].join('\n');
  const safe=redactText(input);
  assert.doesNotMatch(safe,/abcdefghijklmnopqrstuvwxyz\.123456/);
  assert.doesNotMatch(safe,/abcdefghijk-secret-value/);
  assert.doesNotMatch(safe,/sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(safe,/github_pat_abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(safe,/user:password/);
  assert.doesNotMatch(safe,/SUPERSECRET/);
  assert.match(safe,/\[REDACTED/);
});

test('redactSensitive removes secret-valued keys but preserves references approvals and numeric usage',()=>{
  const safe=redactSensitive({
    apiKey:'secret-api-key-value',
    password:'secret-password',
    token:'secret-token-value',
    credentialRef:'cred:provider-a',
    credentialApproved:true,
    usage:{prompt_tokens:10,total_tokens:15},
    nested:{authorization:'Bearer abcdefghijklmnopqrst'}
  });
  assert.equal(safe.apiKey,'[REDACTED]');
  assert.equal(safe.password,'[REDACTED]');
  assert.equal(safe.token,'[REDACTED]');
  assert.equal(safe.credentialRef,'cred:provider-a');
  assert.equal(safe.credentialApproved,true);
  assert.deepEqual(safe.usage,{prompt_tokens:10,total_tokens:15});
  assert.equal(safe.nested.authorization,'[REDACTED]');
});

test('EvidenceManager and ContextBus persist redacted content instead of secrets',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-redaction-'));
  try{
    const evidence=new EvidenceManager(path.join(root,'evidence'));
    await evidence.init();
    const written=await evidence.write('run-1','secret.json',{
      authorization:'Bearer abcdefghijklmnopqrst',
      message:'api_key=abcdefghijk-secret-value',
      credentialRef:'cred:a'
    });
    const firstEvent=await evidence.appendEvent('run-1',{type:'event',secret:'hidden-secret-value'});
    assert.equal(firstEvent.eventSha256.length,64);
    await evidence.appendEvent('run-1',{type:'later'});
    const firstLine=(await fs.readFile(firstEvent.file,'utf8')).split(/\r?\n/)[0];
    assert.equal(firstEvent.eventSha256,require('node:crypto').createHash('sha256').update(firstLine).digest('hex'));
    const context=new ContextBus(path.join(root,'context'));
    await context.init();
    const capsule=await context.write('result',{password:'password-secret-value',summary:'safe'});
    const persisted=[
      await fs.readFile(written.file,'utf8'),
      await fs.readFile(path.join(root,'evidence','run-1','events.jsonl'),'utf8'),
      await fs.readFile(path.join(root,'context','capsules',capsule.id+'.json'),'utf8')
    ].join('\n');
    assert.doesNotMatch(persisted,/abcdefghijklmnopqrst/);
    assert.doesNotMatch(persisted,/abcdefghijk-secret-value/);
    assert.doesNotMatch(persisted,/hidden-secret-value/);
    assert.doesNotMatch(persisted,/password-secret-value/);
    assert.match(persisted,/cred:a/);
    assert.match(persisted,/\[REDACTED\]/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('provider URLs reject embedded credentials at the network boundary',()=>{
  assert.throws(()=>safeNetworkUrl('https://user:password@example.test/v1'),/embedded credentials/);
  assert.equal(safeNetworkUrl('https://example.test/v1').hostname,'example.test');
  assert.equal(safeNetworkUrl('http://127.0.0.1:11434/v1').hostname,'127.0.0.1');
});

test('all operational persistence surfaces use centralized redaction',()=>{
  const root=path.resolve(__dirname,'..');
  const harness=fss.readFileSync(path.join(root,'electron','lib','harness.cjs'),'utf8');
  const autonomy=fss.readFileSync(path.join(root,'electron','lib','autonomy.cjs'),'utf8');
  const control=fss.readFileSync(path.join(root,'electron','lib','control-plane.cjs'),'utf8');
  const main=fss.readFileSync(path.join(root,'electron','main.cjs'),'utf8');
  assert.match(harness,/JSON\.stringify\(redactSensitive\(record\)/);
  assert.match(autonomy,/JSON\.stringify\(redactSensitive\(record\)/);
  assert.match(control,/JSON\.stringify\(redactSensitive\(this\.state\)/);
  assert.match(control,/const e=redactSensitive/);
  assert.match(main,/state\.json'\), redactSensitive\(state\)/);
  assert.match(main,/task\.json'\), redactSensitive\(task\)/);
  assert.match(main,/const event = redactSensitive/);
});


test('Control Plane runtime projections are redacted before UI or remote exposure',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-redacted-projection-'));
  try{
    const cp=new ControlPlane({rootDir:root});
    cp.state={
      schema:'aecp.control-plane/v1',
      updatedAt:new Date().toISOString(),
      runs:{r1:{id:'r1',state:'DONE',secret:'run-secret-value'}},
      tasks:{t1:{id:'t1',state:'DONE',result:{authorization:'Bearer abcdefghijklmnopqrst'}}},
      agents:{},approvals:{},locks:{}
    };
    const snapshot=cp.snapshot();
    assert.equal(snapshot.runs[0].secret,'[REDACTED]');
    assert.equal(snapshot.tasks[0].result.authorization,'[REDACTED]');
    assert.equal((await cp.getRun('r1')).secret,'[REDACTED]');
    assert.equal((await cp.getTask('t1')).result.authorization,'[REDACTED]');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
