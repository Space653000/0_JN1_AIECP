# 施工單 0013 的分批清單（自動產生，2026-09-25）

來源：`.ai/TRACEABILITY.json` 中狀態為 `PARTIAL` 的條文，共 **89** 條，依風險分組後每批最多 10 條。**一次只做一批**，做完照 0013 的流程驗證、提交、回報，再換下一批。

欄位：`ID`｜條文摘要｜目前缺什麼（`note`）｜行為所在的程式碼（`evidence`）。

## 群組 1：信任邊界與機密（最高風險）（13 條）

### 批次 1（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B04-L11 | - a compromised provider must not automatically gain unrestricted local control. | Policy is outside the provider, but this broad compromise scenario lacks an adversarial end-to-end test. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B04-L13 | Therefore provider reasoning is never the security boundary. The Local Policy Engine is. | Policy engine exists; coverage of every provider-to-tool boundary is not yet demonstrated. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B04-L129 | Secrets must not appear in: | Central redaction exists, but every listed persistence/clipboard surface has not been exhaustively proven secret-free. | electron/lib/redaction.cjs `redactSensitive` |
| B04-L157 | - unsigned bootstrap builds must be labeled clearly; Windows SmartScreen warnings are expe | Preview labeling exists in README/UI, but installed bootstrap and SmartScreen presentation lack direct acceptance evidence. | electron/main.cjs `createMainWindow` |
| B04-L179 | - never log the bearer or include it in Result Capsules; | MCP bearer uses OS encryption, but no end-to-end negative log/Result Capsule leakage test covers every route. | electron/main.cjs `getOrCreateLocalMcpToken` |
| B04-L185 | - changing Workspace must not silently expand an already-running server's scope. | MCP binds a Workspace at startup; active-server scope across Workspace switching lacks an integration assertion. | electron/main.cjs `startLocalMcp` |
| B04-RED-L66 | - git push/publish/release | PUSH is RED/approval-gated; publish/release controls are separate and not covered by one policy test. | electron/lib/security-policy.cjs `PUSH` |
| B04-RED-L70 | - admin/elevation | SYSTEM is approval-gated, but explicit admin/elevation commands are unsupported rather than separately classified. | electron/lib/security-policy.cjs `SYSTEM` |
| B04-RED-L71 | - payment/billing | No billing action is exposed; a future billing adapter would need an explicit deny/approval decision. | electron/lib/security-policy.cjs `ACTIONS` |
| R1.1 | Official ChatGPT remains an external official surface. AECP must not scrape its DOM, copy  | Official site opens in OS browser; broad absence of DOM/session/network interference still needs manual security audit. | electron/main.cjs `chatgpt:open` |

### 批次 2（3 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| R1.4 | Credentials are represented by opaque references and protected with OS-backed storage when | OS-backed encryption and credential refs exist, but all credential persistence routes lack a unified behavioral proof. | electron/main.cjs `safeStorage` |
| R6.2 | Local MCP preview tools are capability-scoped/read-only; no raw shell is exposed. | Preview MCP is read-only; complete tool capability inventory and raw-shell absence need a dedicated contract test. | electron/mcp-server.mjs `startLocalMcpServer` |
| R6.4 | Pairing does not grant write/execute/merge/credential/system authority. | READ_ONLY pairing is tested, but all privileged actions need negative tests. | electron/lib/remote-gateway.cjs `RemoteGateway` |

## 群組 2：核心迴圈、復原、鎖與多倉庫（31 條）

