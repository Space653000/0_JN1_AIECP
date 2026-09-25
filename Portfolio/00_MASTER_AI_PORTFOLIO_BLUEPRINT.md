# 00 — Unified AI Portfolio Master Blueprint

Version: v0.1
Scope: cross-project architecture and operating model only
Status: proposal for review; does not supersede project-local canonical blueprints

## 1. Why this document exists
The portfolio already contains multiple independently useful AI systems. The problem is fragmentation: separate repositories, separate blueprints, overlapping governance language, duplicated status/reporting concepts, multiple user entry points, and unclear cross-project authority.

This document creates one map, operating model, and integration contract without collapsing all products into one codebase.

## 2. Portfolio architecture

Human
→ Voice / Text / Approval
→ AECP Control Plane
→ domain or execution target
  - AERIS: acoustic engineering
  - MEGIS: mechanical/generative engineering
  - SuperBrain: multi-PC/local compute fabric
→ Evidence / Git / CI / Review
→ Human approval where required

Offline Local Voice Agent is the human voice/HMI front door.
AERIS Supervision is the immutable audit/snapshot publication companion.
The Public Portal is read-only presentation.

## 3. Responsibilities

### AECP
AECP is the operational umbrella, not the acoustic or mechanical domain authority.

Owns workspace boundaries, multi-repo routing, task/mission state, Planner/Builder/Reviewer handoffs, worker/provider isolation, queue/scheduler/locks, policy and approval gates, deterministic verification, CI/GitHub delivery, evidence/event projection, and the private engineering dashboard.

### AERIS
Owns acoustic-engineering requirements, 100 capability-seat taxonomy, skills/methods/standards, acoustic evidence semantics, gate governance, temporary engineering Pod composition, and domain-specific review/approval rules.

AERIS Core is WHAT. AERIS Local Implementation is HOW.

### MEGIS
Owns mechanical engineering IR/data model, deterministic engineering rules, constrained geometry, maturity rules, Gate-based construction, golden cases, manufacturing/geometry validation, and supported envelope.

### Offline Local Voice Agent
Owns local STT, wake/intent handling, desktop-control tools, safety tiering, guided multi-turn voice interaction, and local HMI/companion UX.

For engineering work it should hand off structured intent instead of embedding AERIS or MEGIS domain logic.

### SuperBrain
Owns ULTRA-MAERA-2 as the connected/control node, SPARK-AGAVE-3 FAST worker, SPARK-AGAVE-4 DEEP worker, local/cloud routing, network isolation, queue/lease/worker health, local inference, benchmark-driven routing, and offline resilience.

It is compute/execution infrastructure. It does not replace AECP task governance or AERIS/MEGIS domain truth.

### AERIS Supervision
Owns immutable snapshots, SHA-256 verification, publication evidence, and reconciliation pointers. It must never become a hidden write path into Blueprint or Implementation repositories.

## 4. One-window model

Public window:
AI Engineering Portfolio Portal
- Overview
- Architecture
- AERIS
- MEGIS
- Voice Agent
- SuperBrain
- AECP
- Trust/Evidence
- Status
- Roadmap/Docs

Private engineering window:
AECP
- Workspaces
- Projects
- Tasks
- Queue
- Agents/Workers
- Git/CI
- Evidence
- Approvals

Project repositories remain the source of truth.

## 5. Canonical cross-project lifecycle

Human goal
→ Voice/Text intake
→ classify general/acoustic/mechanical/infra
→ AECP Mission
→ bind repository + project policy
→ read project-local Blueprint/Acceptance/Status
→ Planner
→ Builder in isolated worktree
→ deterministic verifier
→ project-specific domain verifier
→ CI/Evidence
→ Reviewer
→ Human approval when required
→ governed GitHub delivery
→ status projection to Portal

No system may declare DONE merely because an LLM says it is done.

## 6. Shared invariants
1. Human remains final authority for destructive, irreversible, customer-facing, production, credentialed, billing, security-sensitive, or formal-release actions.
2. GitHub/repository truth and deterministic evidence outrank conversational memory.
3. Dashboard/Portal is a projection, never the source of truth.
4. Implementation success is not the same as validation success.
5. CI success is not automatically real-machine/environment success.
6. Provider/model identity is replaceable; role/capability contracts are stable.
7. Autonomous loops must be bounded.
8. Cross-project writes require explicit repository/task binding.
9. Secrets and private engineering data are local-first and minimum-necessary.
10. Cross-project integration must use explicit schemas/contracts, not hidden coupling.

## 7. Do not merge these boundaries
- Do not merge AERIS Core and AERIS Implementation into one authority.
- Do not merge AERIS and MEGIS domain logic.
- Do not merge Voice Agent runtime and AERIS runtime.
- Do not merge SuperBrain machine provisioning into AECP product logic.
- Do not merge immutable supervision snapshots with mutable implementation code.

Integration happens through contracts and AECP orchestration.

## 8. Portfolio-level Done
Portfolio integration is complete only when every project has one canonical blueprint entry, one acceptance/status entry, an AECP workspace/project registration path, versioned cross-project handoffs, evidence-backed public status, explicit public/private boundaries, and one human-facing index that answers what each system is, what it owns, its current maturity/blockers, where its truth lives, and how it connects to the others.
