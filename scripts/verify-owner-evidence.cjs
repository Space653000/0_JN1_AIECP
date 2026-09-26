'use strict';

const fs=require('node:fs');
const {secretLocations}=require('./verify-evidence-bundle.cjs');

const SHA=/^[0-9a-f]{40}$/i;
const HASH=/^[0-9a-f]{64}$/i;
const TYPES={
  'aecp.owner-evidence.arm64-ui-smoke/v1':[
    'packagingChecksumMatches','nodeArchArm64','installed','launchedWithoutCrash',
    'dashboardEightQuestionsVisible','workspaceSelected','inspectWorkspaceCardPassed',
    'stopAllEffective','uninstalledCleanly'
  ],
  'aecp.owner-evidence.laptop-verifier-safety/v1':[
    'openCodeCliInstalled','codexCliInstalled','oneTimeTestRepoUsed','localAutonomousRan',
    'runManifestCaptured','verifiedPatchCaptured','verifierOutputCaptured','patchOnlyInWorktree',
    'sourceUnchangedBeforeApply','verifierDeterminedResult','verifierNoExternalNetwork',
    'verifierNoOutsideWrites','verifierNoDeletion'
  ],
  'aecp.owner-evidence.official-full-mcp/v1':[
    'supportedWorkspaceUsed','tunnelConnectorHealthy','readToolEventRecorded',
    'unapprovedWriteDenied','approvedWriteSucceeded','disconnectSafeBridgeFallback'
  ],
  'aecp.owner-evidence.safe-bridge-during-fault/v1':[
    'safeBridgeAvailableDuringPegaFailure','safeBridgeAvailableDuringOfficialFailure',
    'inspectWorkspaceCardPassedDuringFault','bothWorkersRecoveredReady'
  ],
  'aecp.owner-evidence.manual-ui-acceptance/v1':[
    'contrastLightTheme45','contrastDarkTheme45','statusNotColorOnly','scaling125','scaling150','scaling200',
    'layout1366x768','layout1920x1080','brandProminence','screenReaderSixViews','officialBrowserExternalized',
    'harnessSixViewsWithData','harnessSixViewsUnknown','stopAllWorks','productCohesion'
  ]
};

function placeholders(value,at='$',found=[]){
  if(Array.isArray(value))value.forEach((item,index)=>placeholders(item,`${at}[${index}]`,found));
  else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))placeholders(item,`${at}.${key}`,found);
  else if(typeof value==='string'&&value.includes('<placeholder>'))found.push(at);
  return found;
}

function verifyOwnerEvidence(evidence,{expectSha}={}){
  const results=[];
  const add=(name,pass,reason)=>results.push({name,status:pass?'PASS':'FAIL',reason:pass?'ok':reason});
  const fields=TYPES[evidence?.schema];
  add('schema',Boolean(fields),'unknown owner evidence schema');
  add('sourceCommit',SHA.test(evidence?.sourceCommit||'')&&evidence.sourceCommit.toLowerCase()===expectSha?.toLowerCase(),
    'source SHA missing or different');
  add('date',typeof evidence?.date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(evidence.date)&&
    !Number.isNaN(Date.parse(evidence.date)),'date missing or invalid');
  add('machine',typeof evidence?.machine?.id==='string'&&evidence.machine.id.length>0&&
    ['x64','arm64'].includes(evidence.machine.arch)&&
    (evidence.schema!=='aecp.owner-evidence.arm64-ui-smoke/v1'||evidence.machine.arch==='arm64'),
    'machine identity or architecture invalid');
  const att=evidence?.operatorAttestation;
  add('operatorAttestation',typeof att?.name==='string'&&att.name.length>0&&
    typeof att?.statement==='string'&&att.statement.length>0&&
    typeof att?.signedAt==='string'&&!Number.isNaN(Date.parse(att.signedAt)),
    'operator attestation missing');
  if(fields)for(const key of fields){
    const item=evidence?.checklist?.[key];
    add(`checklist.${key}`,item?.passed===true&&typeof item.note==='string'&&item.note.length>0,
      'required checklist item not true or note missing');
  }
  const artifacts=evidence?.artifacts;
  const required=evidence?.schema==='aecp.owner-evidence.arm64-ui-smoke/v1'
    ?['installer','screenshots']
    :evidence?.schema==='aecp.owner-evidence.laptop-verifier-safety/v1'
      ?['runManifest','verifiedPatch','verifierOutput']
      :evidence?.schema==='aecp.owner-evidence.safe-bridge-during-fault/v1'
        ?['providerEvidence']
        :evidence?.schema==='aecp.owner-evidence.manual-ui-acceptance/v1'
          ?['installer','screenshots']:['eventLedger','tunnelHealth'];
  for(const key of required){
    const value=artifacts?.[key];
    const items=Array.isArray(value)?value:[value];
    add(`artifacts.${key}`,items.length>0&&items.every(item=>
      typeof item?.fileName==='string'&&item.fileName.length>0&&HASH.test(item.sha256||'')),
      'artifact file name or SHA-256 missing');
  }
  if(evidence?.schema==='aecp.owner-evidence.arm64-ui-smoke/v1'){
    add('installerChecksum',HASH.test(artifacts?.installer?.checksumSha256||'')&&
      artifacts.installer.sha256===artifacts.installer.checksumSha256,
      'installer SHA-256 does not match published checksum');
  }
  if(evidence?.schema==='aecp.owner-evidence.official-full-mcp/v1'){
    add('workspaceType',['Business','Enterprise','Edu'].includes(evidence.workspaceType),
      'unsupported ChatGPT workspace type');
    const ids=Object.values(evidence.eventIds||{});
    add('eventIds',['connectorHealth','readTool','writeDenied','writeApproved','safeBridgeFallback']
      .every(key=>typeof evidence.eventIds?.[key]==='string'&&evidence.eventIds[key].length>0)&&
      new Set(ids).size===ids.length,'required distinct event ledger ids missing');
  }
  const missing=placeholders(evidence);
  add('placeholders',missing.length===0,`unfilled values at ${missing.join(', ')}`);
  const secrets=secretLocations(evidence);
  add('secret-scan',secrets.length===0,`secret-like content at ${secrets.join(', ')}`);
  return {results,passed:results.every(item=>item.status==='PASS')};
}

function main(argv){
  const index=argv.indexOf('--expect-sha');
  if(index<0||!SHA.test(argv[index+1]||'')){
    process.stderr.write('FAIL arguments: --expect-sha <40 hex> required.\n');return 1;
  }
  const expectSha=argv[index+1];
  const files=argv.filter((_,i)=>i!==index&&i!==index+1);
  if(!files.length||files.some(file=>file.startsWith('--'))){process.stderr.write('FAIL arguments: JSON paths required.\n');return 1;}
  let failed=false;
  for(const file of files){
    try{
      const report=verifyOwnerEvidence(JSON.parse(fs.readFileSync(file,'utf8')),{expectSha});
      process.stdout.write(`FILE ${file}\n`);
      for(const item of report.results)process.stdout.write(`${item.status} ${item.name}: ${item.reason}\n`);
      if(!report.passed)failed=true;
    }catch(error){process.stdout.write(`FAIL ${file}: unreadable or invalid JSON (${error.code||'PARSE_ERROR'})\n`);failed=true;}
  }
  return failed?1:0;
}

if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={verifyOwnerEvidence,TYPES,placeholders};
