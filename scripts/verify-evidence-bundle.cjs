'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {redactText,SECRET_KEY}=require('../electron/lib/redaction.cjs');

const SHA=/^[0-9a-f]{40}$/i;
const HASH=/^[0-9a-f]{64}$/i;
const ARCHES=new Set(['any','x64','arm64']);
const STATUSES=new Set(['PASS','FAIL']);

function secretLocations(value,at='$',found=[]){
  if(Array.isArray(value))value.forEach((item,index)=>secretLocations(item,`${at}[${index}]`,found));
  else if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      if(SECRET_KEY.test(key)&&typeof item==='string'&&item)found.push(`${at}.${key}`);
      secretLocations(item,`${at}.${key}`,found);
    }
  }else if(typeof value==='string'&&redactText(value)!==value)found.push(at);
  return found;
}

function verifyEvidence(evidence,{expectSha,expectMode=null,expectArch=null}={}){
  const results=[];
  const add=(name,valid,reason)=>results.push({name,status:valid?'PASS':'FAIL',reason:valid?'ok':reason});
  const checks=Array.isArray(evidence?.checks)?evidence.checks:[];
  add('schema',evidence?.schema==='aecp.provider-environment-evidence/v1','wrong provider evidence schema');
  add('sourceCommit',SHA.test(evidence?.sourceCommit||'')&&evidence.sourceCommit.toLowerCase()===expectSha?.toLowerCase(),'source SHA missing or different');
  add('mode',typeof evidence?.mode==='string'&&evidence.mode.length>0&&(!expectMode||evidence.mode===expectMode),'mode missing or different');
  const archValid=['x64','arm64'].includes(evidence?.arch)&&ARCHES.has(evidence?.expectedArch)&&
    (!expectArch||evidence.expectedArch===expectArch)&&
    (evidence.expectedArch==='any'||evidence.arch===evidence.expectedArch);
  add('architecture',archValid,'runtime/expected architecture mismatch');
  add('summary',evidence?.summary?.failed===0&&Number.isInteger(evidence.summary?.requested)&&
    evidence.summary.requested===checks.length&&evidence.summary.passed===checks.length&&
    checks.every(item=>item&&STATUSES.has(item.status)&&item.status==='PASS'),
    'summary failed or checks are not all PASS');
  const privacy=evidence?.privacy;
  add('privacy',privacy?.promptBodiesPersisted===false&&privacy?.responseBodiesPersisted===false&&
    privacy?.credentialsPersisted===false,'privacy flags must all be false');
  const secrets=secretLocations(evidence);
  add('secret-scan',secrets.length===0,`secret-like content at ${secrets.join(', ')}`);

  function worker(item,label){
    add(label,typeof item?.workerId==='string'&&item.workerId.length>0&&
      typeof item?.model==='string'&&item.model.length>0&&typeof item?.health==='string'&&item.health.length>0&&
      HASH.test(item?.codexHomeSha256||''),`${label} identity/model/health/home hash missing`);
    if(item?.fileVerifier!==undefined)fileVerifier(item.fileVerifier,`${label}.fileVerifier`);
  }
  function fileVerifier(item,label){
    add(label,typeof item?.path==='string'&&item.path.length>0&&!path.isAbsolute(item.path)&&
      !item.path.includes('..')&&HASH.test(item.sha256||'')&&item.expectedSha256Match===true,
      `${label} missing or hash mismatch`);
  }
  for(const check of checks){
    if(check.id==='codex-official.real-smoke'||check.id==='codex-pega.real-smoke'){
      worker(check,check.id);
      fileVerifier(check.fileVerifier,`${check.id}.requiredFileVerifier`);
    }
    if(check.id==='local-command.real-smoke')fileVerifier(check.fileVerifier,'local-command.requiredFileVerifier');
    if(check.id==='codex.multi-worker-real-concurrency'){
      const items=check.workers;
      add('multi-codex.workers',Array.isArray(items)&&items.length===2,'two workers required');
      if(Array.isArray(items))items.forEach((item,index)=>worker(item,`multi-codex.worker${index}`));
      add('multi-codex.isolation',Array.isArray(items)&&items.length===2&&
        items[0]?.codexHomeSha256!==items[1]?.codexHomeSha256&&
        check.distinctCodexHomes===true&&check.distinctWorktrees===true&&check.distinctProcesses===true,
        'Codex homes/worktrees/processes not distinct');
    }
  }
  if(evidence?.mode==='codex-fault-isolation'){
    const isolation=checks.find(item=>item.id==='codex.fault-isolation');
    const recovery=checks.find(item=>item.id==='recovery');
    const stages=isolation?.stages;
    add('fault.stages',Array.isArray(stages)&&stages.length===2&&
      stages[0]?.expectedFailure==='codex-pega'&&stages[1]?.expectedFailure==='codex-official',
      'two ordered fault stages required');
    if(Array.isArray(stages))for(const [index,stage] of stages.entries()){
      const expected=stage.expectedFailure;
      const failed=expected==='codex-pega'?stage.pega:stage.official;
      const healthy=expected==='codex-pega'?stage.official:stage.pega;
      add(`fault.stage${index}`,stage.pass===true&&stage.distinctHomes===true&&
        failed?.workerId===expected&&failed?.status==='FAIL'&&failed.noFallback===true&&
        ['FAILED','UNKNOWN'].includes(failed.registryState)&&
        healthy?.workerId===(expected==='codex-pega'?'codex-official':'codex-pega')&&
        healthy.status==='PASS'&&healthy.health==='READY'&&healthy.registryState==='IDLE'&&healthy.noFallback===true,
        'failure not isolated or registry/health/fallback invalid');
    }
    const protection=isolation?.protection;
    add('fault.protection',protection&&[
      'realOfficialAuthUnchangedInStageB','pegaAuthAbsentThroughout','pegaConfigMatchesPrepared',
      'distinctRealHomes','scratchOfficialHomeDistinct','noFallback'
    ].every(key=>protection[key]===true)&&
      JSON.stringify(isolation.authBeforeStageB)===JSON.stringify(isolation.authAfterStageB)&&
      HASH.test(isolation.pegaConfigSha256||''),
      'home protection assertion missing or false');
    add('fault.recovery',recovery?.status==='PASS'&&recovery.official?.health==='READY'&&
      recovery.pega?.health==='READY','both real workers must recover to READY');
  }
  return {results,passed:results.every(item=>item.status==='PASS'),
    provenance:evidence?.workflowProvenance?'WORKFLOW':'LOCAL_SCRIPT'};
}

