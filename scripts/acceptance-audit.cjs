'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const checks=[
 ['master-blueprint','Blueprint/00_MASTER_BLUEPRINT.md'],
 ['implementation-status','Blueprint/23_IMPLEMENTATION_STATUS.md'],
 ['roadmap-acceptance','Blueprint/08_ROADMAP_ACCEPTANCE.md'],
 ['requirements','Blueprint/REQUIREMENTS.md'],
 ['ui-spec','Blueprint/01_UX_UI_SPEC.md'],
 ['control-plane','electron/lib/control-plane.cjs'],
 ['harness','electron/lib/harness.cjs'],
 ['security-policy','electron/lib/security-policy.cjs'],
 ['adapter-security-audit','electron/lib/adapter-security-audit.cjs'],
 ['failure-recovery','electron/lib/failure-recovery.cjs'],
 ['event-ledger','electron/lib/event-ledger.cjs'],
 ['evidence-manager','electron/lib/evidence-manager.cjs'],
 ['resource-manager','electron/lib/resource-manager.cjs'],
 ['lock-manager','electron/lib/lock-manager.cjs'],
 ['context-bus','electron/lib/context-bus.cjs'],
 ['provider-router','electron/lib/provider-router.cjs'],
 ['github-gateway','electron/lib/github-gateway.cjs'],
 ['github-webhook','electron/lib/github-webhook.cjs'],
 ['ci-monitor','electron/lib/ci-monitor.cjs'],
 ['delivery','electron/lib/delivery.cjs'],
 ['maintenance','electron/lib/maintenance.cjs'],
 ['drift-scanner','electron/lib/drift-scanner.cjs'],
 ['dependency-drift','electron/lib/dependency-drift-scanner.cjs'],
 ['remote-gateway','electron/lib/remote-gateway.cjs'],
 ['device-pairing','electron/lib/pairing.cjs'],
 ['release-workflow','.github/workflows/release.yml'],
 ['universal-bootstrap-source','release/universal-bootstrap/Program.cs'],
 ['universal-bootstrap-project','release/universal-bootstrap/UniversalBootstrap.csproj'],
 ['e2e-canonical','tests/canonical-loop.e2e.test.cjs'],
 ['e2e-security-recovery','tests/security-recovery-matrix.test.cjs'],
 ['e2e-pairing','tests/remote-pairing.test.cjs']
];

function run(){
 const results=checks.map(([id,file])=>({id,file,exists:fs.existsSync(path.join(root,file))}));
 const missing=results.filter(x=>!x.exists);
 const report={
  schema:'aecp.acceptance/v1',
  generatedAt:new Date().toISOString(),
  branchHint:process.env.GITHUB_REF_NAME||null,
  total:results.length,
  passed:results.length-missing.length,
  failed:missing.length,
  checks:results,
  externalGates:[
   'clean Windows x64 install smoke',
   'clean Windows ARM64 install smoke',
   'signed installer/update rollback',
   'production code-signing provenance',
   'Microsoft Store publisher identity/submission',
   'real provider credentials and end-to-end agent execution',
   'LAN/Internet authenticated transport'
  ],
  policy:'Static audit proves repository capability wiring only; external gates must not be represented as PASS until executed.'
 };
 console.log(JSON.stringify(report,null,2));
 if(missing.length)process.exitCode=1;
}
run();
