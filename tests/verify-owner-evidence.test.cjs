'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verifyOwnerEvidence,TYPES}=require('../scripts/verify-owner-evidence.cjs');

const sha='a'.repeat(40);
const root=path.join(__dirname,'..','samples','owner-evidence');
const names=['arm64-ui-smoke','laptop-verifier-safety','official-full-mcp'];
const load=name=>JSON.parse(fs.readFileSync(path.join(root,`${name}.template.json`),'utf8'));

function filled(name){
  const evidence=load(name);
  evidence.sourceCommit=sha;
  evidence.date='2026-09-24';
  evidence.machine.id='test-device';
  evidence.machine.arch=name==='arm64-ui-smoke'?'arm64':'x64';
  evidence.operatorAttestation={name:'Test Operator',statement:'I reviewed the evidence.',signedAt:'2026-09-24T08:00:00Z'};
  for(const item of Object.values(evidence.checklist)){item.passed=true;item.note='Checked on test device.';}
  for(const [key,value] of Object.entries(evidence.artifacts)){
    for(const item of (Array.isArray(value)?value:[value])){
      item.fileName=`${key}.json`;item.sha256='b'.repeat(64);
      if('checksumSha256' in item)item.checksumSha256='b'.repeat(64);
    }
  }
  if(name==='official-full-mcp'){
    evidence.workspaceType='Business';
    let i=0;for(const key of Object.keys(evidence.eventIds))evidence.eventIds[key]=`event-${++i}`;
  }
  return evidence;
}

for(const name of names){
  test(`${name} filled record passes and unfilled template fails`,()=>{
    assert.ok(TYPES[load(name).schema]);
    assert.equal(verifyOwnerEvidence(load(name),{expectSha:sha}).passed,false);
    assert.equal(verifyOwnerEvidence(filled(name),{expectSha:sha}).passed,true);
  });
}

test('any false checklist item fails',()=>{
  const evidence=filled('arm64-ui-smoke');
  evidence.checklist.stopAllEffective.passed=false;
  assert.equal(verifyOwnerEvidence(evidence,{expectSha:sha}).passed,false);
});

test('remaining placeholder fails even when checklist says true',()=>{
  const evidence=filled('laptop-verifier-safety');
  evidence.operatorAttestation.statement='<placeholder>';
  assert.equal(verifyOwnerEvidence(evidence,{expectSha:sha}).passed,false);
});

test('wrong SHA or secret-like content fails',()=>{
  const evidence=filled('official-full-mcp');
  assert.equal(verifyOwnerEvidence(evidence,{expectSha:'c'.repeat(40)}).passed,false);
  evidence.operatorAttestation.statement='Bearer abcdefghi123456';
  assert.equal(verifyOwnerEvidence(evidence,{expectSha:sha}).passed,false);
});

test('CLI rejects the unfilled owner template',()=>{
  const file=path.join(root,'arm64-ui-smoke.template.json');
  const original=fs.readFileSync(file,'utf8');
  const result=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','verify-owner-evidence.cjs'),file,'--expect-sha',sha],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(fs.readFileSync(file,'utf8'),original);
});