function parseArgs(argv){
  const files=[];const options={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg.startsWith('--')){
      if(!['--expect-sha','--expect-mode','--expect-arch'].includes(arg)||i+1>=argv.length)throw new Error('Invalid option.');
      options[arg.slice(2).replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]=argv[++i];
    }else files.push(arg);
  }
  if(!files.length||!SHA.test(options.expectSha||''))throw new Error('At least one JSON path and --expect-sha <40 hex> are required.');
  if(options.expectArch&&!ARCHES.has(options.expectArch))throw new Error('Invalid expected architecture.');
  return {files,options};
}

function main(argv){
  let input;
  try{input=parseArgs(argv);}catch(error){process.stderr.write(`FAIL arguments: ${error.message}\n`);return 1;}
  let failed=false;
  for(const file of input.files){
    try{
      const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
      const report=verifyEvidence(evidence,input.options);
      process.stdout.write(`FILE ${file}\nPROVENANCE: ${report.provenance}${report.provenance==='LOCAL_SCRIPT'?'（非 workflow PASS）':'（須外部核對 run）'}\n`);
      for(const item of report.results)process.stdout.write(`${item.status} ${item.name}: ${item.reason}\n`);
      if(!report.passed)failed=true;
    }catch(error){process.stdout.write(`FAIL ${file}: unreadable or invalid JSON (${error.code||'PARSE_ERROR'})\n`);failed=true;}
  }
  return failed?1:0;
}

if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={verifyEvidence,parseArgs,secretLocations};
