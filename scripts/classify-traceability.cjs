'use strict';

// Evidence decisions are explicit and reviewed clause-by-clause. This script
// applies the two work-order batches without re-extracting Blueprint text.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const matrixFile=path.join(root,'.ai','TRACEABILITY.json');
const matrix=JSON.parse(fs.readFileSync(matrixFile,'utf8'));
const items=new Map(matrix.items.map(item=>[item.id,item]));
const batch=process.argv[2];
if(!['0010','0011','sync-shared'].includes(batch))throw Error('Use 0010, 0011 or sync-shared.');
const initialGapIds=matrix.items.filter(x=>x.status==='GAP').map(x=>x.id);
const changed=[];
function set(id,status,fields){
  const item=items.get(id);if(!item)throw Error(`Unknown clause ${id}`);
  if(item.status!=='GAP'&&!(id==='B12-L134'&&batch==='0011'&&item.status==='PARTIAL'))throw Error(`${id} was already classified as ${item.status}`);
  Object.assign(item,{status,...fields});
  if(!['GAP','PARTIAL','CONFIRMED_GAP'].includes(status))delete item.workOrder;
  changed.push(id);
}
const I=(id,file,name,covers)=>set(id,'IMPLEMENTED',{evidence:[{file,kind:'test',name,...(covers?{covers}:{})}],note:'Clause-specific named test observes the cited behavior.'});
const P=(id,file,name,note)=>set(id,'PARTIAL',{evidence:[{file,kind:'code',name}],workOrder:'UNASSIGNED',note});
const C=(id,file,symbol,description,note)=>set(id,'CONFIRMED_GAP',{evidence:[{file,symbol,description}],workOrder:'UNASSIGNED',note});
const M=(id,section,note)=>set(id,'MANUAL',{evidence:[],protocol:{file:'.ai/ACCEPTANCE.md',section},note});
const E=(id,note)=>set(id,'ENVIRONMENT',{evidence:[],acceptanceRef:{file:'.ai/ACCEPTANCE.md',section:'## 5. ENVIRONMENT / OWNER 項目的驗收協定'},note});
const O=(id,note)=>set(id,'OWNER',{evidence:[],acceptanceRef:{file:'.ai/ACCEPTANCE.md',section:'## 5. ENVIRONMENT / OWNER 項目的驗收協定'},note});
const D=(id,note)=>set(id,'DELIBERATE_NON_GOAL',{evidence:[],decisionRef:{file:'.ai/BLUEPRINT.md',section:'## 4. 永久邊界 / Non-Goals'},note});

