'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const requirementsFile=path.join(root,'Blueprint','REQUIREMENTS.md');
const output=path.join(root,'artifacts','requirements-coverage.json');

const matrix={
  'R1.1':{classes:['STATIC','TESTED'],evidence:['Blueprint/06_DESKTOP_CHATGPT_INTEGRATION.md','tests/windows-desktop-adapter.test.cjs']},
  'R1.2':{classes:['STATIC','CI'],evidence:['scripts/acceptance-audit.cjs','electron/main.cjs']},
  'R1.3':{classes:['TESTED'],evidence:['tests/path-safety.test.cjs','tests/autonomy.test.cjs']},
  'R1.4':{classes:['STATIC','CI'],evidence:['electron/main.cjs','scripts/acceptance-audit.cjs']},
  'R1.5':{classes:['TESTED'],evidence:['tests/security-recovery-matrix.test.cjs']},
  'R2.1':{classes:['TESTED'],evidence:['tests/control-plane.test.cjs']},
  'R2.2':{classes:['TESTED'],evidence:['tests/harness.test.cjs','tests/provider-router.test.cjs']},
  'R2.3':{classes:['TESTED'],evidence:['tests/autonomy.test.cjs','tests/harness-bounds.test.cjs']},
  'R2.4':{classes:['TESTED'],evidence:['tests/autonomy.test.cjs','tests/harness.test.cjs','tests/harness-bounds.test.cjs']},
  'R2.5':{classes:['TESTED'],evidence:['tests/harness.test.cjs','tests/control-plane.test.cjs','tests/harness-bounds.test.cjs','tests/autonomy.test.cjs']},
  'R2.6':{classes:['TESTED'],evidence:['tests/control-plane.test.cjs']},
  'R2.7':{classes:['STATIC','TESTED'],evidence:['electron/lib/control-plane.cjs','scripts/acceptance-audit.cjs']},
  'R3.1':{classes:['TESTED'],evidence:['tests/provider-integration.test.cjs','tests/provider-router.test.cjs']},
  'R3.2':{classes:['TESTED'],evidence:['tests/provider-router.test.cjs','scripts/provider-environment-verify.cjs','tests/provider-environment-workflow.test.cjs']},
  'R3.3':{classes:['TESTED'],evidence:['tests/provider-integration.test.cjs','tests/provider-router.e2e.test.cjs','scripts/provider-environment-verify.cjs','tests/provider-environment-workflow.test.cjs']},
  'R3.4':{classes:['TESTED'],evidence:['tests/provider-router.test.cjs','scripts/provider-environment-verify.cjs','tests/provider-environment-workflow.test.cjs']},
  'R3.5':{classes:['TESTED'],evidence:['tests/security-recovery-matrix.test.cjs','tests/provider-network.e2e.test.cjs']},
  'R3.6':{classes:['STATIC','TESTED'],evidence:['electron/lib/provider-router.cjs','electron/lib/provider-usage.cjs','tests/provider-router.test.cjs','tests/provider-usage.test.cjs','tests/human-controls.test.cjs','scripts/provider-environment-verify.cjs','tests/provider-environment-workflow.test.cjs']},
  'R4.1':{classes:['TESTED'],evidence:['tests/canonical-loop.e2e.test.cjs','electron/lib/resource-manager.cjs']},
  'R4.2':{classes:['TESTED'],evidence:['tests/canonical-loop.e2e.test.cjs','tests/control-plane-infrastructure.test.cjs']},
  'R4.3':{classes:['STATIC','TESTED'],evidence:['electron/lib/delivery.cjs','tests/control-plane.test.cjs']},
  'R4.4':{classes:['TESTED'],evidence:['tests/control-plane-hardening.test.cjs']},
  'R4.5':{classes:['TESTED'],evidence:['tests/security-recovery-matrix.test.cjs','electron/lib/failure-recovery.cjs']},
  'R4.6':{classes:['STATIC','CI'],evidence:['electron/lib/control-plane.cjs','scripts/acceptance-audit.cjs']},
  'R5.1':{classes:['TESTED'],evidence:['tests/control-plane.test.cjs','tests/event-projection.test.cjs']},
  'R5.2':{classes:['TESTED'],evidence:['tests/canonical-loop.e2e.test.cjs','electron/lib/evidence-manager.cjs']},
  'R5.3':{classes:['TESTED'],evidence:['tests/event-projection.test.cjs','Blueprint/22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md']},
  'R5.4':{classes:['TESTED'],evidence:['tests/control-plane-hardening.test.cjs','electron/lib/maintenance.cjs']},
  'R5.5':{classes:['TESTED'],evidence:['tests/control-plane-hardening.test.cjs','electron/lib/dependency-drift-scanner.cjs']},
  'R6.1':{classes:['TESTED'],evidence:['tests/mcp-server.test.cjs']},
  'R6.2':{classes:['TESTED'],evidence:['tests/mcp-server.test.cjs','electron/mcp-server.mjs']},
  'R6.3':{classes:['TESTED'],evidence:['tests/remote-pairing.test.cjs']},
  'R6.4':{classes:['TESTED'],evidence:['tests/remote-pairing.test.cjs','tests/security-recovery-matrix.test.cjs']},
  'R6.5':{classes:['TESTED','OWNER/EXTERNAL'],evidence:['tests/remote-pairing.test.cjs','electron/lib/remote-gateway.cjs']},
  'R7.1':{classes:['CI'],evidence:['.github/workflows/ci.yml']},
  'R7.2':{classes:['CI','ENVIRONMENT'],evidence:['.github/workflows/ci.yml']},
  'R7.3':{classes:['CI'],evidence:['.github/workflows/release.yml','scripts/validate-store-package.ps1']},
  'R7.4':{classes:['STATIC','TESTED','OWNER/EXTERNAL'],evidence:['electron/lib/authenticode.cjs','tests/authenticode.test.cjs','.github/workflows/signed-release.yml','Blueprint/08_ROADMAP_ACCEPTANCE.md','Blueprint/23_IMPLEMENTATION_STATUS.md']},
  'R7.5':{classes:['TESTED'],evidence:['tests/human-controls.test.cjs','Blueprint/00_MASTER_BLUEPRINT.md']},
  'R8.1':{classes:['TESTED'],evidence:['tests/human-controls.test.cjs']},
  'R8.2':{classes:['STATIC','TESTED'],evidence:['ui/app.js','tests/i18n-accessibility.test.cjs']},
  'R8.3':{classes:['TESTED'],evidence:['tests/human-controls.test.cjs']},
  'R8.4':{classes:['STATIC','TESTED'],evidence:['ui/app.js','tests/human-controls.test.cjs']},
  'R8.5':{classes:['TESTED'],evidence:['tests/human-controls.test.cjs','tests/control-plane.test.cjs']}
};

