# 16 — Constraint Resolution: Distribution and Execution Modes

## 1. Why this document exists

Two v0.1 Preview limitations are not accepted as permanent product limitations:

1. unsigned GitHub-distributed installers can trigger Windows SmartScreen;
2. ChatGPT Web on plans without full write MCP cannot legally/reliably be turned into an unattended local-control loop by scraping or automating the ChatGPT DOM.

AECP resolves both by supporting multiple trusted distribution and execution modes while preserving the same product goal:

> official ChatGPT Web remains the preferred reasoning/supervision surface; local work remains governed by AECP; no architecture depends on DOM scraping or OpenAI API model-token billing.

---

# 2. Distribution modes

## D1 — GitHub Preview / Developer Distribution

Current path:

```text
GitHub Release
  -> Auto-Detect NSIS installer
  -> SHA-256 manifest
  -> AECP private update channel
```

Use for:
- development;
- private preview;
- rapid iteration;
- users who accept SmartScreen preview warnings.

Security:
- fixed release repository;
- checksum verification;
- architecture auto-detection.

Limitation:
- unsigned binaries can trigger SmartScreen.

## D2 — Microsoft Store Private Audience

Preferred path for a polished private build.

Target UX:

```text
Microsoft Store private listing
  -> user signs in with an allowlisted Microsoft account
  -> Install
  -> Store-signed AECP
  -> Store-managed updates
```

Properties:
- listing can be Private audience;
- only known Microsoft-account users can discover/acquire it;
- Microsoft signs Store-distributed packages;
- no SmartScreen download warning for Store-installed package;
- repository may remain private.

AECP should maintain two release channels:

```text
Preview channel = private GitHub Release
Stable/private-user channel = Microsoft Store Private Audience
```

### Implementation strategy

The current stable electron-builder v26 line supports AppX. The newer MSIX target is currently in the v27 prerelease line.

Therefore:
- do not destabilize the current NSIS production path merely to adopt a prerelease packager;
- prepare Store metadata/assets/identity now;
- produce a Store-compatible AppX submission on the stable builder if needed;
- migrate the Store target to MSIX/MSIXBundle after electron-builder v27 becomes stable and passes AECP packaging regression tests.

### One-time owner prerequisites

AECP code can prepare the package and CI, but the repository cannot create the developer identity itself.

The owner must provide Partner Center values:
- Package/Identity/Name;
- Package/Identity/Publisher;
- Publisher display name;
- Store app reservation/identity.

These are not secrets in the same sense as an API key, but must match Partner Center exactly.

---

# 3. Execution modes

AECP exposes a single user concept: **Execution Mode**.

## E1 — Web Safe Bridge

Status: available now.

```text
ChatGPT Web
  -> explicit Goal/Command Card handoff
AECP
  -> bounded local capability
  -> Evidence / Result Capsule
ChatGPT Web
```

Benefits:
- works with current ChatGPT subscription surface;
- no OpenAI model API token billing;
- official ChatGPT Web stays untouched;
- strongest separation of trust.

Tradeoff:
- a human-visible handoff remains between ChatGPT and AECP.

Use when:
- maximum compatibility is required;
- plan does not support full MCP write;
- local worker is unavailable.

---

## E2 — Local Autonomous Loop

Status: v0.2 target.

Goal:

```text
ChatGPT Web defines:
  Goal
  Definition of Done
  constraints
  risk policy

        ↓ one explicit handoff

AECP Goal Loop Runtime
        ↓
Local/CLI Worker
        ↓
RESEARCH -> PLAN -> ACT -> VERIFY -> REFLECT
        ↓
checkpoint / evidence
        ↓
DONE / BLOCKED / NEEDS_APPROVAL

        ↓ optional supervisor review

ChatGPT Web
```

ChatGPT Web is still the preferred supervisor/architect, but it does not need to participate in every iteration.

### Candidate worker adapters

- Local Ollama model / local agent runtime
- Gemini CLI
- Claude Code
- Codex CLI
- OpenCode/local agent with deny-first permissions
- external/OpenAI-compatible API providers when explicitly enabled and approved

Each adapter has its own authentication/quota rules. AECP must not imply that a provider is unlimited.

### Important design rule

The loop is controlled by AECP, not by a model's promise that it will stop.

AECP owns:
- max iterations;
- timeout;
- allowed tools;
- write boundaries;
- stop conditions;
- checkpoint interval;
- deterministic verification;
- evidence;
- user approval.

### Provider-specific notes

Claude Code, Gemini CLI, Codex CLI and OpenCode are represented through governed role/capability adapters. Provider automation may have its own subscription/credit/quota semantics and must be surfaced in capability/status rather than treated as unlimited.

Local-only workers are the only path that can truthfully avoid external model quotas entirely.

---

## E3 — Official Full MCP

Status: supported architecture; dependent on OpenAI plan/workspace availability.

Target:

```text
Official ChatGPT Web
        ↓ custom MCP app
OpenAI-hosted MCP endpoint
        ↓ Secure MCP Tunnel
AECP Local MCP Server
        ↓ Policy Engine
        ↓
Local Harness / files / Git / tools / desktop adapters
```

This is the closest match to the original AECP vision:
- user talks in official ChatGPT;
- ChatGPT invokes AECP tools;
- AECP executes locally;
- results return to the same ChatGPT conversation;
- no ChatGPT DOM scraping.

