'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const roadmapPath=path.join(root,'Blueprint','08_ROADMAP_ACCEPTANCE.md');
const outPath=path.join(root,'artifacts','roadmap-gates.json');
const exists=(p)=>fs.existsSync(path.join(root,p));
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const phaseEvidence={
  'P0':['electron/main.cjs','ui/index.html','ui/app.js','tests/human-controls.test.cjs','tests/i18n-accessibility.test.cjs'],
  'P1':['ui/app.js','tests/protocol.test.cjs','tests/human-controls.test.cjs'],
  'P2':['electron/lib/security-policy.cjs','tests/path-safety.test.cjs','tests/harness.test.cjs','tests/security-recovery-matrix.test.cjs'],
  'P3':['electron/lib/resource-manager.cjs','electron/lib/lock-manager.cjs','tests/control-plane-infrastructure.test.cjs','tests/autonomy.test.cjs'],
  'P4':['electron/lib/provider-router.cjs','tests/provider-router.test.cjs','tests/provider-integration.test.cjs','tests/provider-network.e2e.test.cjs'],
  'P4.5':['ui/app.js','tests/human-controls.test.cjs'],
  'P4.6':['electron/lib/autonomy.cjs','tests/autonomy.test.cjs'],
  'P4.7':['electron/lib/control-plane.cjs','electron/lib/harness.cjs','tests/canonical-loop.e2e.test.cjs','tests/control-plane.test.cjs','tests/event-projection.test.cjs','tests/delivery-reconciliation.test.cjs'],
  'P5':['electron/lib/windows-desktop-adapter.cjs','electron/lib/windows-ui-adapter.cjs','electron/lib/python-worker.cjs','tests/windows-desktop-adapter.test.cjs','tests/windows-ui-adapter.test.cjs','tests/python-worker.test.cjs'],
  'P6':['electron/lib/remote-gateway.cjs','electron/lib/pairing.cjs','tests/remote-pairing.test.cjs'],
  'P6.5':['.github/workflows/ci.yml','.github/workflows/store-package.yml','scripts/validate-store-package.ps1','release/store/README.md','tests/release-workflow.test.cjs'],
  'P7':['tests/backup-manager.test.cjs','tests/state-migration.test.cjs','tests/update-state.test.cjs','tests/i18n-accessibility.test.cjs','scripts/license-audit.cjs','.github/workflows/ci.yml','.github/workflows/release.yml','.github/workflows/signed-release.yml','tests/authenticode.test.cjs','README.md']
};

