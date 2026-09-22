'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const requiredFiles=[
 ['master-blueprint','Blueprint/00_MASTER_BLUEPRINT.md'],
 ['requirements','Blueprint/REQUIREMENTS.md'],
 ['implementation-status','Blueprint/23_IMPLEMENTATION_STATUS.md'],
 ['roadmap-acceptance','Blueprint/08_ROADMAP_ACCEPTANCE.md'],
 ['ui-spec','Blueprint/01_UX_UI_SPEC.md'],
 ['control-plane','electron/lib/control-plane.cjs'],
 ['harness','electron/lib/harness.cjs'],
 ['security-policy','electron/lib/security-policy.cjs'],
 ['adapter-security-audit','electron/lib/adapter-security-audit.cjs'],
 ['failure-recovery','electron/lib/failure-recovery.cjs'],
 ['event-ledger','electron/lib/event-ledger.cjs'],
 ['event-projection','electron/lib/event-projection.cjs'],
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
 ['local-mcp','electron/mcp-server.mjs'],
 ['electron-main','electron/main.cjs'],
 ['release-workflow','.github/workflows/release.yml'],
 ['packaging-workflow','.github/workflows/ci.yml'],
 ['universal-bootstrap-source','release/universal-bootstrap/Program.cs'],
 ['universal-bootstrap-project','release/universal-bootstrap/UniversalBootstrap.csproj'],
 ['update-state','electron/lib/update-state.cjs'],
 ['update-state-test','tests/update-state.test.cjs'],
 ['e2e-canonical','tests/canonical-loop.e2e.test.cjs'],
 ['e2e-provider','tests/provider-router.e2e.test.cjs'],
 ['e2e-provider-network','tests/provider-network.e2e.test.cjs'],
 ['event-projection-test','tests/event-projection.test.cjs'],
 ['provider-integration-test','tests/provider-integration.test.cjs'],
 ['e2e-security-recovery','tests/security-recovery-matrix.test.cjs'],
 ['e2e-pairing','tests/remote-pairing.test.cjs']
];

function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function invariant(id,file,patterns){
 const absolute=path.join(root,file);
 if(!fs.existsSync(absolute))return{id,file,passed:false,missing:true,failedPatterns:['<file missing>']};
 const body=fs.readFileSync(absolute,'utf8');
 const failedPatterns=patterns.filter(p=>!p.re.test(body)).map(p=>p.label);
 return{id,file,passed:failedPatterns.length===0,failedPatterns};
}

