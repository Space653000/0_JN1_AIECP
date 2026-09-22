'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {ProviderUsageStore,normalizeMetric}=require('../electron/lib/provider-usage.cjs');
const {ProviderRouter}=require('../electron/lib/provider-router.cjs');

test('provider usage normalization stores only whitelisted metadata',()=>{
  const metric=normalizeMetric({
    provider:'company',
    role:'planner',
    model:'model-a',
    success:true,
    code:0,
    latencyMs:123,
    usage:{
      prompt_tokens:10,
      completion_tokens:5,
      total_tokens:15,
      cost_usd:0.01,
      prompt:'DO_NOT_STORE',
      response:'DO_NOT_STORE',
      nested:{input_tokens:7,secret:'DO_NOT_STORE'}
    },
    prompt:'TOP SECRET',
    response:'TOP SECRET',
    apiKey:'sk-secret'
  });
  assert.deepEqual(metric.usage,{
    prompt_tokens:10,
    completion_tokens:5,
    total_tokens:15,
    cost_usd:0.01,
    nested:{input_tokens:7}
  });
  const serialized=JSON.stringify(metric);
  assert.doesNotMatch(serialized,/DO_NOT_STORE|TOP SECRET|sk-secret/);
});

test('provider usage store serializes concurrent appends without losing records',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-provider-usage-'));
  try{
    const file=path.join(root,'provider-usage.json');
    const store=new ProviderUsageStore(file,{maxRecords:500});
    await Promise.all(Array.from({length:40},(_,i)=>store.append({
      provider:i%2?'ollama':'codex',
      role:i%2?'reviewer':'builder',
      model:i%2?'qwen3-coder:30b':'code-model',
      success:i%5!==0,
      code:i%5===0?1:0,
      latencyMs:100+i,
      usage:{total_tokens:i+1},
      recordedAt:new Date(1700000000000+i*1000).toISOString()
    })));
    const raw=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(raw.schema,'aecp.provider-usage-store/v1');
    assert.equal(raw.records.length,40);
    const summaries=await store.summaries();
    assert.equal(summaries.codex.requests,20);
    assert.equal(summaries.ollama.requests,20);
    assert.equal(summaries.codex.successes+summaries.codex.failures,20);
    assert.equal(summaries.ollama.successes+summaries.ollama.failures,20);
    assert.ok(summaries.codex.averageLatencyMs>0);
    assert.ok(summaries.ollama.numericTotals.total_tokens>0);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('provider usage store enforces bounded retention',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-provider-retention-'));
  try{
    const store=new ProviderUsageStore(path.join(root,'usage.json'),{maxRecords:100});
    for(let i=0;i<130;i++){
      await store.append({provider:'local',role:'builder',success:true,code:0,latencyMs:i});
    }
    const state=await store.load();
    assert.equal(state.records.length,100);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('ProviderRouter emits usage metrics without prompt or response bodies',async()=>{
  const metrics=[];
  const runner=async()=>({code:0,stdout:'RESULT_BODY',stderr:'',timedOut:false,aborted:false});
  const router=new ProviderRouter({
    local:{command:'trusted-worker',args:['--bounded'],roles:['builder'],mode:'local-command'}
  },{runner,metricsSink:async(metric)=>metrics.push(metric)});
  const result=await router.execute('builder','SECRET_PROMPT',{provider:'local',cwd:'C:/repo'});
  assert.equal(result.code,0);
  assert.equal(metrics.length,1);
  const serialized=JSON.stringify(metrics[0]);
  assert.doesNotMatch(serialized,/SECRET_PROMPT|RESULT_BODY/);
  assert.equal(metrics[0].provider,'local');
  assert.equal(metrics[0].role,'builder');
  assert.equal(metrics[0].success,true);
  assert.ok(metrics[0].latencyMs>=0);
});

test('ProviderRouter emits a bounded failure metric when invocation throws',async()=>{
  const metrics=[];
  const runner=async()=>{throw Object.assign(new Error('PRIVATE_FAILURE_DETAIL'),{code:'SPAWN_FAILED'});};
  const router=new ProviderRouter({
    local:{command:'trusted-worker',args:[],roles:['builder'],mode:'local-command'}
  },{runner,metricsSink:async(metric)=>metrics.push(metric)});
  await assert.rejects(()=>router.execute('builder','SECRET_PROMPT',{provider:'local'}),/PRIVATE_FAILURE_DETAIL/);
  assert.equal(metrics.length,1);
  assert.equal(metrics[0].success,false);
  assert.equal(metrics[0].code,'SPAWN_FAILED');
  assert.doesNotMatch(JSON.stringify(metrics[0]),/PRIVATE_FAILURE_DETAIL|SECRET_PROMPT/);
});
