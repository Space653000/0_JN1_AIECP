'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const outPath=path.join(root,'artifacts','roadmap-gates.json');
const exists=(p)=>fs.existsSync(path.join(root,p));
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const gates=[
  {
    id:'P0',status:'VERIFIED_REPO',
    evidence:['electron/main.cjs','tests/human-controls.test.cjs','tests/i18n-accessibility.test.cjs'],
    assertions:[
      ['electron/main.cjs',/contextIsolation\s*:\s*true/,'context isolation'],
      ['tests/human-controls.test.cjs',/Workspace authorization is explicit/,'explicit Workspace authorization']
    ]
  },
  {
    id:'P1',status:'VERIFIED_REPO',
    evidence:['tests/protocol.test.cjs','tests/human-controls.test.cjs','ui/app.js'],
    assertions:[
      ['tests/human-controls.test.cjs',/clipboard bridge remains explicit user-triggered/,'explicit clipboard bridge'],
      ['tests/protocol.test.cjs',/unsupported action capabilities|rejects unsupported/i,'invalid/unsupported card rejection']
    ]
  },
  {
    id:'P2',status:'VERIFIED_REPO',
    evidence:['tests/path-safety.test.cjs','tests/security-recovery-matrix.test.cjs','tests/harness.test.cjs'],
    assertions:[
      ['tests/path-safety.test.cjs',/rejects sibling\/outside path/,'Workspace path rejection'],
      ['tests/harness.test.cjs',/Verifier|verification/i,'deterministic verification']
    ]
  },
  {
    id:'P3',status:'VERIFIED_REPO',
    evidence:['tests/control-plane-infrastructure.test.cjs','tests/autonomy.test.cjs','electron/lib/lock-manager.cjs'],
    assertions:[
      ['tests/control-plane-infrastructure.test.cjs',/resource manager discovers a git repository/,'repository discovery/resource binding'],
      ['tests/autonomy.test.cjs',/isolates writes in worktree/,'isolated worktree mutation']
    ]
  },
  {
    id:'P4',status:'VERIFIED_REPO',
    evidence:['tests/provider-router.test.cjs','tests/provider-integration.test.cjs','tests/provider-network.e2e.test.cjs'],
    assertions:[
      ['tests/provider-router.test.cjs',/provider registry exposes vendor-neutral roles/i,'provider registry'],
      ['tests/provider-network.e2e.test.cjs',/NETWORK|CREDENTIAL/,'network/credential policy']
    ]
  },
  {
    id:'P4.5',status:'VERIFIED_REPO',
    evidence:['tests/human-controls.test.cjs','ui/app.js'],
    assertions:[
      ['tests/human-controls.test.cjs',/Execution Mode recommendation is factual/,'execution mode readiness'],
      ['ui/app.js',/Official Full MCP/,'Full MCP mode card'],
      ['ui/app.js',/Local Autonomous/,'Local Autonomous mode card']
    ]
  },
  {
    id:'P4.6',status:'VERIFIED_REPO',
    evidence:['tests/autonomy.test.cjs','electron/lib/autonomy.cjs'],
    assertions:[
      ['tests/autonomy.test.cjs',/isolates writes in worktree/,'worktree isolation'],
      ['tests/autonomy.test.cjs',/explicit apply/i,'explicit apply gate'],
      ['electron/lib/autonomy.cjs',/maxIterations|iterationTimeout/i,'bounded iteration/time']
    ]
  },
  {
    id:'P4.7',status:'VERIFIED_REPO',
    evidence:['tests/canonical-loop.e2e.test.cjs','tests/control-plane.test.cjs','tests/event-projection.test.cjs','tests/delivery-reconciliation.test.cjs'],
    assertions:[
      ['tests/canonical-loop.e2e.test.cjs',/canonical loop/i,'canonical loop E2E'],
      ['tests/delivery-reconciliation.test.cjs',/ambiguous command failure|lost response/,'idempotent GitHub delivery reconciliation']
    ]
  },
  {
    id:'P5',status:'VERIFIED_BOUNDARY',
    evidence:['tests/windows-desktop-adapter.test.cjs','tests/windows-ui-adapter.test.cjs','tests/python-worker.test.cjs'],
    assertions:[
      ['tests/windows-ui-adapter.test.cjs',/browser automation inspection is deny-by-default/,'browser deny-by-default'],
      ['tests/windows-ui-adapter.test.cjs',/window docking requires explicit SYSTEM approval/,'SYSTEM-gated docking']
    ]
  },
  {
    id:'P6',status:'VERIFIED_BOUNDARY',
    evidence:['tests/remote-pairing.test.cjs','electron/lib/remote-gateway.cjs'],
    assertions:[
      ['tests/remote-pairing.test.cjs',/one-time pairing and revocation/,'pair/revoke'],
      ['tests/remote-pairing.test.cjs',/TLS remote gateway/,'encrypted non-loopback transport'],
      ['tests/remote-pairing.test.cjs',/cannot submit tasks/,'remote task submission intentionally denied']
    ],
    note:'Remote supervision/status/approval is verified. Remote task submission is intentionally disabled by current security architecture.'
  },
  {
    id:'P6.5',status:'OWNER_REQUIRED',
    evidence:['.github/workflows/ci.yml','.github/workflows/store-package.yml','scripts/validate-store-package.ps1','tests/release-workflow.test.cjs'],
    assertions:[
      ['.github/workflows/ci.yml',/package-store:/,'PR Store package lane'],
      ['.github/workflows/store-package.yml',/aecp\.store-provenance\/v1/,'owner Store bundle provenance']
    ],
    ownerRequirements:['Microsoft Partner Center publisher identity','Store submission/certification','Private audience acquisition on a clean Windows device']
  },
  {
    id:'P7',status:'OWNER_REQUIRED',
    evidence:['tests/backup-manager.test.cjs','tests/state-migration.test.cjs','tests/i18n-accessibility.test.cjs','scripts/license-audit.cjs','.github/workflows/ci.yml','.github/workflows/signed-release.yml','tests/authenticode.test.cjs'],
    assertions:[
      ['.github/workflows/ci.yml',/smoke-upgrade-rollback:/,'x64/ARM64 upgrade/rollback smoke'],
      ['tests/i18n-accessibility.test.cjs',/Traditional Chinese|localization/i,'localization/accessibility'],
      ['.github/workflows/signed-release.yml',/aecp\.signed-release-provenance\/v1/,'owner-gated signed release software lane']
    ],
    ownerRequirements:['Production Authenticode certificate ownership/secrets and authorized signing run, or Microsoft Store trust path']
  }
];