### 批次 3（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B02-L95 | Raw AI text must never grant its own permission. | Policy decisions are external to model text; end-to-end malicious-model permission-escalation injection is not proven. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B02-L109 | A stale write lock never disappears silently; recovery records why it was released. | Expired locks are recovered and persisted, but the persisted record does not retain the reason for release. | electron/lib/lock-manager.cjs `recover` |
| B02-L207 | Tasks are durable objects with dependencies, priority, role, Workspace/repository bindings | Durable tasks and bounded scheduler exist, but dependency and decision-explanation persistence across restart lacks a combined proof. | electron/lib/control-plane.cjs `createMission` |
| B05-L5 | GitHub is a first-class resource provider, but local Git operation must continue to work w | Local Git works without GitHub login; multiple remotes/accounts bound to one Workspace lacks an end-to-end test. | electron/lib/resource-manager.cjs `ResourceManager` |
| B05-L20 | AECP detects local repositories first. Remote identity is derived from `git remote -v` and | Local discovery and remote normalization exist; embedded URL credential redaction across every log needs a negative test. | electron/lib/resource-manager.cjs `ResourceManager` |
| B05-L34 | The canonical governed delivery path currently uses authenticated Git/`gh` primitives plus | Git/gh and signed webhook paths exist; full capability limitation of every delivery action needs an integration test. Direct OAuth is optional. | electron/lib/github-gateway.cjs `GitHubGateway` |
| B05-L88 | Write lock/resource ownership is enforced by Harness/Resource Manager/Lock Manager. Read t | Task-scoped write locks exist, but deterministic cross-repository acquisition ordering or BLOCKED fallback lacks a test. | electron/lib/lock-manager.cjs `LockManager` |
| B05-L93 | - `codex-official` and `codex-pega` must never be assigned the same mutating worktree conc | Worker pool uses task worktrees; a direct OFFICIAL/PEGA same-worktree collision rejection test is absent. | electron/lib/control-plane.cjs `builderWorkers` |
| B05-L118 | `repository_dispatch` may carry a versioned AECP event and correlation IDs; `workflow_disp | Signed webhook correlation exists; repository_dispatch/workflow_dispatch versioning and task-state non-mutation need end-to-end evidence. | electron/lib/github-webhook.cjs `GitHubWebhookReceiver` |
| B05-L132 | Parallel work is allowed only after dependency/resource analysis. Repository write conflic | Task worktree locks exist; dependency analysis before parallel launch needs dedicated proof. | electron/lib/control-plane.cjs `schedulerDecision` |

### 批次 4（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B14-L292 | Provider failure must not corrupt Workspace state. The Harness owns task state, evidence a | Evidence/checkpoints are owned by Harness; provider-failure workspace-integrity injection needs end-to-end proof. | electron/lib/harness.cjs `runHarness` |
| B14-L349 | Goal Loop must integrate with the existing risk policy. | Risk policy gates actions; all Goal Loop UI choices and policy outcomes need a cross-view equivalence test. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B20-27-02 | Harness dispatches a task without manual copy/paste between Claude and Codex. | Scheduler and Harness dispatch exist; absence of manual transfer is not directly asserted in an end-to-end UI test. | electron/lib/control-plane.cjs `executeTask` |
| B20-27-03 | Worker executes only inside an authorized isolated worktree. | Worktree isolation exists; per-task authorization and all equivalent worker adapters need one integrated test. | electron/lib/harness.cjs `prepareWorktree` |
| B20-27-08 | Queue dispatches the next eligible task. | Queue selection exists; next eligible dispatch after completion lacks a direct behavioral test. | electron/lib/control-plane.cjs `schedule` |
| B20-27-10 | GitHub CI results return as correlated events. | CI event includes run/task/SHA, but webhook/polling correlation across real GitHub runs needs direct test. | electron/lib/control-plane.cjs `ci.passed` |
| B20-27-14 | No agent can grant itself permissions. | Policy is outside model; every provider/role escalation path has not been adversarially proven. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B20-27-15 | Human approval protects configured high-risk operations. | Merge gate exists; complete high-risk action set has no single proof. | electron/lib/control-plane.cjs `approveDelivery` |
| B20-27-16 | Provider can be changed without rewriting Task state. | Provider substitution exists, but persisted Task schema invariance across all role swaps is not directly tested. | electron/lib/provider-router.cjs `ProviderRouter` |
| B20-27-17 | Official ChatGPT Web remains untouched. | Official Web opens externally; non-interference across every integration path needs a manual/security review. | electron/main.cjs `chatgpt:open` |

### 批次 5（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B20-27-18 | External/OpenAI-compatible providers can be attached through adapters without changing Tas | External adapters share Task schema; real credentials and environment compatibility remain separately gated. | electron/lib/provider-router.cjs `ProviderRouter` |
| B21-10-05 | A provider cannot change another provider's permissions. | Central policy is separate from providers, but cross-provider permission mutation has no dedicated adversarial test. | electron/lib/security-policy.cjs `SecurityPolicy` |
| B21-10-06 | A review result is not an execution command. | Review result is parsed into state, but a negative test should prove report text cannot trigger actions. | electron/lib/review-report.cjs `validateReviewReport` |
| R2.1 | Engineering work follows a durable bounded state machine rather than an unbounded agent ch | Durable bounded state exists, but end-to-end transition coverage for every terminal state is incomplete. | electron/lib/control-plane.cjs `ControlPlane` |
| R2.7 | High-risk delivery remains human-gated after CI success. | Merge checks CI and approval; complete high-risk delivery and publication paths need more evidence. | electron/lib/control-plane.cjs `approveDelivery` |
| R4.1 | A Mission can discover and route tasks to multiple repositories inside its approved resour | Repository discovery/binding exists, but one Mission routing tasks to multiple approved repositories lacks end-to-end proof. | electron/lib/resource-manager.cjs `ResourceManager` |
| R4.3 | GitHub delivery uses governed branches/PRs and correlates CI to commit SHA. | Governed PR creation and SHA CI monitor exist, but full correlation/branch lifecycle lacks one integrated test. | electron/lib/delivery.cjs `DeliveryManager` |
| R4.5 | CI failure evidence returns only safely classified failures to bounded rework. | CI failure classification exists; safe bounded rework for all failure categories lacks direct integration proof. | electron/lib/failure-recovery.cjs `recommend` |
| R4.6 | A governed merge requires required CI success and explicit human approval. | CI plus human approval checks are implemented; no direct negative test covers both conditions together. | electron/lib/control-plane.cjs `approveDelivery` |
| R5.1 | Mission/task state, event history and evidence survive process restart. | Mission/task/event persistence is tested, but all evidence survival paths after process restart are not. | electron/lib/control-plane.cjs `persist` |

### 批次 6（1 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| R5.4 | Maintenance handles expired locks, context TTL, evidence retention and orphan worktree cle | Expired lock/context cleanup exists; evidence retention and orphan worktree budget cases need specific tests. | electron/lib/maintenance.cjs `MaintenanceManager` |

## 群組 3：Provider 與 Worker（15 條）

### 批次 7（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B03-L5 | The Local Agent Harness must not care which intelligence provider produced a task. Provide | Common adapter interface exists; substitution across all supported provider kinds lacks a state-invariance test. | electron/lib/provider-router.cjs `ProviderRouter` |
| B03-L56 | The two workers must never share `CODEX_HOME`, auth, session or runtime state. | Distinct CODEX_HOME directories are tested; exhaustive session/runtime-state non-sharing needs a negative integration test. | electron/lib/codex-worker-runtime.cjs `codexHome` |
| B03-L68 | The adapter must negotiate and verify the API family actually available in the environment | Wire API normalization exists; real endpoint Chat Completions/Responses compatibility is environment-dependent. | electron/lib/codex-worker-runtime.cjs `normalizeWireApi` |
| B03-L70 | No PEGA-specific branch is permitted in Task/Mission/Queue/Harness state-machine logic. Fu | Worker selection is identity-based; all Mission/Queue/Harness branches need an explicit provider-neutral invariant test. | electron/lib/control-plane.cjs `builderWorkers` |
| B03-L113 | - API keys never live in repository YAML/JSON. | Encrypted credential store exists, but an exhaustive tracked-YAML/JSON and all-provider negative leakage test is absent. | electron/main.cjs `saveProvider` |
| B03-L116 | - UI only returns masked key metadata, never plaintext after save. | Provider UI uses stored-credential boolean; every read response needs a plaintext-absence test. | electron/main.cjs `saveProvider` |
| B03-L129 | Failure of an optional provider must not prevent Safe Bridge use. The current router expos | Bounded health checks have tests, but Safe Bridge survival during a real optional-provider outage remains an environment/manual gate. | electron/lib/provider-router.cjs `health` |
| B03-L143 | Failover never silently moves private local context to a cloud provider. Any provider chan | Explicit role selection exists; private-context-to-cloud failover needs a negative integration test. | electron/lib/provider-router.cjs `ProviderRouter` |
| B03-L168 | Agents never exchange hidden vendor sessions. They exchange Goal/Plan/Task/Context/Worker- | Versioned artifact handoff exists, but the full seven-artifact correlation chain is not asserted. | electron/lib/execution-contract.cjs `contextCapsuleRef` |
| B03-L172 | The Harness optimizes verified engineering progress per unit of human attention. It must n | Hard budgets exist; attention-optimization is a product metric without a deterministic no-idle-call test. | electron/lib/harness.cjs `maxTurns` |

### 批次 8（5 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| R3.2 | Claude, Codex, Gemini, OpenCode, Ollama-compatible local inference and trusted fixed local | Built-in and fixed commands exist, but every listed provider/role substitution is not covered against unchanged state schema. | electron/lib/provider-router.cjs `ProviderRouter` |
| R3.6 | Optional providers failing or being unconfigured must not break Web Safe Bridge operation. | Safe Bridge is independent in code; failure injection across all optional providers remains untested. | electron/main.cjs `chatgpt:open` |
| R3.7 | Provider identity and Worker runtime identity are separate concepts; Mission/Task/Queue/Ha | Provider and Worker identities are separate; all Mission/Task/Queue/Harness schemas need a cross-provider invariance test. | electron/lib/worker-registry.cjs `WorkerRegistry` |
| R3.9 | PEGA is implemented through the Provider Router/Worker abstraction rather than PEGA-specif | PEGA adapter exists; actual endpoint/model/auth compatibility requires ENVIRONMENT evidence and cannot be closed by source tests. | electron/lib/pega-provider.cjs `PEGA` |
| R3.10 | Worker/provider failure and task-scoped cancellation are isolated; one Worker becoming una | Task-scoped cancellation is tested; Safe Bridge survival under real worker failure remains an environment gate. | electron/lib/worker-registry.cjs `WorkerRegistry` |

## 群組 4：其餘（30 條）

### 批次 9（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B01-L67 | Changing mode never changes permissions by itself. | Mode only changes renderer projection; a cross-mode policy-decision equivalence test is missing. | ui/app.js `engineering-mode` |
| B11-4-CONTEXT | Context Capsule aecp.context/v1 schema and bounded content. | Blueprint owner decision D8 accepts aecp.capsule/v1 as the implementation name for the context capsule, so this is no longer a naming gap. Remaining: a test asserting the capsule bounded con | electron/lib/context-bus.cjs `ContextBus` |
| B11-5-RESULT | Result Capsule aecp.result/v1 schema, no secrets or huge raw logs. | aecp.result/v1 and size/redaction exist, but the complete Result Capsule field contract is not checked in one behavioral test. | electron/lib/protocol.cjs `makeResultCapsule` |
| B11-6-TRACE | Execution Trace aecp.trace/v1 event schema. | aecp.trace/v1 is written; sequence durability and full event schema across restart are not yet covered. | electron/main.cjs `appendTrace` |
| B11-7-CLIPBOARD | Explicit clipboard framing and invalid card rejection. | Framing and explicit UI gestures exist, but the clipboard ingress/egress contract is not exercised end-to-end. | electron/lib/protocol.cjs `parseCommandCard` |
| B11-L46 | - requested permissions never grant themselves; | Command Card requested permissions are stored but import risk remains GREEN; add a negative test proving no requested permission is ever granted. | electron/main.cjs `task:import` |
| B11-L61 | Each action must have an implementation-specific schema, bounded inputs, risk classificati | Preview exposes two fixed read-only actions, but per-action schema/risk/verifier metadata is not explicit in the public contract. | electron/lib/protocol.cjs `ACTION_TYPES` |
| B11-L103 | Result Capsule must not include secrets or huge raw logs. Large artifacts are referenced l | Result Capsule is bounded/redacted, but all large artifact references and every output route are not proven. | electron/lib/protocol.cjs `makeResultCapsule` |
| B12-L134 | Every persisted document includes `schemaVersion`. Future releases apply explicit migratio | Blueprint owner decision D7 accepts the persisted aecp.<name>/vN schema identifier as equivalent to schemaVersion, so no rename is needed. Remaining gap: a test proving every persisted store | electron/lib/state-migration.cjs `schemaVersion` |
| B14-L15 | Everything that can be safely detected should be detected automatically. Everything that c | Guidance detects safe next steps, but every data-access/blast-radius change needs explicit boundary coverage. | electron/lib/guidance.cjs `recommendNextAction` |

### 批次 10（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B14-L88 | This remains explicit by design. AECP must not scan the entire disk to guess which persona | Workspace selection is explicit; negative whole-disk scan audit should include future onboarding paths. | electron/main.cjs `workspace:select` |
| B14-L263 | The Goal Loop never hard-codes a model vendor. | Harness uses provider roles, but full vendor-substitution invariance is not yet established. | electron/lib/provider-router.cjs `ProviderRouter` |
| B14-L419 | If AECP crashes, loop/task state must be recoverable from local state and evidence rather  | Restart recovery exists; complete loop/task/evidence reconstruction needs a full-process crash test. | electron/lib/control-plane.cjs `recover` |
| B14-L438 | Goal Loop becomes fully autonomous only when the selected provider + adapter + policy comb | Autonomy is conditional on capabilities; no proof that every listed provider/adapter/policy combination supports all required steps. | electron/lib/harness.cjs `runHarness` |
| B15-L12 | These chains must remain separate. ChatGPT Web credentials are never reused as GitHub cred | Official browser and GitHub credentials are separate in code; a credential-cross-contamination regression test is absent. | electron/main.cjs `chatgpt:open` |
| B15-L40 | The installed app never pulls arbitrary branches and never installs an artifact directly f | Verified release transaction exists; an installed-app test should prove chat-supplied or arbitrary-branch artifacts are never installed. | electron/lib/update-state.cjs `createUpdateTransaction` |
| B15-L84 | Stable/signed builds now support Authenticode verification in addition to the SHA-256 mani | Signer pin and rollback verification have automated tests; actual signed stable installer needs owner certificate and device evidence. | electron/lib/authenticode.cjs `normalizeThumbprint` |
| B15-L90 | Required stable rollback states: | Rollback state machine is tested, but stable installer rollback on real installed machines remains an environment gate. | electron/lib/update-state.cjs `ROLLBACK_REQUIRED` |
| B15-L117 | Detection and launch are fixed-capability operations. The UI may show an unavailable adapt | Adapters are fixed-capability and deny by default; no test asserts the UI never reports an adapter as available when detection fails. | electron/lib/windows-desktop-adapter.cjs `listBrowserWindows` |
| B15-L291 | The user should never need to identify CPU architecture for an ordinary update. | Universal bootstrap is wired, but ordinary installed upgrade architecture choice requires device evidence. | electron/lib/update-state.cjs `targetVersion` |

### 批次 11（10 條）

| ID | 條文 | 缺什麼 | 行為所在 |
|---|---|---|---|
| B16-L171 | Each adapter has its own authentication/quota rules. AECP must not imply that a provider i | Usage/status surface exists; every adapter quota representation and no-unlimited implication needs a UI audit. | electron/lib/provider-usage.cjs `ProviderUsageStore` |
| B16-L190 | Claude Code, Gemini CLI, Codex CLI and OpenCode are represented through governed role/capa | Governed CLI roles and isolated Codex workers exist; quota/capability behavior for all four CLIs is not environment-proven. | electron/lib/provider-router.cjs `ProviderRouter` |
| B16-L229 | This tunnel credential is not the same as model-token API billing, but it is still an Open | Local MCP bearer uses safeStorage; official tunnel credentials require product/environment verification. | electron/main.cjs `getOrCreateLocalMcpToken` |
| B16-L233 | The MCP surface must expose semantic tools, not an unrestricted shell. | MCP tools are semantic in preview; a complete negative unrestricted-shell contract test is pending. | electron/mcp-server.mjs `startLocalMcpServer` |
| B16-L292 | The canonical task model must remain identical across all modes: | Canonical task contract exists; all execution modes need the same-field round-trip test. | electron/lib/execution-contract.cjs `makeExecutionContract` |
| B16-L335 | 3. Never implement remote supervision by scraping a ChatGPT session. | Official browser opens externally; a full remote-supervision no-DOM-scraping audit is missing. | electron/main.cjs `chatgpt:open` |
| B18-13-15 | x64, ARM64 and Auto-Detect installers still package successfully. | Workflow has architecture build jobs; exact-HEAD installer packaging remains a CI result, not a local test claim. | .github/workflows/release.yml `build-auto` |
| R7.5 | The application remains usable without an OpenAI API key. | The local UI and Safe Bridge do not request an OpenAI API key, but clean-install operation without one needs an acceptance run. | electron/main.cjs `createMainWindow` |
| R8.2 | Beginner and engineering views project the same underlying state. | Both views share state, but a rendered cross-mode equality test is absent. | ui/app.js `engineering-mode` |
| R8.4 | Goal/Definition of Done, current state, risk, evidence and required approvals are visible. | Visible fields exist, but all Goal/Done/risk/evidence/approval combinations are not asserted. | ui/harness-console.js `render` |
