'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const output=path.join(root,'artifacts','blueprint-coverage.json');

const matrix={
  '00_MASTER_BLUEPRINT.md':{type:'NORMATIVE',evidence:['Blueprint/REQUIREMENTS.md','scripts/acceptance-audit.cjs','electron/lib/control-plane.cjs']},
  '01_UX_UI_SPEC.md':{type:'FUNCTIONAL',evidence:['ui/index.html','ui/app.js','tests/i18n-accessibility.test.cjs','tests/human-controls.test.cjs']},
  '02_LOCAL_AGENT_HARNESS.md':{type:'FUNCTIONAL',evidence:['electron/lib/harness.cjs','electron/lib/control-plane.cjs','tests/harness.test.cjs','tests/canonical-loop.e2e.test.cjs']},
  '03_PROVIDER_ROUTER.md':{type:'FUNCTIONAL',evidence:['electron/lib/provider-router.cjs','tests/provider-router.test.cjs','tests/provider-router.e2e.test.cjs','tests/provider-network.e2e.test.cjs']},
  '04_SECURITY_AND_POLICY.md':{type:'FUNCTIONAL',evidence:['electron/lib/security-policy.cjs','electron/lib/adapter-security-audit.cjs','tests/security-recovery-matrix.test.cjs']},
  '05_GITHUB_MULTI_REPO.md':{type:'FUNCTIONAL',evidence:['electron/lib/resource-manager.cjs','electron/lib/delivery.cjs','electron/lib/ci-monitor.cjs','tests/canonical-loop.e2e.test.cjs']},
  '06_DESKTOP_CHATGPT_INTEGRATION.md':{type:'FUNCTIONAL',evidence:['electron/lib/windows-desktop-adapter.cjs','electron/lib/windows-ui-adapter.cjs','tests/windows-desktop-adapter.test.cjs','tests/windows-ui-adapter.test.cjs']},
  '07_INSTALL_RELEASE.md':{type:'FUNCTIONAL',evidence:['.github/workflows/ci.yml','.github/workflows/release.yml','.github/workflows/store-package.yml','.github/workflows/signed-release.yml','electron/lib/authenticode.cjs','tests/release-workflow.test.cjs','tests/authenticode.test.cjs']},
  '08_ROADMAP_ACCEPTANCE.md':{type:'NORMATIVE',evidence:['scripts/acceptance-audit.cjs','scripts/requirements-coverage.cjs','scripts/blueprint-coverage.cjs']},
  '09_RESEARCH_NOTES.md':{type:'INFORMATIONAL',evidence:['Blueprint/00_MASTER_BLUEPRINT.md']},
  '10_CONVERSATION_DECISION_LOG.md':{type:'HISTORICAL',evidence:['Blueprint/REQUIREMENTS.md','Blueprint/23_IMPLEMENTATION_STATUS.md']},
  '11_TASK_PROTOCOL.md':{type:'FUNCTIONAL',evidence:['electron/lib/protocol.cjs','tests/protocol.test.cjs']},
  '12_DATA_MODEL.md':{type:'FUNCTIONAL',evidence:['electron/lib/control-plane.cjs','electron/lib/state-migration.cjs','electron/lib/local-data-manager.cjs','tests/state-migration.test.cjs','tests/event-projection.test.cjs','tests/local-data-manager.test.cjs']},
  '13_TRIPLE_AUDIT.md':{type:'HISTORICAL',evidence:['Blueprint/23_IMPLEMENTATION_STATUS.md']},
  '14_GUIDED_UX_AND_GOAL_LOOP.md':{type:'FUNCTIONAL',evidence:['electron/lib/guidance.cjs','ui/app.js','tests/guidance.test.cjs','tests/human-controls.test.cjs']},
  '15_SELF_EVOLUTION_PRIVATE_UPDATE_AGENT_INTEROP.md':{type:'FUNCTIONAL',evidence:['electron/lib/update-state.cjs','electron/lib/authenticode.cjs','electron/lib/backup-manager.cjs','tests/update-state.test.cjs','tests/authenticode.test.cjs','tests/backup-manager.test.cjs','.github/workflows/release.yml','.github/workflows/signed-release.yml']},
  '16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md':{type:'FUNCTIONAL',evidence:['.github/workflows/store-package.yml','scripts/validate-store-package.ps1','electron/mcp-server.mjs','tests/human-controls.test.cjs','tests/mcp-server.test.cjs']},
  '17_V0_2_TRIPLE_AUDIT.md':{type:'HISTORICAL',evidence:['Blueprint/23_IMPLEMENTATION_STATUS.md']},
  '18_BOUNDED_AUTONOMOUS_EXECUTION.md':{type:'FUNCTIONAL',evidence:['electron/lib/autonomy.cjs','tests/autonomy.test.cjs']},
  '19_V0_3_TRIPLE_AUDIT.md':{type:'HISTORICAL',evidence:['Blueprint/23_IMPLEMENTATION_STATUS.md']},
  '20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md':{type:'FUNCTIONAL',evidence:['electron/lib/control-plane.cjs','electron/lib/harness.cjs','electron/lib/accepted-evidence.cjs','tests/control-plane.test.cjs','tests/canonical-loop.e2e.test.cjs','tests/harness-bounds.test.cjs','tests/accepted-evidence.test.cjs']},
  '21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md':{type:'FUNCTIONAL',evidence:['electron/lib/provider-router.cjs','electron/lib/harness.cjs','tests/provider-integration.test.cjs']},
  '22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md':{type:'FUNCTIONAL',evidence:['electron/lib/event-projection.cjs','ui/harness-console.js','tests/event-projection.test.cjs','tests/i18n-accessibility.test.cjs']},
  '23_IMPLEMENTATION_STATUS.md':{type:'NORMATIVE',evidence:['scripts/acceptance-audit.cjs','scripts/requirements-coverage.cjs','scripts/blueprint-coverage.cjs']},
  '24_LOCAL_MODEL_PROVIDER_VERIFICATION.md':{type:'FUNCTIONAL',evidence:['electron/lib/provider-router.cjs','electron/lib/provider-usage.cjs','scripts/provider-environment-verify.cjs','.github/workflows/provider-environment.yml','tests/provider-router.test.cjs','tests/provider-usage.test.cjs','tests/provider-router.e2e.test.cjs','tests/provider-integration.test.cjs','tests/provider-environment-workflow.test.cjs'],external:['self-hosted aecp-provider machine with actual Ollama/OpenCode/model artifacts and optional company worker']}
};

