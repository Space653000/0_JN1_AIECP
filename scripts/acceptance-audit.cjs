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
 ['redaction-test','tests/redaction.test.cjs'],
 ['redaction','electron/lib/redaction.cjs'],
 ['adapter-security-audit','electron/lib/adapter-security-audit.cjs'],
 ['failure-recovery','electron/lib/failure-recovery.cjs'],
 ['event-ledger','electron/lib/event-ledger.cjs'],
 ['event-projection','electron/lib/event-projection.cjs'],
 ['evidence-manager','electron/lib/evidence-manager.cjs'],
 ['accepted-evidence-test','tests/accepted-evidence.test.cjs'],
 ['accepted-evidence','electron/lib/accepted-evidence.cjs'],
 ['resource-manager','electron/lib/resource-manager.cjs'],
 ['lock-manager','electron/lib/lock-manager.cjs'],
 ['context-bus','electron/lib/context-bus.cjs'],
 ['provider-router','electron/lib/provider-router.cjs'],
 ['provider-usage','electron/lib/provider-usage.cjs'],
 ['provider-usage-test','tests/provider-usage.test.cjs'],
 ['real-provider-test','tests/provider-environment-workflow.test.cjs'],
 ['real-provider-script','scripts/provider-environment-verify.cjs'],
 ['real-provider-workflow','.github/workflows/provider-environment.yml'],
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
 ['store-workflow','.github/workflows/store-package.yml'],
 ['signed-release-workflow','.github/workflows/signed-release.yml'],
 ['authenticode','electron/lib/authenticode.cjs'],
 ['authenticode-test','tests/authenticode.test.cjs'],
 ['store-validator','scripts/validate-store-package.ps1'],
 ['license-audit','scripts/license-audit.cjs'],
 ['roadmap-gate-audit','scripts/roadmap-gate-audit.cjs'],
 ['requirements-coverage','scripts/requirements-coverage.cjs'],
 ['blueprint-coverage','scripts/blueprint-coverage.cjs'],
 ['store-metadata','release/store/store-metadata.template.json'],
 ['store-readme','release/store/README.md'],
 ['human-controls-test','tests/human-controls.test.cjs'],
 ['universal-bootstrap-source','release/universal-bootstrap/Program.cs'],
 ['universal-bootstrap-project','release/universal-bootstrap/UniversalBootstrap.csproj'],
 ['update-state','electron/lib/update-state.cjs'],
 ['update-state-test','tests/update-state.test.cjs'],
 ['e2e-canonical','tests/canonical-loop.e2e.test.cjs'],
 ['e2e-provider','tests/provider-router.e2e.test.cjs'],
 ['harness-bounds-test','tests/harness-bounds.test.cjs'],
 ['e2e-provider-network','tests/provider-network.e2e.test.cjs'],
 ['event-projection-test','tests/event-projection.test.cjs'],
 ['provider-integration-test','tests/provider-integration.test.cjs'],
 ['e2e-security-recovery','tests/security-recovery-matrix.test.cjs'],
 ['e2e-pairing','tests/remote-pairing.test.cjs'],
 ['delivery-reconciliation-test','tests/delivery-reconciliation.test.cjs']
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
 invariant('goal-loop-runtime-contract','electron/lib/harness.cjs',[
  {label:'Goal Loop schema',re:/aecp\.goal-loop\/v1/},
  {label:'checkpoint cadence',re:/checkpointEvery/},
  {label:'Workspace binding',re:/workspaceId/},
  {label:'provider policy',re:/providerPolicy/},
  {label:'permission policy',re:/permissionPolicy/},
  {label:'verification policy',re:/verificationPolicy/},
  {label:'stop conditions',re:/stopConditions/},
  {label:'checkpoint evidence',re:/aecp\.goal-loop-checkpoint\/v1/},
  {label:'no-progress stop',re:/NO_PROGRESS_STOP/},
  {label:'wall-clock budget',re:/WALL_CLOCK_BUDGET_EXHAUSTED/},
  {label:'failed-attempt budget',re:/FAILED_ATTEMPT_BUDGET_EXHAUSTED/}
 ]),
 invariant('goal-loop-runtime-tests','tests/harness-bounds.test.cjs',[
  {label:'Goal Loop contract test',re:/complete Goal Loop contract and checkpoint evidence/},
  {label:'no-progress test',re:/stops repeated no-progress attempts/},
  {label:'failed-attempt test',re:/failed-attempt budget outside the model/},
  {label:'wall-clock test',re:/wall-clock budget before the next provider call/}
 ]),
 invariant('harness-hard-budgets','electron/lib/harness.cjs',[
  {label:'provider call budget',re:/PROVIDER_CALL_BUDGET_EXHAUSTED/},
  {label:'patch byte budget',re:/PATCH_BUDGET_EXHAUSTED/},
  {label:'changed-file budget',re:/CHANGED_FILE_BUDGET_EXHAUSTED/},
  {label:'output limit kill',re:/outputLimitExceeded[\s\S]*kill\(child\)/},
  {label:'budget terminal state',re:/BUDGET_EXHAUSTED/}
 ]),
 invariant('harness-hard-budget-tests','tests/harness-bounds.test.cjs',[
  {label:'maxTurns test',re:/maxTurns is exhausted/},
  {label:'changed file budget test',re:/changed-file budget is exceeded/},
  {label:'patch budget test',re:/patch exceeds maxPatchBytes/}
 ]),
 invariant('autonomy-hard-budgets','electron/lib/autonomy.cjs',[
  {label:'max turns',re:/maxTurns:\s*maxIterations/},
  {label:'output byte budget',re:/maxOutputBytes/},
  {label:'patch byte budget',re:/maxPatchBytes/},
  {label:'changed file budget',re:/maxChangedFiles/}
 ]),
 invariant('autonomy-crash-resume','electron/lib/autonomy.cjs',[
  {label:'resume record',re:/resumeRecord/},
  {label:'interrupted-only resume',re:/Only an INTERRUPTED autonomous run can resume/},
  {label:'immutable persisted spec',re:/cannot change the persisted run specification/},
  {label:'same source HEAD',re:/Workspace HEAD changed since the interrupted autonomous run/},
  {label:'same persisted worktree',re:/Persisted autonomous worktree/}
 ]),
 invariant('autonomy-crash-resume-ui','electron/main.cjs',[
  {label:'persist interrupted state',re:/record\.state = 'INTERRUPTED'/},
  {label:'resume IPC',re:/autonomy:resume/},
  {label:'resume function',re:/async function resumeAutonomy/}
 ]),

 invariant('onboarding-and-accessibility','ui/app.js',[
  {label:'first Workspace safe sample',re:/!hadWorkspace && state\.tasks\.length === 0[\s\S]*createSampleTask/},
  {label:'reduced motion preference persistence',re:/aecp-motion/},
  {label:'reduced motion document state',re:/dataset\.motion = state\.motion/},
  {label:'Graph governed policy edge',re:/edit-workspace-policy/},
  {label:'Graph governed repository edge',re:/add-repository-edge/},
  {label:'Graph governed provider edge',re:/manage-provider-edges/}
 ]),
 invariant('onboarding-safety-summary','ui/index.html',[
  {label:'safety summary',re:/Safety summary/},
  {label:'GREEN explanation',re:/GREEN = read-only local inspection/},
  {label:'RED explicit approval explanation',re:/RED = push, merge, delete, credentials, system changes/},
  {label:'motion selector',re:/id="motionPreference"/}
 ]),
 invariant('explicit-reduced-motion','ui/styles.css',[
  {label:'system reduced motion',re:/prefers-reduced-motion:\s*reduce/},
  {label:'explicit reduced motion',re:/data-motion="reduced"/}
 ]),
 invariant('workspace-policy-editor','electron/lib/workspace-policy.cjs',[
  {label:'canonical policy schema',re:/aecp\.workspace-policy\/v1/},
  {label:'RED approvals forced',re:/ALWAYS_APPROVAL_ACTIONS/},
  {label:'no RED auto ceiling',re:/\['GREEN','YELLOW'\]/},
  {label:'canonical compiler',re:/function compileWorkspacePolicy/}
 ]),
 invariant('workspace-policy-runtime','electron/main.cjs',[
  {label:'policy save IPC',re:/policy:save/},
  {label:'Harness policy compilation',re:/new SecurityPolicy\(\{ allowRoots: \[workspace\.rootPath, runRoot\], \.\.\.compileWorkspacePolicy/},
  {label:'Control Plane policy update',re:/controlPlane\?\.setPolicyConfig/},
  {label:'adapter matrix IPC',re:/security:adapter-matrix/}
 ]),
 invariant('workspace-policy-ui','ui/app.js',[
  {label:'policy renderer',re:/renderPolicySettings/},
  {label:'capability matrix renderer',re:/renderAdapterMatrix/},
  {label:'policy save action',re:/saveWorkspacePolicySettings/}
 ]),
 invariant('local-data-governance','electron/lib/local-data-manager.cjs',[
  {label:'clear evidence',re:/async function clearEvidence/},
  {label:'remove Workspace binding',re:/function removeWorkspaceBinding/},
  {label:'clear credentials',re:/async function clearCredentials/},
  {label:'reset active state',re:/async function resetActiveState/},
  {label:'preserve pre-restore',re:/preserved:\['pre-restore'\]/},
  {label:'Workspace untouched declaration',re:/workspaceFilesTouched:false/}
 ]),
 invariant('local-data-ui-and-guard','electron/main.cjs',[
  {label:'active work guard',re:/assertDataOperationIdle/},
  {label:'native confirmation',re:/confirmDataOperation/},
  {label:'evidence IPC',re:/data:clear-evidence/},
  {label:'Workspace unbind IPC',re:/data:remove-workspace/},
  {label:'credential clear IPC',re:/data:clear-credentials/},
  {label:'state reset IPC',re:/data:reset-state/}
 ]),
 invariant('accepted-task-evidence','electron/lib/accepted-evidence.cjs',[
  {label:'accepted evidence schema',re:/aecp\.accepted-task-evidence\/v1/},
  {label:'Blueprint version',re:/blueprintVersion/},
  {label:'Plan id',re:/planId/},
  {label:'agents/models',re:/agents:[\s\S]*models:/},
  {label:'base/final commit',re:/baseCommit[\s\S]*finalCommit/},
  {label:'commands and exit codes',re:/commands[\s\S]*exitCode/},
  {label:'verifier result',re:/verifierResults/},
  {label:'review result',re:/reviewResults/},
  {label:'patch hash and changed files',re:/patch:[\s\S]*sha256[\s\S]*changedFiles/}
 ]),
 invariant('accepted-task-evidence-manifest','electron/lib/control-plane.cjs',[
  {label:'evidence validation',re:/validateAcceptedTaskEvidence/},
  {label:'fail closed incomplete evidence',re:/EVIDENCE_INCOMPLETE/},
  {label:'SHA manifest',re:/evidenceManifest=await this\.evidence\.manifest/},
  {label:'Result Capsule uses manifest',re:/evidence:task\.evidenceManifest\|\|task\.evidence/}
 ]),
 invariant('secret-redaction','electron/lib/redaction.cjs',[
  {label:'Bearer redaction',re:/Bearer/},
  {label:'private-key redaction',re:/PRIVATE KEY/},
  {label:'provider token redaction',re:/github_pat_/},
  {label:'URL userinfo redaction',re:/\[REDACTED\]@/},
  {label:'recursive sanitizer',re:/function redactSensitive/}
 ]),
 invariant('secret-redaction-surfaces','tests/redaction.test.cjs',[
  {label:'Evidence persistence test',re:/EvidenceManager and ContextBus persist redacted content/},
  {label:'Provider URL credential rejection',re:/provider URLs reject embedded credentials/},
  {label:'Operational persistence test',re:/all operational persistence surfaces use centralized redaction/}
 ]),
 invariant('restart-no-blind-replay','electron/lib/control-plane.cjs',[
  {label:'restart pause',re:/requiresExplicitResume:true/},
  {label:'running and queued recovery',re:/\['RUNNING','QUEUED'\]/},
  {label:'recovered task checkpoint',re:/task\.resume=true/}
 ]),
 invariant('restart-no-blind-replay-test','tests/control-plane.test.cjs',[
  {label:'explicit resume recovery test',re:/never auto-resumes a mutating mission/}
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
 invariant('real-provider-evidence-lane','.github/workflows/provider-environment.yml',[
  {label:'manual dispatch',re:/workflow_dispatch:/},
  {label:'dedicated self-hosted runner',re:/runs-on:\s*\[self-hosted, Windows, aecp-provider\]/},
  {label:'exact source checkout',re:/ref:\s*\$\{\{ inputs\.source_ref \}\}/},
  {label:'provider evidence artifact',re:/provider-environment-evidence\.json/},
  {label:'always upload evidence',re:/if:\s*always\(\)[\s\S]*Upload real provider evidence/}
 ]),
 invariant('real-provider-evidence-script','scripts/provider-environment-verify.cjs',[
  {label:'real Ollama smoke',re:/ollama\.real-smoke/},
  {label:'OpenCode Ollama edit',re:/opencode\.ollama-real-edit/},
  {label:'fixed local command smoke',re:/local-command\.real-smoke/},
  {label:'canonical local Harness',re:/canonical-harness\.ollama-opencode/},
  {label:'no provider network approval',re:/providerNetworkApproved:false/},
  {label:'privacy declaration',re:/promptBodiesPersisted:false[\s\S]*responseBodiesPersisted:false[\s\S]*credentialsPersisted:false/}
 ]),
 invariant('provider-health-and-observability','electron/lib/provider-router.cjs',[
  {label:'health NOT_CONFIGURED',re:/NOT_CONFIGURED/},
  {label:'health READY',re:/READY/},
  {label:'health DEGRADED',re:/DEGRADED/},
  {label:'health UNAVAILABLE',re:/UNAVAILABLE/},
  {label:'health AUTH_REQUIRED',re:/AUTH_REQUIRED/},
  {label:'network health approval',re:/NETWORK approval was not granted/},
  {label:'credential health approval',re:/CREDENTIAL approval/},
  {label:'privacy-safe metrics',re:/aecp\.provider-usage\/v1/},
  {label:'metrics sink',re:/metricsSink/}
 ]),
 invariant('provider-usage-store','electron/lib/provider-usage.cjs',[
  {label:'bounded retention',re:/maxRecords/},
  {label:'serialized writes',re:/this\.queue/},
  {label:'privacy whitelist',re:/numericOnly/},
  {label:'usage summaries',re:/async summaries\(\)/}
 ]),
 invariant('provider-health-ui','ui/app.js',[
  {label:'health action',re:/data-provider-health/},
  {label:'health IPC call',re:/checkProviderHealth/},
  {label:'external subscription text',re:/subscription-managed externally/},
  {label:'usage summary',re:/formatProviderUsage/}
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
 invariant('remote-scoped-pairing','electron/lib/remote-gateway.cjs',[
  {label:'loopback default',re:/host='127\.0\.0\.1'/},
  {label:'pair start',re:/\/pair\/start/},
  {label:'pair claim',re:/\/pair\/claim/},
  {label:'approval-only route',re:/api\\\/approvals/},
  {label:'approval scope enforcement',re:/APPROVAL_ONLY/},
  {label:'replay-safe request id',re:/x-aecp-request-id/},
  {label:'device revoke support',re:/revokeDevice/}
 ]),
 invariant('github-event-auth','electron/lib/github-webhook.cjs',[
  {label:'HMAC SHA-256',re:/sha256/i},
  {label:'delivery identity',re:/x-github-delivery/i}
 ]),
 invariant('exact-head-ci','.github/workflows/aecp-ci.yml',[
  {label:'PR exact HEAD checkout',re:/pull_request\.head\.sha/},
  {label:'exact HEAD evidence naming',re:/aecp-verification-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/}
 ]),
 invariant('exact-head-security','.github/workflows/aecp-security.yml',[
  {label:'PR exact HEAD checkout',re:/pull_request\.head\.sha/}
 ]),
 invariant('exact-head-packaging','.github/workflows/ci.yml',[
  {label:'PR exact HEAD checkout',re:/pull_request\.head\.sha/}
 ]),
 invariant('clean-windows-smoke-gate','.github/workflows/ci.yml',[
  {label:'x64 clean runner',re:/runner:\s*windows-latest/},
  {label:'ARM64 clean runner',re:/runner:\s*windows-11-arm/},
  {label:'architecture installer smoke',re:/Silent install and uninstall smoke test/},
  {label:'universal bootstrap build',re:/package-universal-bootstrap/},
  {label:'universal bootstrap smoke',re:/smoke-universal-bootstrap/},
  {label:'uninstall verification',re:/still exists after (?:universal bootstrap )?uninstall/}
 ]),
 invariant('release-exact-head-dry-run','.github/workflows/release.yml',[
  {label:'PR trigger',re:/pull_request:[\s\S]*branches:\s*\[main\]/},
  {label:'PR exact HEAD checkout',re:/pull_request\.head\.sha \|\| github\.sha/},
  {label:'provenance exact checkout HEAD',re:/\$sourceCommit\s*=\s*\(git rev-parse HEAD\)\.Trim\(\)[\s\S]*sourceCommit=\$sourceCommit/},
  {label:'stale run cancellation',re:/cancel-in-progress:\s*true/},
  {label:'bounded release jobs',re:/verify:[\s\S]*timeout-minutes:\s*45[\s\S]*provenance:[\s\S]*timeout-minutes:\s*45/}
 ]),
 invariant('release-publication-gate','.github/workflows/release.yml',[
  {label:'release verify job',re:/^  verify:$/m},
  {label:'x64 ARM64 smoke',re:/smoke-install:[\s\S]*windows-11-arm/},
  {label:'universal smoke',re:/smoke-universal:[\s\S]*windows-11-arm/},
  {label:'upgrade rollback smoke',re:/smoke-upgrade-rollback:[\s\S]*0\.2\.99/},
  {label:'Store dry-run package',re:/build-store-test:[\s\S]*validate-store-package\.ps1/},
  {label:'release provenance',re:/aecp\.release-provenance\/v1/},
  {label:'SHA256 generation',re:/Get-FileHash.*SHA256/},
  {label:'tag publication after provenance',re:/publish-release:[\s\S]*needs:\s+provenance/}
 ]),
 invariant('store-software-lane','.github/workflows/store-package.yml',[
  {label:'owner identity input',re:/identity_name:/},
  {label:'owner publisher input',re:/publisher:/},
  {label:'private audience acknowledgement',re:/private_audience_ack:/},
  {label:'owner identity applied to package config',re:/p\.build\.appx\.identityName=process\.env\.AECP_STORE_IDENTITY/},
  {label:'owner Store build',re:/npm run dist:store:x64[\s\S]*npm run dist:store:arm64/},
  {label:'manifest validator',re:/validate-store-package\.ps1/},
  {label:'Store provenance',re:/aecp\.store-provenance\/v1/},
  {label:'no fake Store submission',re:/submittedToPartnerCenter=\$false/}
 ]),
 invariant('store-package-config','package.json',[
  {label:'AppX config',re:/"appx"\s*:/},
  {label:'x64 Store script',re:/"dist:store:x64"/},
  {label:'ARM64 Store script',re:/"dist:store:arm64"/},
  {label:'Traditional Chinese Store language',re:/"zh-TW"/}
 ]),
 invariant('authenticode-signer-gate','electron/main.cjs',[
  {label:'authenticode verifier imported',re:/verifyAuthenticode/},
  {label:'build-time signer pin',re:/packageManifest\?\.aecp\?\.requiredSignerThumbprint/},
  {label:'environment signer override',re:/AECP_REQUIRED_SIGNER_THUMBPRINT/},
  {label:'downloaded installer signature verification',re:/Downloaded installer failed SHA-256 verification[\s\S]*verifyAuthenticode/},
  {label:'rollback signature verification',re:/rollbackInstaller[\s\S]*verifyAuthenticode/}
 ]),
 invariant('signed-release-owner-gate','.github/workflows/signed-release.yml',[
  {label:'manual dispatch',re:/workflow_dispatch:/},
  {label:'certificate secret reference',re:/secrets\.AECP_CODESIGN_PFX_BASE64/},
  {label:'password secret reference',re:/secrets\.AECP_CODESIGN_PASSWORD/},
  {label:'signer verification',re:/Get-AuthenticodeSignature/},
  {label:'signed exact source checkout',re:/ref:\s*\$\{\{ inputs\.source_ref \}\}[\s\S]*git rev-parse HEAD/},
  {label:'signed provenance',re:/aecp\.signed-release-provenance\/v1[\s\S]*sourceCommit=\$sourceCommit/},
  {label:'publish acknowledgement',re:/if:\s*\$\{\{ inputs\.publish_ack \}\}/},
  {label:'bounded signed jobs',re:/verify-owner-inputs:[\s\S]*timeout-minutes:\s*45[\s\S]*signed-provenance:[\s\S]*timeout-minutes:\s*45/}
 ]),
 invariant('authenticode-tests','tests/authenticode.test.cjs',[
  {label:'preview unsigned policy test',re:/preview mode does not require Authenticode/},
  {label:'matching signer test',re:/accepts a valid matching signature/},
  {label:'wrong signer rejection',re:/wrong certificate/},
  {label:'invalid signature rejection',re:/invalid signature status/}
 ]),
 invariant('canonical-roadmap-gate','package.json',[
  {label:'roadmap audit script',re:/"audit:roadmap"\s*:\s*"node scripts\/roadmap-gate-audit\.cjs"/},
  {label:'verify executes roadmap audit',re:/"verify"\s*:\s*"[^"]*audit:roadmap[^"]*"/}
 ]),
 invariant('roadmap-evidence-artifact','.github/workflows/aecp-ci.yml',[
  {label:'roadmap gate artifact',re:/artifacts\/roadmap-gates\.json/}
 ]),
 invariant('canonical-license-gate','package.json',[
  {label:'license audit script',re:/"audit:license"\s*:\s*"node scripts\/license-audit\.cjs"/},
  {label:'verify executes license audit',re:/"verify"\s*:\s*"[^"]*audit:license[^"]*"/}
 ]),
 invariant('normative-requirements-gate','package.json',[
  {label:'requirements audit script',re:/"audit:requirements"\s*:\s*"node scripts\/requirements-coverage\.cjs"/},
  {label:'verify executes requirements audit',re:/"verify"\s*:\s*"[^"]*audit:requirements[^"]*"/}
 ]),
 invariant('blueprint-coverage-gate','package.json',[
  {label:'Blueprint audit script',re:/"audit:blueprints"\s*:\s*"node scripts\/blueprint-coverage\.cjs"/},
  {label:'verify executes Blueprint audit',re:/"verify"\s*:\s*"[^"]*audit:blueprints[^"]*"/}
 ]),
 invariant('human-agency-gate','tests/human-controls.test.cjs',[
  {label:'explicit Workspace selection',re:/Workspace authorization is explicit/},
  {label:'explicit clipboard',re:/clipboard bridge remains explicit/},
  {label:'bounded Goal Loop',re:/Goal Loop is visibly bounded/},
  {label:'emergency stop',re:/emergency stop controls remain authoritative/},
  {label:'Execution Mode readiness',re:/Execution Mode recommendation is factual/}
 ]),
 invariant('security-license-evidence','.github/workflows/aecp-security.yml',[
  {label:'security audit evidence',re:/security-audit\.log/},
  {label:'license audit evidence',re:/artifacts\/license-audit\.json/}
 ]),
 invariant('delivery-ambiguous-write-reconciliation','electron/lib/delivery.cjs',[
  {label:'push remote SHA reconciliation',re:/RECONCILED_REMOTE_PUSH/},
  {label:'remote branch verification',re:/git','ls-remote','--heads'/},
  {label:'PR post-failure reconciliation',re:/catch\(error\)[\s\S]*existingPR/}
 ]),
 invariant('delivery-reconciliation-tests','tests/delivery-reconciliation.test.cjs',[
  {label:'push ambiguous success test',re:/reconciles ambiguous command failure/},
  {label:'PR lost response test',re:/reconciles a lost response/},
  {label:'duplicate PR prevention test',re:/never duplicates an already-open PR/}
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
   'tests/update-state.test.cjs',
   'tests/delivery-reconciliation.test.cjs',
   'tests/authenticode.test.cjs',
   'scripts/license-audit.cjs',
   'scripts/requirements-coverage.cjs',
   'scripts/blueprint-coverage.cjs',
   'tests/human-controls.test.cjs'
  ],
  exactCommitCIGates:[
   'AECP CI must succeed on the exact commit',
   'AECP Security must succeed on the exact commit',
   'AECP Packaging must build x64/ARM64/universal installers, build and validate x64/ARM64 Store AppX packages, pass install/uninstall smoke, and pass real installer upgrade/rollback smoke on the exact commit'
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