Current product constraint:
- full MCP write/modify is currently available to Business and Enterprise/Edu workspaces, not Plus/Pro full-write mode.

Secure MCP Tunnel:
- keeps the local MCP server private;
- uses outbound connectivity;
- avoids exposing a public inbound port;
- requires tunnel provisioning and a runtime credential for tunnel authentication.

This tunnel credential is not the same as model-token API billing, but it is still an OpenAI platform credential and must be treated as a secret.

### MCP capability policy

The MCP surface must expose semantic tools, not an unrestricted shell.

Preferred:
- inspect_workspace
- read_file_scoped
- apply_patch_scoped
- run_test_profile
- git_status
- create_worktree
- verify_build
- capture_evidence

Avoid:
- raw_shell(command)
- arbitrary filesystem path
- unrestricted desktop automation

---

# 4. Automatic mode selection

Beginner mode should recommend, not force:

```text
Full MCP configured and supported?
  YES -> E3 Official Full MCP

Else governed local worker available?
  YES -> E2 Local Autonomous Loop

Else
  -> E1 Web Safe Bridge
```

The user can always override the recommendation.

UI language:

```text
Execution Mode

Recommended: Local Autonomous

[ Web Safe Bridge ]
Works everywhere

[ Local Autonomous ]
Uses detected local/CLI worker

[ Official Full MCP ]
Requires supported ChatGPT workspace + MCP tunnel
```

Never label E3 as available merely because a local MCP server exists. The end-to-end connector/tunnel health check must pass.

---

# 5. Same Goal, different transport

The canonical task model must remain identical across all modes:

- Goal Contract;
- Definition of Done;
- Workspace binding;
- permission policy;
- task IDs;
- Context Capsule;
- Command Card;
- Result Capsule;
- Evidence;
- Trace.

Only the transport/worker changes.

This is the core portability requirement:

```text
ChatGPT Web / Local worker / Claude / Gemini / Codex
                 ↓
          AECP canonical task
                 ↓
         governed local harness
```

---

# 6. Mobile/remote supervision

The long-term experience should resemble modern remote coding supervisors:

```text
phone or web ChatGPT
  -> task / decision / approval
  -> AECP local machine
  -> worker acts
  -> evidence/checkpoint
  -> same supervisory surface
```

Preferred implementation order:
1. Official Full MCP when supported.
2. AECP authenticated Remote Gateway for provider-neutral remote status/approval.
3. Never implement remote supervision by scraping a ChatGPT session.

---

# 7. Acceptance gates

## Store Distribution gate

PASS only when:
- Partner Center identity is configured;
- package builds for x64 + ARM64;
- Store certification accepts the package;
- Private audience acquisition works on a clean Windows account/device;
- install/update path shows Microsoft publisher trust;
- GitHub preview channel remains functional.

## Local Autonomous Loop gate

PASS only when:
- at least one worker adapter completes a bounded task;
- max-iteration and timeout stops are enforced outside the model;
- write scope cannot escape Workspace;
- user approval interrupts high-risk actions;
- verification evidence is persisted;
- failed worker/provider does not corrupt task state;
- loop can resume from checkpoint.

## Official Full MCP gate

PASS only when:
- supported ChatGPT workspace connects to AECP MCP via approved transport;
- tunnel/connector health is visible;
- read tool works end-to-end;
- write tool requires and respects policy;
- tool result returns to the same ChatGPT task flow;
- AECP remains usable when MCP is disconnected;
- no ChatGPT DOM automation exists.

---

# 8. Decision

AECP does not accept the v0.1 constraints as permanent.

The product strategy is:

- **solve SmartScreen** through a Store/private-audience distribution lane;
- **solve unattended work on current subscription constraints** with a Local Autonomous Loop;
- **solve direct official ChatGPT-to-local execution** with Full MCP when the user's ChatGPT workspace supports it;
- keep all three behind one canonical task/evidence model.


# 9. v0.2 implementation status

Implemented on the v0.2 feature branch:
- three Execution Mode readiness cards and recommendation logic;
- OpenCode detection/launcher in the local worker pool;
- authenticated loopback Local MCP runtime;
- encrypted persistent local MCP bearer;
- explicit Start / Stop / Copy connection controls;
- read-only semantic MCP tools: `aecp_status`, `inspect_workspace`, `git_status`, `read_text_file`;
- workspace traversal rejection and 256 KiB text-read limit;
- CI integration test that starts the MCP server, checks health, verifies missing bearer returns 401, and shuts it down.

Current status:
- Local Autonomous write-capable loop — **repository-verifiable implementation complete**: isolated worktree, deny-first worker policy, bounded turns/time/output/patch/changed-files, deterministic verification, explicit apply, checkpoint/recovery and failure-state preservation are covered by tests;
- Secure MCP Tunnel provisioning against a real supported ChatGPT workspace — **EXTERNAL PRODUCT/DEPLOYMENT GATE**;
- Full MCP write tools — intentionally not claimed until an approved end-to-end connector/tunnel and policy-gated write path are available;
- Microsoft Partner Center / Store certification — **EXTERNAL OWNER GATE**;
- production signed/stable public distribution — software lane implemented; actual owner certificate/signing remains **EXTERNAL OWNER GATE**.

External/product gates remain acceptance-gated rather than simulated.