if(batch==='0010'){
  const first='tests/traceability-first-batch.test.cjs';
  for(const [id,name] of Object.entries({
    'B04-ELECTRON-L28':'context isolation remains enabled',
    'B04-ELECTRON-L29':'renderer Node integration remains disabled',
    'B04-ELECTRON-L30':'renderer sandbox remains enabled',
    'B04-ELECTRON-L31':'remote module is not enabled',
    'B04-ELECTRON-L32':'preload exposes named IPC methods rather than generic invoke',
    'B04-ELECTRON-L35':'unsolicited windows are denied',
    'B04-ELECTRON-L36':'external links require HTTPS before OS-browser opening',
    'B04-ELECTRON-L37':'remote ChatGPT origin receives no preload',
    'B04-ELECTRON-L38':'local UI has a restrictive Content Security Policy',
    'B04-RED-L65':'deletion requires explicit approval',
    'B04-RED-L67':'credential use requires explicit approval',
    'B04-RED-L68':'outside-workspace paths remain denied even after approval',
    'B04-RED-L69':'system actions require explicit approval',
    'B11-L44':'Command Card requires both title and goal',
    'B11-8-L136':'Command Card rejects input above 64 KiB',
    'B11-8-L138':'Result Capsule stays well below clipboard ceiling'
  }))I(id,first,`${id} ${name}`);

  // Electron and security clauses: atomic settings receive tests; composite
  // threat-model statements remain partial where a specific subclaim is open.
  C('B04-ELECTRON-L33','electron/main.cjs','control-plane:approve-delivery',
    'IPC handler forwards a raw payload without a complete per-channel argument schema.',
    'Add uniform main-process argument validation for every IPC channel; preserve existing permission checks.');
  C('B04-ELECTRON-L34','electron/main.cjs','will-navigate',
    'Navigation handler permits any file: URL rather than only the packaged local UI origin.',
    'Restrict navigation to the known local UI document and deny other file: destinations.');
  I('B04-L103','tests/workspace-policy.test.cjs','main process persists Workspace policy and applies it to Harness and Control Plane');
  I('B04-L112','tests/security-recovery-matrix.test.cjs','policy rejects lexical traversal and sibling-prefix escapes');
  I('B04-L196','tests/provider-router.test.cjs','fixed local-command provider uses only its registered executable and arguments');
  P('B04-L11','electron/lib/security-policy.cjs','SecurityPolicy','Policy is outside the provider, but this broad compromise scenario lacks an adversarial end-to-end test.');
  P('B04-L13','electron/lib/security-policy.cjs','SecurityPolicy','Policy engine exists; coverage of every provider-to-tool boundary is not yet demonstrated.');
  P('B04-L129','electron/lib/redaction.cjs','redactSensitive','Central redaction exists, but every listed persistence/clipboard surface has not been exhaustively proven secret-free.');
  P('B04-L157','electron/main.cjs','createMainWindow','Preview labeling exists in README/UI, but installed bootstrap and SmartScreen presentation lack direct acceptance evidence.');
  P('B04-L179','electron/main.cjs','getOrCreateLocalMcpToken','MCP bearer uses OS encryption, but no end-to-end negative log/Result Capsule leakage test covers every route.');
  P('B04-L185','electron/main.cjs','startLocalMcp','MCP binds a Workspace at startup; active-server scope across Workspace switching lacks an integration assertion.');
  P('B04-RED-L66','electron/lib/security-policy.cjs','PUSH','PUSH is RED/approval-gated; publish/release controls are separate and not covered by one policy test.');
  P('B04-RED-L70','electron/lib/security-policy.cjs','SYSTEM','SYSTEM is approval-gated, but explicit admin/elevation commands are unsupported rather than separately classified.');
  P('B04-RED-L71','electron/lib/security-policy.cjs','ACTIONS','No billing action is exposed; a future billing adapter would need an explicit deny/approval decision.');
  I('B04-RED-L72','tests/workspace-policy.test.cjs','RED capability approvals cannot be removed by the policy editor model');
  for(const id of ['B04-L5','B04-L141','B04-L193'])D(id,
    'Non-atomic introductory/heading text was extracted as a standalone clause; its concrete child prohibitions are audited individually. No independent executable action is authorized.');

  C('B11-4-CONTEXT','electron/lib/context-bus.cjs','aecp.capsule/v1',
    'ContextBus persists aecp.capsule/v1 for context instead of the specified aecp.context/v1 envelope.',
    'Define a versioned context adapter/migration or obtain a Blueprint equivalence decision; do not rename persisted records in place.');
  P('B11-5-RESULT','electron/lib/protocol.cjs','makeResultCapsule','aecp.result/v1 and size/redaction exist, but the complete Result Capsule field contract is not checked in one behavioral test.');
  P('B11-6-TRACE','electron/main.cjs','appendTrace','aecp.trace/v1 is written; sequence durability and full event schema across restart are not yet covered.');
  P('B11-7-CLIPBOARD','electron/lib/protocol.cjs','parseCommandCard','Framing and explicit UI gestures exist, but the clipboard ingress/egress contract is not exercised end-to-end.');
  C('B11-8-L137','electron/main.cjs','text.length > 128 * 1024',
    'Clipboard write limit counts UTF-16 code units, not UTF-8 bytes; CJK may exceed 128 KiB in bytes.',
    'Enforce Buffer.byteLength(text, utf8) <= 128 KiB at the clipboard write boundary.');
  P('B11-L103','electron/lib/protocol.cjs','makeResultCapsule','Result Capsule is bounded/redacted, but all large artifact references and every output route are not proven.');
  P('B11-L46','electron/main.cjs','task:import','Command Card requested permissions are stored but import risk remains GREEN; add a negative test proving no requested permission is ever granted.');
  I('B11-L53','tests/protocol.test.cjs','rejects unsupported action capabilities');
  P('B11-L61','electron/lib/protocol.cjs','ACTION_TYPES','Preview exposes two fixed read-only actions, but per-action schema/risk/verifier metadata is not explicit in the public contract.');

  I('B18-13-13','tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call');
  I('B18-13-14','tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call');
  P('B18-13-15','.github/workflows/release.yml','build-auto','Workflow has architecture build jobs; exact-HEAD installer packaging remains a CI result, not a local test claim.');

  I('B20-27-01','tests/harness-bounds.test.cjs','Harness persists the complete Goal Loop contract and checkpoint evidence');
  I('B20-27-04','tests/autonomy.test.cjs','failed verification triggers another bounded iteration and can then pass');
  I('B20-27-05','tests/harness-bounds.test.cjs','Harness stops repeated no-progress attempts before infinite rework');
  I('B20-27-12','tests/control-plane.test.cjs','restart recovery never auto-resumes a mutating mission even when autoResume was enabled');
  I('B20-27-20','tests/accepted-evidence.test.cjs','accepted-task evidence contains every reproducibility field required by Blueprint 20');
  P('B20-27-02','electron/lib/control-plane.cjs','executeTask','Scheduler and Harness dispatch exist; absence of manual transfer is not directly asserted in an end-to-end UI test.');
  P('B20-27-03','electron/lib/harness.cjs','prepareWorktree','Worktree isolation exists; per-task authorization and all equivalent worker adapters need one integrated test.');
  P('B20-27-08','electron/lib/control-plane.cjs','schedule','Queue selection exists; next eligible dispatch after completion lacks a direct behavioral test.');
  P('B20-27-10','electron/lib/control-plane.cjs','ci.passed','CI event includes run/task/SHA, but webhook/polling correlation across real GitHub runs needs direct test.');
  P('B20-27-14','electron/lib/security-policy.cjs','SecurityPolicy','Policy is outside model; every provider/role escalation path has not been adversarially proven.');
  P('B20-27-15','electron/lib/control-plane.cjs','approveDelivery','Merge gate exists; complete high-risk action set has no single proof.');
  P('B20-27-16','electron/lib/provider-router.cjs','ProviderRouter','Provider substitution exists, but persisted Task schema invariance across all role swaps is not directly tested.');
  P('B20-27-17','electron/main.cjs','chatgpt:open','Official Web opens externally; non-interference across every integration path needs a manual/security review.');
  P('B20-27-18','electron/lib/provider-router.cjs','ProviderRouter','External adapters share Task schema; real credentials and environment compatibility remain separately gated.');

  C('B21-10-03','electron/lib/evidence-manager.cjs','async write',
    'EvidenceManager.write overwrites a stable file path; an old path reference can point to different bytes.',
    'Use immutable content-addressed evidence paths or versioned references with SHA verification.');
  P('B21-10-05','electron/lib/security-policy.cjs','SecurityPolicy','Central policy is separate from providers, but cross-provider permission mutation has no dedicated adversarial test.');
  P('B21-10-06','electron/lib/review-report.cjs','validateReviewReport','Review result is parsed into state, but a negative test should prove report text cannot trigger actions.');
  C('B21-10-08','electron/lib/protocol.cjs','makeResultCapsule',
    'makeResultCapsule accepts status PASS even when verification is missing or UNKNOWN.',
    'Require positive deterministic verification before serializing PASS, or make an explicit unverified status.');

  P('R1.1','electron/main.cjs','chatgpt:open','Official site opens in OS browser; broad absence of DOM/session/network interference still needs manual security audit.');
  P('R1.2','electron/main.cjs','createMainWindow','Isolation/sandbox/preload are configured, but arbitrary file: navigation and incomplete IPC argument validation remain confirmed sub-gaps.');
  P('R1.4','electron/main.cjs','safeStorage','OS-backed encryption and credential refs exist, but all credential persistence routes lack a unified behavioral proof.');
  I('R2.2','tests/harness.test.cjs','Provider Router-backed Harness role selection is explicit and vendor-neutral');
  I('R2.3','tests/autonomy.test.cjs','bounded runner isolates writes in worktree then applies only after explicit apply call');
  I('R2.4','tests/accepted-evidence.test.cjs','accepted-task evidence validation fails closed on missing verification review or patch hash');
  I('R2.6','tests/control-plane.test.cjs','restart recovery never auto-resumes a mutating mission even when autoResume was enabled');
  P('R2.1','electron/lib/control-plane.cjs','ControlPlane','Durable bounded state exists, but end-to-end transition coverage for every terminal state is incomplete.');
  P('R2.7','electron/lib/control-plane.cjs','approveDelivery','Merge checks CI and approval; complete high-risk delivery and publication paths need more evidence.');
  I('R3.1','tests/control-plane.test.cjs','ControlPlane stores explicit provider roles and scopes policy to the mission workspace');
  I('R3.3','tests/provider-router.test.cjs','fixed local-command provider uses only its registered executable and arguments');
  I('R3.5','tests/execution-contract.test.cjs','cross-mode contracts keep Workspace and policy boundaries explicit rather than changing permission by transport');
  P('R3.10','electron/lib/worker-registry.cjs','WorkerRegistry','Task-scoped cancellation is tested; Safe Bridge survival under real worker failure remains an environment gate.');
  P('R3.2','electron/lib/provider-router.cjs','ProviderRouter','Built-in and fixed commands exist, but every listed provider/role substitution is not covered against unchanged state schema.');
  P('R3.6','electron/main.cjs','chatgpt:open','Safe Bridge is independent in code; failure injection across all optional providers remains untested.');
  P('R3.7','electron/lib/worker-registry.cjs','WorkerRegistry','Provider and Worker identities are separate; all Mission/Task/Queue/Harness schemas need a cross-provider invariance test.');
  P('R3.9','electron/lib/pega-provider.cjs','PEGA','PEGA adapter exists; actual endpoint/model/auth compatibility requires ENVIRONMENT evidence and cannot be closed by source tests.');
  P('R4.1','electron/lib/resource-manager.cjs','ResourceManager','Repository discovery/binding exists, but one Mission routing tasks to multiple approved repositories lacks end-to-end proof.');
  P('R4.3','electron/lib/delivery.cjs','DeliveryManager','Governed PR creation and SHA CI monitor exist, but full correlation/branch lifecycle lacks one integrated test.');
  I('R4.4','tests/control-plane-hardening.test.cjs','GitHub webhook verifies HMAC and deduplicates delivery identity');
  P('R4.5','electron/lib/failure-recovery.cjs','recommend','CI failure classification exists; safe bounded rework for all failure categories lacks direct integration proof.');
  P('R4.6','electron/lib/control-plane.cjs','approveDelivery','CI plus human approval checks are implemented; no direct negative test covers both conditions together.');
  I('R4.7','tests/control-plane.test.cjs','same-repository parallel tasks receive distinct task-scoped worktree locks while Git admin stays serialized');
  P('R5.1','electron/lib/control-plane.cjs','persist','Mission/task/event persistence is tested, but all evidence survival paths after process restart are not.');
  I('R5.2','tests/accepted-evidence.test.cjs','Control Plane persists accepted evidence and a SHA manifest before publishing Result Capsule');
  P('R5.4','electron/lib/maintenance.cjs','MaintenanceManager','Expired lock/context cleanup exists; evidence retention and orphan worktree budget cases need specific tests.');
  I('R5.5','tests/control-plane-hardening.test.cjs','drift scanner detects missing authoritative files without mutating the workspace');
  I('R6.1','tests/mcp-server.test.cjs','Local MCP starts on loopback, exposes health, and rejects missing bearer auth');
  P('R6.2','electron/mcp-server.mjs','startLocalMcpServer','Preview MCP is read-only; complete tool capability inventory and raw-shell absence need a dedicated contract test.');
  I('R6.3','tests/remote-pairing.test.cjs','remote gateway supports one-time pairing and revocation');
  P('R6.4','electron/lib/remote-gateway.cjs','RemoteGateway','READ_ONLY pairing is tested, but all privileged actions need negative tests.');
  I('R6.5','tests/remote-pairing.test.cjs','remote gateway refuses non-loopback exposure without explicit enablement and TLS');
  I('R7.1','tests/release-workflow.test.cjs','universal bootstrap embeds both architecture payloads');
  I('R7.2','tests/release-workflow.test.cjs','release workflow is structurally unique and gated by real smoke evidence');
  I('R7.3','tests/release-workflow.test.cjs','release workflow is structurally unique and gated by real smoke evidence');
  O('R7.4','Production signing, Store publication and trusted provenance require owner certificate/account evidence; repository wiring is not completion.');
  P('R7.5','electron/main.cjs','createMainWindow','The local UI and Safe Bridge do not request an OpenAI API key, but clean-install operation without one needs an acceptance run.');
  I('R8.1','tests/human-controls.test.cjs','Workspace authorization is explicit and never silently expanded by first-run logic');
  P('R8.2','ui/app.js','engineering-mode','Both views share state, but a rendered cross-mode equality test is absent.');
  I('R8.3','tests/human-controls.test.cjs','clipboard bridge remains explicit user-triggered rather than background-polled');
  P('R8.4','ui/harness-console.js','render','Visible fields exist, but all Goal/Done/risk/evidence/approval combinations are not asserted.');
  I('R8.5','tests/human-controls.test.cjs','human pause cancel and emergency stop controls remain authoritative');

  const expected=initialGapIds.filter(id=>(/^R[1-8]\.|^B04-|^B18-13-(13|14|15)$|^B20-27-|^B21-10-|^B11-/.test(id)));
  const missing=expected.filter(id=>!changed.includes(id));
  if(missing.length)throw Error(`0010 batch incomplete: ${missing.join(', ')}`);
}

