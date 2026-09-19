# AI Engineering Control Plane — Blueprint Index

`Blueprint/` is the product source of truth. Product intent, UX, runtime behavior, security, release gates, and acceptance criteria live here. Implementation is incomplete whenever code and this blueprint diverge.

## Documents

1. `00_MASTER_BLUEPRINT.md` — vision, invariants, system architecture, data/control planes
2. `01_UX_UI_SPEC.md` — three-pane UX, beginner mode, board/pipeline/graph/trace views
3. `02_LOCAL_AGENT_HARNESS.md` — task runtime, state machine, verification, recovery
4. `03_PROVIDER_ROUTER.md` — ChatGPT Web first; optional official MCP, APIs, local models
5. `04_SECURITY_AND_POLICY.md` — trust boundaries, risk classes, policy-as-code, secrets
6. `05_GITHUB_MULTI_REPO.md` — multi-repo/worktree/concurrency model
7. `06_DESKTOP_CHATGPT_INTEGRATION.md` — official ChatGPT isolation and safe handoff
8. `07_INSTALL_RELEASE.md` — auto-detect Windows installer, x64/ARM64 fallbacks, release, updates
9. `08_ROADMAP_ACCEPTANCE.md` — delivery phases and measurable gates
10. `09_RESEARCH_NOTES.md` — external research and adopted patterns
11. `10_CONVERSATION_DECISION_LOG.md` — concise founding requirements/decision history
12. `11_TASK_PROTOCOL.md` — Command Card, Context Capsule, Result Capsule, trace schema
13. `12_DATA_MODEL.md` — persistent entities, graph and local storage
14. `13_TRIPLE_AUDIT.md` — three independent blueprint-vs-implementation audits
15. `14_GUIDED_UX_AND_GOAL_LOOP.md` — newcomer-first guided UX, Goal Loop, budgets, checkpoints, stop conditions and remote supervision direction
16. `16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md` — Microsoft Store private distribution and Web/Local/Official-MCP execution modes
17. `17_V0_2_TRIPLE_AUDIT.md` — v0.2 constraint-resolution, MCP security and release conformance audit
18. `18_BOUNDED_AUTONOMOUS_EXECUTION.md` — isolated worktree execution, bounded workers, deterministic verification and explicit verified-patch apply
19. `19_V0_3_TRIPLE_AUDIT.md` — v0.3 isolation, security, cross-platform and release audit
20. `20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md` — Harness engineering, Planner/Worker/Reviewer loop, bounded autonomy, queue, locks, CI events and maturity model
21. `21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md` — vendor-neutral agent roles and explicit handoff contracts
22. `22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md` — engineering cockpit, queue, event stream and mobile-ready view
23. `Conversation/2026-09-17_FOUNDING_CONVERSATION.md` — full project-specific founding conversation archive

## Product name

**AI Engineering Control Plane (AECP)**

## Non-negotiable principle

Official ChatGPT Web is an independent OpenAI surface. AECP must not inject into, scrape, intercept, modify, imitate, or reverse engineer ChatGPT. AECP controls the local computer through an explicit local harness and exchanges only user-authorized task/result payloads.

## Default-user principle

A first-time user should need to understand only:

1. what outcome they want,
2. which local Workspace AECP may use,
3. what evidence means Done.

Architecture, provider routing, local-tool discovery, repository discovery and execution evidence should be automatic or progressively disclosed whenever doing so does not weaken permission boundaries.