const findings=[];
for(const gate of gates){
  for(const file of gate.evidence){
    if(!exists(file))findings.push({gate:gate.id,type:'MISSING_EVIDENCE_FILE',file});
  }
  for(const [file,re,label] of gate.assertions||[]){
    if(!exists(file))continue;
    if(!re.test(read(file)))findings.push({gate:gate.id,type:'MISSING_ASSERTION',file,label});
  }
}

const repoBlocking=findings.filter(f=>{
  const gate=gates.find(g=>g.id===f.gate);
  return gate && gate.status!=='OWNER_REQUIRED';
});

const report={
  schema:'aecp.roadmap-gates/v1',
  generatedAt:new Date().toISOString(),
  gates:gates.map(g=>({
    id:g.id,
    status:g.status,
    evidence:g.evidence,
    note:g.note||null,
    ownerRequirements:g.ownerRequirements||[],
    findings:findings.filter(f=>f.gate===g.id)
  })),
  summary:{
    total:gates.length,
    verifiedRepo:gates.filter(g=>g.status==='VERIFIED_REPO').length,
    verifiedBoundary:gates.filter(g=>g.status==='VERIFIED_BOUNDARY').length,
    ownerRequired:gates.filter(g=>g.status==='OWNER_REQUIRED').length,
    repoBlockingFindings:repoBlocking.length,
    allFindings:findings.length
  }
};

fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n','utf8');
process.stdout.write(JSON.stringify(report.summary,null,2)+'\n');

if(repoBlocking.length){
  process.stderr.write(JSON.stringify(repoBlocking,null,2)+'\n');
  process.exitCode=1;
}