const phaseAssertions={
  'P0':[
    ['electron/main.cjs',/contextIsolation\s*:\s*true/,'context isolation'],
    ['tests/human-controls.test.cjs',/Workspace authorization is explicit/,'explicit Workspace authorization']
  ],
  'P1':[
    ['tests/human-controls.test.cjs',/clipboard bridge remains explicit user-triggered/,'explicit clipboard bridge'],
    ['tests/protocol.test.cjs',/unsupported action capabilities|rejects unsupported/i,'invalid/unsupported card rejection']
  ],
  'P2':[
    ['tests/path-safety.test.cjs',/rejects sibling\/outside path/,'Workspace path rejection'],
    ['electron/lib/harness.cjs',/async function verify\(worktree, command, args, signal\)/,'deterministic verification']
  ],
  'P3':[
    ['electron/lib/resource-manager.cjs',/async scan\(root\)/,'repository discovery'],
    ['electron/lib/resource-manager.cjs',/bindTask\(task,/,'task resource binding'],
    ['tests/autonomy.test.cjs',/isolates writes in worktree/,'isolated worktree mutation']
  ],
  'P4':[
    ['tests/provider-router.test.cjs',/provider registry exposes vendor-neutral roles/i,'provider registry'],
    ['tests/provider-network.e2e.test.cjs',/NETWORK|CREDENTIAL/,'network/credential policy']
  ],
  'P4.5':[
    ['tests/human-controls.test.cjs',/Execution Mode recommendation is factual/,'execution mode readiness'],
    ['ui/app.js',/Official Full MCP/,'Full MCP mode card'],
    ['ui/app.js',/Local Autonomous/,'Local Autonomous mode card']
  ],
  'P4.6':[
    ['tests/autonomy.test.cjs',/isolates writes in worktree/,'worktree isolation'],
    ['tests/autonomy.test.cjs',/explicit apply/i,'explicit apply gate'],
    ['electron/lib/autonomy.cjs',/maxIterations/,'bounded iteration count']
  ],
  'P4.7':[
    ['tests/canonical-loop.e2e.test.cjs',/canonical loop/i,'canonical loop E2E'],
    ['tests/delivery-reconciliation.test.cjs',/ambiguous command failure|lost response/,'delivery reconciliation']
  ],
  'P5':[
    ['tests/windows-ui-adapter.test.cjs',/browser automation inspection is deny-by-default/,'browser deny-by-default'],
    ['tests/windows-ui-adapter.test.cjs',/window docking requires explicit SYSTEM approval/,'SYSTEM-gated docking']
  ],
  'P6':[
    ['tests/remote-pairing.test.cjs',/one-time pairing and revocation/,'pair/revoke'],
    ['tests/remote-pairing.test.cjs',/TLS remote gateway/,'encrypted remote transport'],
    ['tests/remote-pairing.test.cjs',/cannot submit tasks/,'remote task submission denied']
  ],
  'P6.5':[
    ['.github/workflows/ci.yml',/package-store:/,'PR Store package lane'],
    ['.github/workflows/store-package.yml',/aecp\.store-provenance\/v1/,'owner Store provenance']
  ],
  'P7':[
    ['.github/workflows/ci.yml',/smoke-upgrade-rollback:/,'upgrade/rollback smoke'],
    ['tests/i18n-accessibility.test.cjs',/Traditional Chinese|localization/i,'localization/accessibility'],
    ['.github/workflows/signed-release.yml',/aecp\.signed-release-provenance\/v1/,'signed release software lane']
  ]
};

function classifyRequirement(phase,mode,text){
  if(phase==='P6') return {status:'VERIFIED_BOUNDARY'};
  if(phase==='P6.5'){
    if(mode==='Acceptance') return {status:'OWNER_REQUIRED'};
    if(/Partner Center identity mapping|Store-managed update path/i.test(text)) return {status:'SOFTWARE_VERIFIED_OWNER_ACTION'};
    return {status:'SOFTWARE_VERIFIED'};
  }
  if(phase==='P7' && /trusted Windows distribution:/i.test(text)) return {status:'OWNER_REQUIRED'};
  if(phase==='P7' && /Store lane preferred/i.test(text)) return {status:'POLICY_VERIFIED'};
  return {status:'VERIFIED_REPO'};
}

const roadmap=fs.readFileSync(roadmapPath,'utf8');
const lines=roadmap.split(/\r?\n/);
const requirements=[];
let phase=null,mode=null;
for(const raw of lines){
  const h=raw.match(/^## (P\d+(?:\.\d+)?) — /);
  if(h){phase=h[1];mode=null;continue;}
  if(/^## MVP definition/.test(raw))break;
  if(!phase)continue;
  if(raw==='Deliverables:'||raw==='Acceptance:'||raw==='Required:'){mode=raw.slice(0,-1);continue;}
  const b=raw.match(/^- (.+)$/);
  if(b&&mode)requirements.push({phase,mode,text:b[1],...classifyRequirement(phase,mode,b[1])});
}

const expectedPhases=['P0','P1','P2','P3','P4','P4.5','P4.6','P4.7','P5','P6','P6.5','P7'];
const findings=[];
for(const p of expectedPhases){
  if(!requirements.some(r=>r.phase===p)) findings.push({phase:p,type:'NO_NORMATIVE_REQUIREMENTS_PARSED'});
  for(const file of phaseEvidence[p]||[]){
    if(!exists(file)) findings.push({phase:p,type:'MISSING_EVIDENCE_FILE',file});
  }
  for(const [file,re,label] of phaseAssertions[p]||[]){
    if(!exists(file))continue;
    if(!re.test(read(file))) findings.push({phase:p,type:'MISSING_ASSERTION',file,label});
  }
}

for(const r of requirements){
  if(!r.status) findings.push({phase:r.phase,type:'UNCLASSIFIED_REQUIREMENT',requirement:r.text});
}

const repoBlocking=findings.filter(f=>true);
const ownerRequired=requirements.filter(r=>r.status==='OWNER_REQUIRED');
const softwareOwner=requirements.filter(r=>r.status==='SOFTWARE_VERIFIED_OWNER_ACTION');
const boundary=requirements.filter(r=>r.status==='VERIFIED_BOUNDARY');

const gates=expectedPhases.map(id=>{
  const reqs=requirements.filter(r=>r.phase===id);
  let status='VERIFIED_REPO';
  if(id==='P6')status='VERIFIED_BOUNDARY';
  if(id==='P6.5')status='SOFTWARE_VERIFIED_OWNER_GATE';
  if(id==='P7')status='SOFTWARE_VERIFIED_OWNER_GATE';
  return {
    id,
    status,
    evidence:phaseEvidence[id]||[],
    requirementCount:reqs.length,
    requirements:reqs,
    findings:findings.filter(f=>f.phase===id)
  };
});

const report={
  schema:'aecp.roadmap-gates/v2',
  generatedAt:new Date().toISOString(),
  source:'Blueprint/08_ROADMAP_ACCEPTANCE.md',
  requirementCount:requirements.length,
  gates,
  ownerRequiredCount:ownerRequired.length,
  softwareVerifiedOwnerActionCount:softwareOwner.length,
  verifiedBoundaryCount:boundary.length,
  repoBlockingFindings:repoBlocking
};

fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n','utf8');
process.stdout.write(JSON.stringify({
  schema:report.schema,
  requirementCount:report.requirementCount,
  phaseCount:gates.length,
  ownerRequiredCount:report.ownerRequiredCount,
  softwareVerifiedOwnerActionCount:report.softwareVerifiedOwnerActionCount,
  verifiedBoundaryCount:report.verifiedBoundaryCount,
  repoBlockingFindings:repoBlocking.length,
  output:'artifacts/roadmap-gates.json'
},null,2)+'\n');

if(repoBlocking.length){
  process.stderr.write(JSON.stringify(repoBlocking,null,2)+'\n');
  process.exitCode=1;
}
