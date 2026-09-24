'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {runFaultStage}=require('../scripts/provider-environment-verify.cjs');

function routerFor({failPega=true,failOfficial=false,fallback=false}={}){
  return {
    health:async()=>({status:'READY'}),
    execute:async(_role,prompt,{provider})=>{
      const workerId=provider==='pega'?'codex-pega':'codex-official';
      const failed=provider==='pega'?failPega:failOfficial;
      return {code:failed?1:0,workerId:fallback&&provider==='pega'?'codex-official':workerId,
        stdout:failed?'':prompt.match(/AECP_FAULT_[A-Z_]+/)[0]};
    }
  };
}

async function fixture(fn){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-fault-test-'));
  try{return await fn({name:'pega-failure',router:routerFor(),registryRoot:path.join(root,'registry'),
    officialHome:path.join(root,'official'),pegaHome:path.join(root,'pega'),failWorker:'codex-pega'});}
  finally{await fs.rm(root,{recursive:true,force:true});}
}

test('expected PEGA failure is isolated and registry records FAILED versus IDLE',async()=>{
  const result=await fixture(runFaultStage);
  assert.equal(result.pass,true);
  assert.equal(result.pega.registryState,'FAILED');
  assert.equal(result.official.registryState,'IDLE');
  assert.equal(result.official.health,'READY');
});

test('failure spillover to the healthy worker fails isolation',async()=>{
  const result=await fixture(input=>runFaultStage({...input,router:routerFor({failOfficial:true})}));
  assert.equal(result.pass,false);
});

test('silent fallback or shared home fails isolation',async()=>{
  const fallback=await fixture(input=>runFaultStage({...input,router:routerFor({fallback:true})}));
  assert.equal(fallback.pass,false);
  await assert.rejects(fixture(input=>runFaultStage({...input,pegaHome:input.officialHome})));
});
