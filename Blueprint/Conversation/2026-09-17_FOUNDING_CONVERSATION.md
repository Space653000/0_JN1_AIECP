# AI Engineering Control Plane — Founding Conversation Archive

Date: 2026-09-17

Scope: this is the complete project-specific founding conversation that created **AI Engineering Control Plane (AECP)**. The project is explicitly independent from earlier/unrelated projects.

Format:
- **User requirement** preserves the substance and important wording of each request.
- **Engineering outcome** records what that request became in the Blueprint/implementation.

---

## 1. Initial idea — official ChatGPT Web as cloud brain, local computer as hands

### User requirement

The user asked whether there is an existing GitHub project/program where a local PC runs an application that can contain or sit beside the official ChatGPT Web experience, while ChatGPT provides cloud reasoning and the local computer provides CPU/GPU assistance and controls local desktop/files/tools. The desired machine should fundamentally need only power + network, with local CPU/GPU doing work under ChatGPT-directed orchestration. If no mature existing product is sufficient, the user asked whether we can build one ourselves.

### Engineering outcome

The concept was separated into two responsibilities:

- **Official ChatGPT Web** — conversational/high-value reasoning surface.
- **Local execution/control plane** — Workspace, files, Git, tools, desktop adapters, local compute, task state, policy, verification and evidence.

Existing agent/MCP/Windows-control patterns are useful references, but AECP should own its local security boundary and should not depend on reverse-engineered ChatGPT browser internals.

---

## 2. Three-pane UX and graphical connection fabric

### User requirement

The user specified a Windows laptop-oriented interface roughly like:

- **left:** the real/local desktop and local engineering environment;
- **right:** official ChatGPT Web, with official ChatGPT capabilities accessible normally;
- **center:** all MCP/tools/connections;
- visually connect conversations, folders and resources so the software automatically knows what is related;
- allow multiple GitHub repositories to be connected;
- make the experience feel like one coherent engineering workstation.

### Engineering outcome

The UI became a three-pane **Workspace Shell**:

```text
Local Computer | Control Plane | Official ChatGPT
```

The center pane evolved from a simple MCP list into the **Control Plane / Local Fabric** containing:

- Task Board
- Pipeline
- Workspace Graph
- Execution Trace
- Evidence
- Provider Registry
- policy/capability relationships

A Graph edge is not decorative: it represents an actual resource/capability binding. One Workspace can bind multiple local repositories/remotes/providers/tools.

---

## 3. Project reset — independent new project, default no API-token billing

### User requirement

The user explicitly clarified that this is a **new project unrelated to all current/past projects**. The principal desire is to use **official ChatGPT Web**, not to consume separate API-token billing by default, and to minimize waste of limited cloud usage/traffic. Local CPU/GPU should absorb as much mechanical/high-volume work as practical.

### Engineering outcome

AECP's permanent default mode became **Web Safe Bridge**:

```text
Official ChatGPT Web
        ↓ explicit user handoff
AECP Local Harness
        ↓ local processing / evidence
Result Capsule
        ↓ explicit user copy
Official ChatGPT Web
```

Key boundaries:

- no OpenAI API key required for default operation;
- no attempt to bypass official usage limits;
- no automatic extraction/scraping of ChatGPT output;
- bulk project data stays local;
- local indexing/reduction produces compact Context/Result Capsules;
- optional APIs/local providers can be added later without redesigning the Harness.

---

## 4. ChatGPT-familiar UX + professional Harness/kanban engineering

### User requirement

The user requested four extensions:

1. UX/UI should use the familiar current ChatGPT visual language/symbol where appropriate.
2. Research professional concepts such as Harness, kanban, engineering/software-delivery tools and use them to make the product more complete.
3. Future external API keys/models should be pluggable so the product can expand without being tied to one model/provider.
4. Official ChatGPT Web/Chrome must remain unaffected; AECP should attach around it. The desired feel is similar to how a remote coding agent can be supervised smoothly while local construction continues, but here the web conversation directs the local operating model.