const staticInvariants=[
 invariant('electron-renderer-isolation','electron/main.cjs',[
  {label:'contextIsolation true',re:/contextIsolation:\s*true/},
  {label:'nodeIntegration false',re:/nodeIntegration:\s*false/},
  {label:'sandbox true',re:/sandbox:\s*true/},
  {label:'safeStorage credential protection',re:/safeStorage\.(?:encryptString|decryptString)/}
 ]),
 invariant('canonical-provider-routing','electron/lib/harness.cjs',[
  {label:'ProviderRouter imported',re:/ProviderRouter/},
  {label:'planner provider routed',re:/plannerProvider/},
  {label:'builder provider routed',re:/builderProvider/},
  {label:'reviewer provider routed',re:/reviewerProvider/},
  {label:'bounded maxIterations',re:/bounded\(options\.maxIterations,\s*1,\s*5/}
 ]),
 invariant('mission-scoped-policy','electron/lib/control-plane.cjs',[
  {label:'policyForRun',re:/policyForRun\(run\)/},
  {label:'role config validation',re:/normalizeRoleConfig/},
  {label:'provider planner execution',re:/invokeRole\(\{[\s\S]*role:'planner'/},
  {label:'human-gated CI delivery',re:/GitHub CI passed\. Human approval is required before PR merge/}
 ]),
 invariant('provider-sandbox-and-local','electron/lib/provider-router.cjs',[
  {label:'Ollama explicit model',re:/Ollama provider requires a model/},
  {label:'fixed local-command mode',re:/provider\.mode === 'local-command'/},
  {label:'Codex workspace sandbox',re:/workspace-write/},
  {label:'Codex network disabled',re:/sandbox_workspace_write\.network_access=false/}
 ]),
 invariant('security-high-risk-gates','electron/lib/security-policy.cjs',[
  {label:'MERGE risk',re:/MERGE:'RED'/},
  {label:'DELETE risk',re:/DELETE:'RED'/},
  {label:'CREDENTIAL risk',re:/CREDENTIAL:'RED'/},
  {label:'SYSTEM risk',re:/SYSTEM:'RED'/},
  {label:'approval set',re:/requireApprovalFor/}
 ]),
 invariant('local-mcp-boundary','electron/mcp-server.mjs',[
  {label:'loopback bind',re:/listen\(port,\s*'127\.0\.0\.1'/},
  {label:'Host validation',re:/localhostHostValidation/},
  {label:'Origin validation',re:/localhostOriginValidation/},
  {label:'Bearer authorization',re:/authorization/},
  {label:'workspace path containment',re:/Path escapes the active Workspace/}
 ]),
 invariant('remote-read-only-pairing','electron/lib/remote-gateway.cjs',[
  {label:'loopback only',re:/127\.0\.0\.1/},
  {label:'GET only',re:/req\.method!=='GET'/},
  {label:'pair start',re:/\/pair\/start/},
  {label:'pair claim',re:/\/pair\/claim/},
  {label:'device revoke support',re:/revokeDevice/}
 ]),
 invariant('github-event-auth','electron/lib/github-webhook.cjs',[
  {label:'HMAC SHA-256',re:/sha256/i},
  {label:'delivery identity',re:/x-github-delivery/i}
 ]),
 invariant('clean-windows-smoke-gate','.github/workflows/ci.yml',[
  {label:'x64 clean runner',re:/runner:\s*windows-latest/},
  {label:'ARM64 clean runner',re:/runner:\s*windows-11-arm/},
  {label:'architecture installer smoke',re:/Silent install and uninstall smoke test/},
  {label:'universal bootstrap build',re:/package-universal-bootstrap/},
  {label:'universal bootstrap smoke',re:/smoke-universal-bootstrap/},
  {label:'uninstall verification',re:/still exists after (?:universal bootstrap )?uninstall/}
 ]),
 invariant('release-publication-gate','.github/workflows/release.yml',[
  {label:'release smoke gate',re:/needs:\s*\[build-fallback, build-auto, build-universal, smoke-install, smoke-universal\]/},
  {label:'SHA256 generation',re:/Get-FileHash.*SHA256/}
 ]),
 invariant('provider-local-e2e','tests/provider-router.e2e.test.cjs',[
  {label:'fixed local-command E2E',re:/local-command/},
  {label:'successful local evidence',re:/LOCAL_PROVIDER_OK/}
 ]),
 invariant('canonical-loop-e2e','tests/canonical-loop.e2e.test.cjs',[
  {label:'canonical deterministic test',re:/canonical loop/i}
 ]),
 invariant('event-materialization','electron/lib/control-plane.cjs',[
  {label:'projectEvents imported',re:/projectEvents/},
  {label:'event projection exposed',re:/eventProjection=projectEvents/}
 ]),
 invariant('provider-selection-ui','ui/app.js',[
  {label:'planner selector',re:/harnessPlannerProvider/},
  {label:'builder selector',re:/harnessBuilderProvider/},
  {label:'reviewer selector',re:/harnessReviewerProvider/},
  {label:'network approval',re:/providerNetworkApproved/},
  {label:'credential approval',re:/providerCredentialApproved/}
 ]),
 invariant('updater-transaction-and-rollback','electron/main.cjs',[
  {label:'release SHA256 verification',re:/Downloaded installer failed SHA-256 verification/},
  {label:'update transaction persistence',re:/writeUpdateTransaction/},
  {label:'first boot reconciliation',re:/reconcileUpdateTransaction/},
  {label:'rollback action',re:/async function rollbackUpdate/}
 ]),
 invariant('updater-state-machine','electron/lib/update-state.cjs',[
  {label:'rollback required state',re:/ROLLBACK_REQUIRED/},
  {label:'rollback completed state',re:/ROLLED_BACK/},
  {label:'first boot health',re:/reconcileFirstBoot/}
 ])
];

function run(){
 const files=requiredFiles.map(([id,file])=>({id,file,exists:fs.existsSync(path.join(root,file))}));
 const missing=files.filter(x=>!x.exists);
 const failedInvariants=staticInvariants.filter(x=>!x.passed);
 const report={
  schema:'aecp.acceptance/v2',
  generatedAt:new Date().toISOString(),
  branchHint:process.env.GITHUB_REF_NAME||null,
  repositoryFiles:{total:files.length,passed:files.length-missing.length,failed:missing.length,checks:files},
  staticInvariants:{total:staticInvariants.length,passed:staticInvariants.length-failedInvariants.length,failed:failedInvariants.length,checks:staticInvariants},
  automatedEvidence:[
   'npm test executes behavioral/unit/integration tests before this audit',
   'tests/canonical-loop.e2e.test.cjs',
   'tests/provider-router.e2e.test.cjs',
   'tests/provider-network.e2e.test.cjs',
   'tests/remote-pairing.test.cjs',
   'tests/security-recovery-matrix.test.cjs',
   'tests/event-projection.test.cjs',
   'tests/provider-integration.test.cjs',
   'tests/update-state.test.cjs'
  ],
  exactCommitCIGates:[
   'AECP CI must succeed on the exact commit',
   'AECP Security must succeed on the exact commit',
   'AECP Packaging must build x64/ARM64, build the universal bootstrap, and pass architecture-specific plus universal clean Windows install/uninstall smoke jobs on the exact commit'
  ],
  ownerExternalGates:[
   'production Authenticode/code-signing certificate and trusted provenance',
   'Microsoft Store publisher identity/certification/submission',
   'real third-party provider account credentials where a provider-specific production claim is made',
   'optional LAN/Internet deployment identity/domain/TLS transport'
  ],
  policy:'STATIC/TES­TED/CI/ENVIRONMENT/OWNER evidence are distinct. Repository wiring cannot promote owner/external gates to PASS.'
 };
 console.log(JSON.stringify(report,null,2));
 if(missing.length||failedInvariants.length)process.exitCode=1;
}
run();