const body=fs.readFileSync(requirementsFile,'utf8');
const ids=[...body.matchAll(/^-\s+\*\*(R\d+\.\d+)\*\*/gm)].map(m=>m[1]);
const unique=[...new Set(ids)];
const missingMappings=unique.filter(id=>!matrix[id]);
const staleMappings=Object.keys(matrix).filter(id=>!unique.includes(id));
const missingEvidence=[];

for(const [id,item] of Object.entries(matrix)){
  if(!Array.isArray(item.classes)||item.classes.length===0)missingEvidence.push({id,reason:'no evidence class'});
  if(!Array.isArray(item.evidence)||item.evidence.length===0)missingEvidence.push({id,reason:'no evidence files'});
  for(const file of item.evidence){
    if(!fs.existsSync(path.join(root,file)))missingEvidence.push({id,reason:'missing file',file});
  }
}

const report={
  schema:'aecp.requirements-coverage/v1',
  generatedAt:new Date().toISOString(),
  requirementCount:unique.length,
  mappedCount:unique.length-missingMappings.length,
  missingMappings,
  staleMappings,
  missingEvidence,
  requirements:unique.map(id=>({id,...matrix[id]}))
};

fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n','utf8');
process.stdout.write(JSON.stringify({
  schema:report.schema,
  requirementCount:report.requirementCount,
  mappedCount:report.mappedCount,
  missingMappings:report.missingMappings.length,
  staleMappings:report.staleMappings.length,
  missingEvidence:report.missingEvidence.length,
  output:'artifacts/requirements-coverage.json'
},null,2)+'\n');

if(missingMappings.length||staleMappings.length||missingEvidence.length)process.exitCode=1;
