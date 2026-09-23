# 15 — Self-Evolution, Private Update and Agent Interop Blueprint

## 1. Purpose

AECP is designed to keep evolving without binding the product to a single AI vendor, a single local agent, or a single deployment method.

There are two separate trust chains:

1. **Conversation-driven development plane** — the user discusses a requirement in an authorized ChatGPT conversation; ChatGPT may update the authorized GitHub repository through the GitHub connector.
2. **Installed-product update plane** — the installed AECP application checks only the allowlisted GitHub Release channel, verifies the selected installer, and applies an update only after the user presses the update control.

These chains must remain separate. ChatGPT Web credentials are never reused as GitHub credentials, and AECP never scrapes ChatGPT to discover code changes.

---

## 2. Conversation → GitHub → Release → AECP

Target lifecycle:

```text
User requirement in ChatGPT
        ↓
Authorized GitHub connector
        ↓
Blueprint / code / tests / README
        ↓
Pull Request + CI
        ↓
Merge to main
        ↓
GitHub Release
        ↓
AECP: Check Update
        ↓
SHA-256 verification
        ↓
Apply Update
```

The installed app never pulls arbitrary branches and never installs an artifact directly from a chat message.

---

## 3. Private GitHub update channel

### 3.1 Allowlist

v0.1 is hard-bound to:

`Space653000/0_JN1_AIECP`

The update source cannot be changed by a Command Card or by content copied from an AI conversation.

### 3.2 Authentication

Private Release access initially uses GitHub CLI authentication:

- AECP detects `gh`.
- `Connect GitHub` starts the official `gh auth login --web` flow.
- AECP invokes `gh` as a process and does not extract the GitHub token into application memory.
- Future versions may add a first-party GitHub OAuth/device-flow adapter, but the secret boundary must remain equivalent.

### 3.3 Check Update

AECP:

1. reads local app version;
2. lists Releases from the allowlisted repository;
3. parses semantic-version tags;
4. selects the highest compatible Release;
5. selects the combined x64+ARM64 installer first;
6. falls back to the current architecture-specific installer only when needed.

### 3.4 Apply Update

AECP:

1. downloads only the expected installer asset and `SHA256SUMS.txt`;
2. verifies the installer SHA-256;
3. aborts on missing/mismatched checksum;
4. launches the verified NSIS installer;
5. closes the running AECP instance.

Stable/signed builds now support Authenticode verification in addition to the SHA-256 manifest. A build can embed a required signer thumbprint; if present, downloaded target and rollback installers are rejected unless Windows reports a valid Authenticode signature from that exact signer. Preview builds may leave the signer pin empty and remain checksum-only.

### 3.5 Rollback

The update controller now retains verified previous-installer/version metadata when available and persists the update transaction until post-launch first-boot reconciliation determines HEALTHY or ROLLBACK_REQUIRED. A retained rollback installer is re-verified before execution.

Required stable rollback states:

```text
DOWNLOADED
VERIFIED
INSTALLING
FIRST_BOOT_PENDING
HEALTHY
ROLLBACK_REQUIRED
```

---

## 4. Agent Adapter model

AECP separates **agent identity** from **execution capability**.

Initial adapters:

| Adapter | Surface | Primary role |
|---|---|---|
| ChatGPT Web | official browser | supervisor / reasoning |
| Codex CLI | local terminal | coding worker |
| Claude Code | local terminal | coding / review worker |
| Gemini CLI | local terminal | research / coding worker |
| Ollama | local runtime | local models / preprocessing |

Detection and launch are fixed-capability operations. The UI may show an unavailable adapter, but must not fabricate availability.

### 4.1 Future adapter classes

- Web companion
- Local CLI
- API provider
- Local model runtime
- Remote MCP
- IDE extension
- Desktop/GUI execution adapter
- Engineering application adapter

All adapters expose capabilities instead of pretending every provider is interchangeable.

Conceptual interface:

```text
AgentAdapter
  id
  displayName
  capabilities()
  health()
  launch()
  handoff(contextCapsule)
  receive(resultCapsule)
  cancel()
```

---

## 5. Inter-agent handoff

AECP should not copy hidden session state between vendors.

Agents interoperate through explicit artifacts:

- Goal Loop Contract
- Context Capsule
- Command Card
- Result Capsule
- Evidence references
- Git commit / diff
- Task state
- Decision record

This makes a workflow portable:

```text
ChatGPT Web
  ↓ Context Capsule
Claude Code
  ↓ verified diff/tests
AECP Evidence
  ↓ Result Capsule
Gemini / Codex / ChatGPT
```

A provider can be replaced without changing the Workspace, task IDs, evidence model, or policy model.

---

## 6. Agent Switcher UX

Beginner mode shows only:

- agent name;
- availability;
- one action: Open / Launch.

Engineering mode may additionally show:

- exact version;
- adapter class;
- capability list;
- health diagnostics;
- active Workspace;
- provider credential state;
- last handoff.

Launching a CLI agent is always user-initiated and uses a fixed command in the already-authorized Workspace.

---

## 7. Extension model

Future third-party or private extensions should be manifest-driven.

Proposed manifest:

```json
{
  "schema": "aecp.extension/v1",
  "id": "vendor.tool",
  "name": "Vendor Tool",
  "type": "agent|tool|provider|engineering-app",
  "entry": {
    "kind": "cli|api|mcp|desktop",
    "command": "fixed-command"
  },
  "capabilities": ["read", "analyze"],
  "permissions": [],
  "verification": ["health-check"]
}
```

Rules:

- no unsigned extension silently receives write/admin permission;
- install/enable is explicit;
- capability and permission changes are reviewable;
- extensions cannot alter the trusted update repository;
- secrets use the same protected credential store;
- extension updates are independently versioned.

---

## 8. Goal Loop + multiple agents

Goal Loop selects roles, not brands:

```text
Supervisor
Research Worker
Coding Worker
Reviewer
Verifier
Local Compute
```

A policy may map roles to current adapters, for example:

```text
Supervisor      = ChatGPT Web
Coding Worker   = Claude Code
Reviewer        = Codex CLI
Research Worker = Gemini CLI
Local Compute   = Ollama
```

The mapping can change without resetting Goal Loop state.

Every long-running loop remains bounded by:

- Definition of Done;
- maximum iterations;
- checkpoints;
- permissions;
- verification;
- stop conditions.

---

## 9. Update UX

Default update card:

```text
Private GitHub Update
  GitHub connected
  Current v0.1.0
  Latest  v0.2.0

  [Check update] [Apply update]
```

If GitHub is not authenticated:

```text
[Connect GitHub]
```

If GitHub CLI is missing, AECP opens the official installation source rather than downloading an arbitrary executable itself.

The user should never need to identify CPU architecture for an ordinary update.

---

## 10. Release governance

Conversation-driven changes are not installed directly.

Minimum path:

```text
change
 → tests
 → PR/CI
 → blueprint consistency check
 → merge
 → release build
 → checksums
 → installed-app update
```

High-risk future capabilities additionally require:

- security review;
- policy update;
- explicit migration notes;
- rollback path;
- signed release target for stable versions.

---

## 11. Non-goals

AECP must not:

- let a chat response replace its own executable;
- install from an arbitrary URL supplied by an agent;
- expose GitHub credentials to ChatGPT Web;
- use ChatGPT cookies as an authentication bridge;
- scrape proprietary agent sessions to synchronize hidden state;
- claim two agents share context unless an explicit Context/Result Capsule was transferred;
- bypass provider usage limits.

The objective is controlled interoperability, not hidden cross-service automation.
