# AECP Requirements

**Status:** normative product requirements  
**Authority:** subordinate to `00_MASTER_BLUEPRINT.md`; acceptance evidence is defined by `08_ROADMAP_ACCEPTANCE.md` and implementation truth by `23_IMPLEMENTATION_STATUS.md`.

## R1 — Trust boundaries

- **R1.1** Official ChatGPT remains an external official surface. AECP must not scrape its DOM, copy session cookies, intercept traffic, or use undocumented private endpoints.
- **R1.2** Renderer code has no direct Node.js privilege. Electron must use context isolation, renderer sandboxing, a narrow preload bridge, and navigation/window-open restrictions.
- **R1.3** Filesystem and process operations are limited to explicitly authorized Workspace/runtime roots.
- **R1.4** Credentials are represented by opaque references and protected with OS-backed storage when persisted.
- **R1.5** RED operations such as publish/merge/delete/credential/system changes require an explicit human authorization gate.

## R2 — Canonical engineering loop

- **R2.1** Engineering work follows a durable bounded state machine rather than an unbounded agent chat.
- **R2.2** Planner, Builder and Reviewer are roles, not vendor identities, and must resolve through the Provider Router.
- **R2.3** Builder work is isolated from the active checkout by a task worktree or equivalent governed execution boundary.
- **R2.4** A mutating task cannot reach accepted completion without deterministic verification evidence.
- **R2.5** Retry/rework has a bounded iteration budget and preserves task identity/evidence.
- **R2.6** Crash/restart recovery restores persisted task state without silently expanding permissions.
- **R2.7** High-risk delivery remains human-gated after CI success.

## R3 — Provider independence and local models

- **R3.1** Provider selection is explicit for Planner, Builder and Reviewer roles.
- **R3.2** Claude, Codex, Gemini, OpenCode, Ollama-compatible local inference and trusted fixed local-agent commands can be represented without changing task state schemas.
- **R3.3** A local provider executable is selected from trusted AECP/provider configuration, never from task text.
- **R3.4** Ollama model selection is explicit; AECP must not silently choose a model.
- **R3.5** Changing providers must not implicitly change Workspace or security permissions.
- **R3.6** Optional providers failing or being unconfigured must not break Web Safe Bridge operation.

## R4 — Git, GitHub and multi-repository work

- **R4.1** A Mission can discover and route tasks to multiple repositories inside its approved resource graph.
- **R4.2** Conflicting repository/worktree writes are protected by durable locks/leases.
- **R4.3** GitHub delivery uses governed branches/PRs and correlates CI to commit SHA.
- **R4.4** GitHub webhook events are authenticated and replay/idempotency protected; polling remains a fallback.
- **R4.5** CI failure evidence returns only safely classified failures to bounded rework.
- **R4.6** A governed merge requires required CI success and explicit human approval.

## R5 — Evidence, observability and recovery

- **R5.1** Mission/task state, event history and evidence survive process restart.
- **R5.2** Evidence artifacts carry hashes/manifests sufficient to reconstruct accepted work.
- **R5.3** Dashboard/remote views are projections of canonical state, never a second source of truth.
- **R5.4** Maintenance handles expired locks, context TTL, evidence retention and orphan worktree cleanup with bounded budgets.
- **R5.5** Dependency/security/documentation drift is diagnostic by default and must not silently mutate dependencies or Blueprint files.

## R6 — Local MCP and remote supervision

- **R6.1** Local MCP binds to loopback by default and requires authenticated access.
- **R6.2** Local MCP preview tools are capability-scoped/read-only; no raw shell is exposed.
- **R6.3** Device pairing uses short-lived one-time codes and revocable short-lived read-only credentials.
- **R6.4** Pairing does not grant write/execute/merge/credential/system authority.
- **R6.5** LAN/Internet transport, if enabled in a future deployment, must use authenticated encrypted transport and inherit the same local policy. No public inbound port is enabled by default.

## R7 — Windows distribution

- **R7.1** CI builds x64 and ARM64 Windows installers plus the primary architecture-selecting installer.
- **R7.2** x64 and ARM64 installers must pass clean hosted-Windows silent install/uninstall smoke gates before release publication.
- **R7.3** Release assets include SHA-256 integrity evidence.
- **R7.4** Production signing, trusted provenance, update rollback and Microsoft Store publication are not represented as complete without real owner/account/certificate evidence.
- **R7.5** The application remains usable without an OpenAI API key.

## R8 — UX and human agency

- **R8.1** First run requires explicit Workspace selection rather than scanning arbitrary personal folders.
- **R8.2** Beginner and engineering views project the same underlying state.
- **R8.3** Clipboard ingress/egress occurs only on explicit user action.
- **R8.4** Goal/Definition of Done, current state, risk, evidence and required approvals are visible.
- **R8.5** User pause/cancel/emergency-stop controls remain authoritative over autonomous execution.

## Verification rule

A requirement is not considered verified merely because this file or a matching source file exists. Evidence classes are:

1. **STATIC** — source/configuration invariant is machine-audited.
2. **TESTED** — deterministic automated test executes the invariant.
3. **CI** — exact commit has a successful workflow gate.
4. **ENVIRONMENT** — clean/real target environment evidence exists.
5. **OWNER/EXTERNAL** — account, certificate, Store, public-domain or provider credential evidence supplied by the owner/external service.

`23_IMPLEMENTATION_STATUS.md` must distinguish these classes and must never promote an OWNER/EXTERNAL requirement to PASS from repository code alone.
