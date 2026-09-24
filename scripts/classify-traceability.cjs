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
const I=(id,file,name)=>set(id,'IMPLEMENTED',{evidence:[{file,kind:'test',name}],note:'Clause-specific named test observes the cited behavior.'});
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
  throw Error('0011 classification table is not yet populated.');
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
