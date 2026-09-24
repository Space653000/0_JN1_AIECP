'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeThumbprint,inspectAuthenticode,verifyAuthenticode}=require('../electron/lib/authenticode.cjs');

test('normalizes signer thumbprints deterministically',()=>{
  assert.equal(normalizeThumbprint('aa bb:cc-dd'),'AABBCCDD');
});

test('preview mode does not require Authenticode when no signer pin exists',async()=>{
  let called=false;
  const result=await verifyAuthenticode('installer.exe',{requiredThumbprint:'',runner:async()=>{called=true;return '{}';}});
  assert.equal(result.required,false);
  assert.equal(result.status,'NOT_REQUIRED');
  assert.equal(called,false);
});

test('pinned Authenticode signer accepts a valid matching signature',async()=>{
  const runner=async()=>JSON.stringify({
    Status:'Valid',
    StatusMessage:'Signature verified.',
    SignerThumbprint:'aa bb cc dd',
    SignerSubject:'CN=AECP',
    TimeStamperThumbprint:'11 22'
  });
  const result=await verifyAuthenticode('installer.exe',{requiredThumbprint:'AABBCCDD',runner});
  assert.equal(result.required,true);
  assert.equal(result.status,'Valid');
  assert.equal(result.signerThumbprint,'AABBCCDD');
  assert.equal(result.timeStamperThumbprint,'1122');
});

test('pinned Authenticode signer rejects a valid signature from the wrong certificate',async()=>{
  const runner=async()=>JSON.stringify({
    Status:'Valid',
    SignerThumbprint:'DEADBEEF',
    SignerSubject:'CN=Other'
  });
  await assert.rejects(
    ()=>verifyAuthenticode('installer.exe',{requiredThumbprint:'AABBCCDD',runner}),
    error=>error?.code==='AUTHENTICODE_SIGNER_MISMATCH'
  );
});

test('pinned Authenticode signer rejects invalid signature status',async()=>{
  const runner=async()=>JSON.stringify({
    Status:'HashMismatch',
    StatusMessage:'The file changed after signing.',
    SignerThumbprint:'AABBCCDD'
  });
  await assert.rejects(
    ()=>verifyAuthenticode('installer.exe',{requiredThumbprint:'AABBCCDD',runner}),
    error=>error?.code==='AUTHENTICODE_INVALID'
  );
});

test('Authenticode inspection emits signer evidence from PowerShell JSON',async()=>{
  let script='';
  const result=await inspectAuthenticode("C:/AECP/O'Brien.exe",{runner:async s=>{
    script=s;
    return JSON.stringify({Status:'Valid',SignerThumbprint:'ABCD',SignerSubject:'CN=AECP'});
  }});
  assert.match(script,/Get-AuthenticodeSignature/);
  assert.match(script,/O''Brien\.exe/);
  assert.equal(result.signerThumbprint,'ABCD');
});