### Engineering outcome

#### Visual design

AECP adopts familiar interaction qualities (neutral surfaces, simple status/tool chips, dark/light modes, concise controls) without impersonating ChatGPT. Provider branding identifies the official provider only. AECP keeps its own product identity.

#### Harness discipline

Professional software-delivery patterns were adopted:

- canonical Task state machine;
- stage/step pipeline model;
- deterministic verification;
- failure visibility;
- future retry/abort/rollback strategies;
- manual approval gates;
- append-only execution trace;
- evidence-driven completion.

#### One model, multiple views

Board, Pipeline, Graph and Trace are projections of the same canonical Workspace/Task state rather than separate data systems.

#### Provider independence

A Provider Registry supports these classes architecturally:

- ChatGPT Web (default human-mediated safe bridge)
- official Remote MCP/Secure MCP Tunnel where product/account support permits
- external API providers
- local providers/models/services

Provider keys are stored via OS-protected credential storage rather than project files.

#### Official ChatGPT isolation

AECP does not inject JavaScript into chatgpt.com, scrape the DOM, intercept traffic, copy cookies/session data, or call undocumented private endpoints. Baseline integration opens official ChatGPT in the normal system browser and uses explicit user-triggered handoff.

---

## 5. Product naming and formal Blueprint request

### User requirement

The user formally named the architecture/project:

> **AI Engineering Control Plane**

The user requested:

1. turn all discussion/research/architecture/interface/UX/UI/tool decisions into a rigorous Blueprint;
2. create a dedicated `Blueprint/` directory in `Space653000/0_JN1_AIECP`;
3. use that repository as the complete development repository;
4. make the product approachable enough that a novice can download one Windows `.exe`, install it and use it intuitively;
5. after implementation, compare the product against the Blueprint independently three times.

### Engineering outcome

`Blueprint/` became the formal product source of truth, covering:

- Master architecture
- UX/UI
- Local Agent Harness
- Provider Router
- Security/Policy
- GitHub multi-repository behavior
- official ChatGPT integration boundary
- install/release system
- roadmap/acceptance gates
- research notes
- conversation/decision history
- versioned Task protocol
- canonical data model
- triple audit

Development occurs through a feature branch/PR and GitHub Actions rather than unverified direct claims.

---

## 6. Beginner installation, README and private-repository decision

### User requirement

The user added:

- after full construction, update every installation/use explanation in the README;
- instructions must be exceptionally clear for a beginner;
- state whether GitHub can then be switched to private.

### Engineering outcome

The delivery contract includes:

- Windows x64 installer;
- Windows ARM64 installer as a first-class target;
- beginner-first first-run flow;
- no developer toolchain required for installed Safe Bridge usage;
- README with architecture selection, installation, SmartScreen note, first run, sample task, ChatGPT→AECP→ChatGPT workflow, interface explanation, Provider Registry, privacy, developer build and known limitations;
- GitHub Actions builds both architectures;
- release assets include SHA-256 checksums;
- repository privacy is evaluated only after verified builds/release behavior are confirmed.

---

# Final founding principles

The complete founding conversation resolves to these non-negotiables:

1. **Official ChatGPT remains official and unmodified.**
2. **Default AECP use requires no separate OpenAI API key.**
3. **AECP does not bypass provider usage limits or programmatically harvest ChatGPT output.**
4. **Local engineering data stays local by default.**
5. **The Local Agent Harness is permanent; the intelligence provider is replaceable.**
6. **Provider/tool access is capability- and policy-driven, not granted by prompt text.**
7. **Evidence and deterministic verification outrank an AI's assertion of completion.**
8. **Windows ARM64 and x64 are first-class deliverables.**
9. **Multi-repository and future multi-provider support exist at the architecture level.**
10. **Beginner UX and engineering-grade traceability must coexist.**
11. **Remote/mobile supervision is a future authenticated transport, not a ChatGPT scraper.**
12. **The repository may only be declared ready after three explicit Blueprint audits and real packaged-build evidence.**
