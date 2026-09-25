# 01 — Authority and Source-of-Truth Matrix

## 1. Authority hierarchy
L0 — Human explicit instruction / legal / safety
L1 — Project-local canonical blueprint / constitution
L2 — Project acceptance / governance / role rules
L3 — Current status / work orders / implementation plan
L4 — Code + tests + CI + runtime/environment evidence
L5 — Dashboard / Portal / summaries / conversational reports

A lower layer may provide fresher observations but may not silently redefine a higher-layer requirement.

## 2. Project matrix

### AERIS Core
Canonical design: docs/AERIS_BLUEPRINT_ZH_TW.md and frozen release/tag contract.
Rules: constitution.md, AGENTS.md, governance documents.
Status: handoff/review/traceability records.
Truth: WHAT, not runtime.

### AERIS Local Implementation
Canonical design input: fixed AERIS Core lock plus implementation plan.
Rules: AGENTS.md, local policy, regression protocol.
Status: maturity/build-phase/evidence state.
Truth: local runtime, tests, CI and real-machine acceptance.

### AERIS Supervision
Canonical contract: SUPERVISION_CONTRACT.md.
Truth: immutable published snapshots. LATEST.json is only a convenience pointer.

### Offline Local Voice Agent
Canonical design: project docs and current .ai layer where present.
Truth: acceptance/safety rules, .ai/STATUS.md, tests and runtime evidence.

### MEGIS
Canonical design: MEGIS v3.0 Claude Code blueprint.
Truth: Gate/invariant/safety rules, execution state, signoffs, geometry/rule/runtime evidence.

### AECP
Canonical design: .ai/BLUEPRINT.md plus Blueprint/00–24.
Rules: .ai/ACCEPTANCE.md, AGENTS.md, security/policy documents.
Status: .ai/STATUS.md and Blueprint/23.
Truth: Harness/control-plane runtime plus evidence.

### SuperBrain
Canonical design: .ai/BLUEPRINT.md.
Rules: .ai/ACCEPTANCE.md and CLAUDE.md.
Status: .ai/STATUS.md.
Truth: ULTRA/SPARK runtime and evidence.

## 3. Conflict rules
1. Portfolio documents do not override project-domain requirements.
2. AECP may enforce stricter execution/security policy around a project task.
3. Project-specific safety/acceptance may block AECP from proceeding.
4. Portal may report only what is traceable to a canonical source or evidence.
5. Conversation memory never overrides repository truth.
6. Reproducible tests/environment evidence outrank stale status prose.

## 4. Recommended common project manifest
Each project should eventually expose project.manifest.json with:
- schema
- project_id
- display_name
- domain
- canonical_blueprint
- acceptance references
- status references
- public_summary flag
- private_runtime flag

AECP and the Portal should consume this manifest instead of hard-coding repository-specific assumptions.