if(batch==='0011'){
  // Visual/installed-product claims cannot be promoted by source inspection.
  M('B01-A11Y-L172','### 6.1 視覺、對比與縮放','Measure text contrast at 4.5:1 in both themes on installed UI.');
  I('B01-A11Y-L174','tests/i18n-accessibility.test.cjs','HTML exposes keyboard and screen-reader landmarks');
  M('B01-A11Y-L175','### 6.1 視覺、對比與縮放','Inspect every status with color removed and screen reader output.');
  I('B01-A11Y-L176','tests/i18n-accessibility.test.cjs','styles provide visible focus and reduced-motion support');
  M('B01-A11Y-L177','### 6.1 視覺、對比與縮放','Windows 125, 150 and 200 percent scaling needs an installed-app layout check.');
  M('B01-A11Y-L178','### 6.1 視覺、對比與縮放','1366x768 and 1920x1080 layouts need visual acceptance.');
  I('B01-A11Y-L179','tests/i18n-accessibility.test.cjs','theme control supports system dark and light modes and follows OS changes in system mode');
  I('B01-A11Y-L180','tests/i18n-accessibility.test.cjs','localization framework supports English and Traditional Chinese with persisted locale');
  D('B01-L148','Embedded ChatGPT is explicitly optional and is not implemented; the supported official path is an external browser without privileged preload.');
  M('B01-L160','### 6.1 視覺、對比與縮放','Relative brand prominence needs human inspection of the installed interface.');
  M('B01-L27','### 6.3 Electron 實機流程','Official browser externalized while the AECP right pane stays usable needs installed-app observation.');
  M('B01-L6','### 6.1 視覺、對比與縮放','Branding and current trademark presentation need owner review.');
  P('B01-L67','ui/app.js','engineering-mode','Mode only changes renderer projection; a cross-mode policy-decision equivalence test is missing.');

  P('B02-L109','electron/lib/lock-manager.cjs','recover','Expired locks are recovered and persisted, but the persisted record does not retain the reason for release.');
  D('B02-L156','Introductory line to the five startup requirements; inspect the numbered child clauses rather than treating this colon as an independent executable behavior.');
  I('B02-L161','tests/control-plane.test.cjs','restart recovery never auto-resumes a mutating mission even when autoResume was enabled');
  P('B02-L207','electron/lib/control-plane.cjs','createMission','Durable tasks and bounded scheduler exist, but dependency and decision-explanation persistence across restart lacks a combined proof.');
  P('B02-L95','electron/lib/security-policy.cjs','SecurityPolicy','Policy decisions are external to model text; end-to-end malicious-model permission-escalation injection is not proven.');

  P('B03-L113','electron/main.cjs','saveProvider','Encrypted credential store exists, but an exhaustive tracked-YAML/JSON and all-provider negative leakage test is absent.');
  P('B03-L116','electron/main.cjs','saveProvider','Provider UI uses stored-credential boolean; every read response needs a plaintext-absence test.');
  P('B03-L129','electron/lib/provider-router.cjs','health','Bounded health checks have tests, but Safe Bridge survival during a real optional-provider outage remains an environment/manual gate.');
  P('B03-L143','electron/lib/provider-router.cjs','ProviderRouter','Explicit role selection exists; private-context-to-cloud failover needs a negative integration test.');
  P('B03-L168','electron/lib/execution-contract.cjs','contextCapsuleRef','Versioned artifact handoff exists, but the full seven-artifact correlation chain is not asserted.');
  P('B03-L172','electron/lib/harness.cjs','maxTurns','Hard budgets exist; attention-optimization is a product metric without a deterministic no-idle-call test.');
  P('B03-L5','electron/lib/provider-router.cjs','ProviderRouter','Common adapter interface exists; substitution across all supported provider kinds lacks a state-invariance test.');
  P('B03-L56','electron/lib/codex-worker-runtime.cjs','codexHome','Distinct CODEX_HOME directories are tested; exhaustive session/runtime-state non-sharing needs a negative integration test.');
  P('B03-L68','electron/lib/codex-worker-runtime.cjs','normalizeWireApi','Wire API normalization exists; real endpoint Chat Completions/Responses compatibility is environment-dependent.');
  P('B03-L70','electron/lib/control-plane.cjs','builderWorkers','Worker selection is identity-based; all Mission/Queue/Harness branches need an explicit provider-neutral invariant test.');

  P('B05-L118','electron/lib/github-webhook.cjs','GitHubWebhookReceiver','Signed webhook correlation exists; repository_dispatch/workflow_dispatch versioning and task-state non-mutation need end-to-end evidence.');
  P('B05-L132','electron/lib/control-plane.cjs','schedulerDecision','Task worktree locks exist; dependency analysis before parallel launch needs dedicated proof.');
  P('B05-L20','electron/lib/resource-manager.cjs','ResourceManager','Local discovery and remote normalization exist; embedded URL credential redaction across every log needs a negative test.');
  P('B05-L34','electron/lib/github-gateway.cjs','GitHubGateway','Git/gh and signed webhook paths exist; full capability limitation of every delivery action needs an integration test. Direct OAuth is optional.');
  P('B05-L5','electron/lib/resource-manager.cjs','ResourceManager','Local Git works without GitHub login; multiple remotes/accounts bound to one Workspace lacks an end-to-end test.');
  P('B05-L88','electron/lib/lock-manager.cjs','LockManager','Task-scoped write locks exist, but deterministic cross-repository acquisition ordering or BLOCKED fallback lacks a test.');
  P('B05-L93','electron/lib/control-plane.cjs','builderWorkers','Worker pool uses task worktrees; a direct OFFICIAL/PEGA same-worktree collision rejection test is absent.');

  M('B14-L5','### 6.3 Electron 實機流程','Product cohesion is subjective and needs installed-app operator assessment.');
  P('B14-L15','electron/lib/guidance.cjs','recommendNextAction','Guidance detects safe next steps, but every data-access/blast-radius change needs explicit boundary coverage.');
  D('B14-L165','Introductory colon to Goal Loop required-field list; the nine concrete field entries are assessed separately.');
  I('B14-L193','tests/human-controls.test.cjs','Goal Loop is visibly bounded and exposes deterministic terminal states');
  P('B14-L263','electron/lib/provider-router.cjs','ProviderRouter','Harness uses provider roles, but full vendor-substitution invariance is not yet established.');
  P('B14-L292','electron/lib/harness.cjs','runHarness','Evidence/checkpoints are owned by Harness; provider-failure workspace-integrity injection needs end-to-end proof.');
  I('B14-L298','tests/human-controls.test.cjs','Goal Loop provides bounded task-shaped presets without bypassing approval policy');
  P('B14-L349','electron/lib/security-policy.cjs','SecurityPolicy','Risk policy gates actions; all Goal Loop UI choices and policy outcomes need a cross-view equivalence test.');
  P('B14-L419','electron/lib/control-plane.cjs','recover','Restart recovery exists; complete loop/task/evidence reconstruction needs a full-process crash test.');
  P('B14-L438','electron/lib/harness.cjs','runHarness','Autonomy is conditional on capabilities; no proof that every listed provider/adapter/policy combination supports all required steps.');
  P('B14-L88','electron/main.cjs','workspace:select','Workspace selection is explicit; negative whole-disk scan audit should include future onboarding paths.');
  for(const [id,field] of Object.entries({
    'B14-REQUIRED-L167':'goal','B14-REQUIRED-L168':'definitionOfDone',
    'B14-REQUIRED-L169':'maxIterations','B14-REQUIRED-L170':'checkpointEvery',
    'B14-REQUIRED-L171':'workspaceId','B14-REQUIRED-L172':'providerPolicy',
    'B14-REQUIRED-L173':'permissionPolicy','B14-REQUIRED-L174':'verificationPolicy',
    'B14-REQUIRED-L175':'stopConditions'
  }))P(id,'ui/app.js',field,`Web Goal Loop prompt contains ${field}; persisted local Harness contract uses a different representation, so cross-mode field equivalence is not established.`);

  P('B15-L117','electron/lib/windows-desktop-adapter.cjs','listBrowserWindows','Adapters are fixed-capability and deny by default; no test asserts the UI never reports an adapter as available when detection fails.');
  P('B15-L12','electron/main.cjs','chatgpt:open','Official browser and GitHub credentials are separate in code; a credential-cross-contamination regression test is absent.');
  P('B15-L291','electron/lib/update-state.cjs','targetVersion','Universal bootstrap is wired, but ordinary installed upgrade architecture choice requires device evidence.');
  D('B15-L324','Introductory non-goal heading; individual prohibitions must be assessed separately rather than calling the colon a runtime capability.');
  P('B15-L40','electron/lib/update-state.cjs','createUpdateTransaction','Verified release transaction exists; an installed-app test should prove chat-supplied or arbitrary-branch artifacts are never installed.');
  D('B15-L61','Future first-party OAuth/device-flow adapter is expressly optional; existing Git/gh route is assessed separately.');
  P('B15-L84','electron/lib/authenticode.cjs','normalizeThumbprint','Signer pin and rollback verification have automated tests; actual signed stable installer needs owner certificate and device evidence.');
  P('B15-L90','electron/lib/update-state.cjs','ROLLBACK_REQUIRED','Rollback state machine is tested, but stable installer rollback on real installed machines remains an environment gate.');

  P('B16-L171','electron/lib/provider-usage.cjs','ProviderUsageStore','Usage/status surface exists; every adapter quota representation and no-unlimited implication needs a UI audit.');
  P('B16-L190','electron/lib/provider-router.cjs','ProviderRouter','Governed CLI roles and isolated Codex workers exist; quota/capability behavior for all four CLIs is not environment-proven.');
  P('B16-L229','electron/main.cjs','getOrCreateLocalMcpToken','Local MCP bearer uses safeStorage; official tunnel credentials require product/environment verification.');
  P('B16-L233','electron/mcp-server.mjs','startLocalMcpServer','MCP tools are semantic in preview; a complete negative unrestricted-shell contract test is pending.');
  I('B16-L286','tests/human-controls.test.cjs','Execution Mode recommendation is factual and never promotes generic MCP endpoint health to Official Full MCP');
  P('B16-L292','electron/lib/execution-contract.cjs','makeExecutionContract','Canonical task contract exists; all execution modes need the same-field round-trip test.');
  P('B16-L335','electron/main.cjs','chatgpt:open','Official browser opens externally; a full remote-supervision no-DOM-scraping audit is missing.');
  O('B16-L85','Partner Center identity, publisher and certification values must be supplied by owner; repository wiring does not close the gate.');
  O('B16-L91','Partner Center values must match the owner account exactly; no source-only evidence can prove this.');

  P('B12-L134','electron/lib/state-migration.cjs','schemaVersion','Blueprint owner decision D7 accepts the persisted aecp.<name>/vN schema identifier as equivalent to schemaVersion, so no rename is needed. Remaining gap: a test proving every persisted store carries a versioned schema identifier.');
  const missing=initialGapIds.filter(id=>!changed.includes(id));
  if(missing.length)throw Error(`0011 batch incomplete: ${missing.join(', ')}`);
}
if(batch==='sync-shared')items.get('R8.2').evidence[0].name='engineering-mode';
if(batch==='sync-shared')items.get('B18-13-14').evidence=[{file:'tests/autonomy.test.cjs',kind:'test',name:'bounded runner isolates writes in worktree then applies only after explicit apply call'}];

// Exact shared-test scope is carried by every citation, not inferred from a
// broad test name. These six clauses cite assertions in one autonomy test.
const sharedAutonomy=['B18-13-05','B18-13-06','B18-13-10','B18-13-12','B18-13-13','B18-13-14','R2.3'];
for(const id of sharedAutonomy){
  const item=items.get(id);
  const evidence=item?.evidence?.find(e=>e.kind==='test'&&e.file==='tests/autonomy.test.cjs'&&e.name==='bounded runner isolates writes in worktree then applies only after explicit apply call');
  if(evidence)evidence.covers=sharedAutonomy;
}

fs.writeFileSync(matrixFile,JSON.stringify(matrix,null,2)+'\n');
process.stdout.write(`${batch}: ${changed.length} clauses classified\n`);
