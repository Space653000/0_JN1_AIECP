# 02 — Integration and Handoff Contracts

## 1. Integrate by contract
Cross-project integration should use versioned files/messages with explicit schemas. Avoid shared hidden state.

Recommended common handoff fields:
- schema
- handoff_id
- source_project
- target_project
- mission_id
- intent
- risk_class
- privacy_class
- inputs
- definition_of_done
- evidence_requirements
- created_at

## 2. Voice Agent → AECP
Voice Agent converts speech/text into a structured mission request.

It should provide user goal, recognized intent, constraints, privacy class, target domain, confirmation state, and optional ORDER/Command Card.

It should not decide acoustic or mechanical truth.

## 3. AECP → AERIS
Required context:
- repository/workspace identity
- approved/fixed Core baseline
- task goal
- applicable role/skill IDs
- required Evidence
- verification gate
- allowed write scope
- Human approval requirements

AECP must not bypass AERIS evidence gates.

## 4. AECP → MEGIS
Required context:
- blueprint revision
- Gate/work-item ID
- supported-envelope constraints
- input provenance
- Definition of Done
- deterministic geometry/rule verification
- maturity ceiling

AECP must not promote maturity beyond MEGIS rules.

## 5. AECP → SuperBrain
AECP sends execution class, data/privacy class, FAST/DEEP/tool/cloud profile, resource/budget limits, expected evidence, timeout and retry policy.

SuperBrain returns worker identity, environment fingerprint, result, timing/resource metrics, logs/evidence references, verification status, and escalation reason.

SuperBrain must not independently mark the parent engineering task DONE.

## 6. AERIS → Supervision
Only a verified bundle may be published to immutable supervision snapshots. Supervision never mutates Blueprint or Implementation.

## 7. Portal status projection
Portal should consume generated, redacted project status rather than scrape arbitrary prose.

Public status should contain:
- project_id
- blueprint revision
- maturity
- phase/gate
- verified scope
- known limits
- latest evidence timestamp
- canonical source references

Private paths, customer data, secrets, internal IPs, raw logs and unpublished test artifacts must be redacted.