const blueprintDir=path.join(root,'Blueprint');
const actual=fs.readdirSync(blueprintDir)
  .filter(name=>/^(?:0\d|1\d|2[0-4])_.*\.md$/.test(name))
  .sort();

const expected=Object.keys(matrix).sort();
const untracked=actual.filter(name=>!matrix[name]);
const missingBlueprints=expected.filter(name=>!actual.includes(name));
const missingEvidence=[];

for(const [name,item] of Object.entries(matrix)){
  if(!['FUNCTIONAL','NORMATIVE','HISTORICAL','INFORMATIONAL'].includes(item.type)){
    missingEvidence.push({blueprint:name,reason:'invalid type',value:item.type});
  }
  if(!Array.isArray(item.evidence)||item.evidence.length===0){
    missingEvidence.push({blueprint:name,reason:'no evidence'});
    continue;
  }
  for(const file of item.evidence){
    if(!fs.existsSync(path.join(root,file)))missingEvidence.push({blueprint:name,reason:'missing evidence file',file});
  }
}

const report={
  schema:'aecp.blueprint-coverage/v1',
  generatedAt:new Date().toISOString(),
  expectedBlueprints:expected.length,
  discoveredBlueprints:actual.length,
  coveredBlueprints:expected.length-missingBlueprints.length,
  untracked,
  missingBlueprints,
  missingEvidence,
  blueprints:expected.map(name=>({name,...matrix[name]}))
};

fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n','utf8');
process.stdout.write(JSON.stringify({
  schema:report.schema,
  expectedBlueprints:report.expectedBlueprints,
  discoveredBlueprints:report.discoveredBlueprints,
  coveredBlueprints:report.coveredBlueprints,
  untracked:report.untracked.length,
  missingBlueprints:report.missingBlueprints.length,
  missingEvidence:report.missingEvidence.length,
  output:'artifacts/blueprint-coverage.json'
},null,2)+'\n');

if(untracked.length||missingBlueprints.length||missingEvidence.length)process.exitCode=1;
