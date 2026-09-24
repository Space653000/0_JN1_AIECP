# 11 — Task and Handoff Protocol

## 1. Goals

- explicit user authorization
- stable structured handoff independent of provider
- validation before execution
- compact context/results
- versioned protocol
- imported conversation text cannot grant itself new local capabilities

Protocol identifier: `aecp.task/v1`.

## 2. Command Card — v1 preview

Supported action capabilities in v0.1.0:

- `inspect-workspace`
- `git-status`

Both are read-only. There is intentionally **no arbitrary `shell` action in v1 preview**.

Example:

```json
{
  "schema": "aecp.task/v1",
  "title": "Inspect repository status",
  "workspace": "current",
  "goal": "Read the current repository branch and working-tree status without modifying anything.",
  "action": {
    "type": "git-status"
  },
  "permissions": ["workspace:read"],
  "verification": {
    "type": "operation-success",
    "expected": true
  }
}
```

Rules:
- unknown schema version is rejected;
- `title` and `goal` required;
- Workspace value from the card is advisory; user-selected AECP Workspace is authoritative;
- requested permissions never grant themselves;
- unsupported action type is rejected before Task creation;
- v0.1.0 imported capabilities are GREEN/read-only;
- future YELLOW/RED schemas/adapters require explicit Policy Engine rules and approval gates.

## 3. Future capability evolution

Do not silently reinterpret v1 cards as arbitrary commands. Mutating capabilities must be added explicitly through a backward-compatible protocol extension or a new schema version, for example structured actions such as:

- `write-file`
- `apply-patch`
- `run-project-task`
- `git-commit`
- `desktop-action`

Each action must have an implementation-specific schema, bounded inputs, risk classification and verifier. A generic free-form shell string is not the preferred public contract.

## 4. Context Capsule

A context summary intended for a provider/user, not an execution command:

```json
{
  "schema": "aecp.context/v1",
  "workspace": "Alpha",
  "objective": "Review repository state",
  "git": {"branch":"main","dirty":false},
  "relevantFiles": [],
  "facts": ["working tree clean"],
  "constraints": ["read only"],
  "decisionsNeeded": []
}
```

## 5. Result Capsule

```json
{
  "schema": "aecp.result/v1",
  "taskId": "TASK-0142",
  "status": "PASS",
  "summary": "Read-only local execution completed and verification passed.",
  "execution": {
    "durationMs": 184
  },
  "verification": {
    "status": "PASS",
    "method": "operation-success",
    "expected": true,
    "actual": true
  },
  "facts": ["Branch: main", "Working tree: clean"],
  "evidenceRef": "local://evidence/TASK-0142",
  "nextDecision": null
}
```

Result Capsule must not include secrets or huge raw logs. Large artifacts are referenced locally rather than pasted into ChatGPT automatically.

## 6. Execution Trace event

```json
{
  "schema": "aecp.trace/v1",
  "taskId": "TASK-0142",
  "seq": 12,
  "at": "2026-09-17T22:33:18+08:00",
  "type": "verification.completed",
  "severity": "info",
  "data": {"status":"PASS","method":"operation-success"}
}
```

Events are append-only within a task trace.

## 7. Clipboard framing

AECP accepts plain JSON and optionally framed payloads beginning with:

`AECP_COMMAND_CARD_V1`

Result copy uses:

`AECP_RESULT_CAPSULE_V1`

Clipboard is read only after the user explicitly presses Import. Invalid content is not persisted as a Task.

## 8. Size limits

Bootstrap defaults:
- Command Card: 64 KiB maximum
- Result clipboard write: 128 KiB maximum
- Result Capsule target: substantially below that limit

Large local evidence stays local unless the user explicitly chooses to share it.


## Blueprint owner decision D8 — 2026-09-25 (append-only)

The implemented Context Capsule document type is `aecp.capsule/v1`. It is accepted as the implementation name for the `aecp.context/v1` capsule described in this document, so persisted records are not renamed. If a future work order lets external agents exchange context cards, it must accept both identifiers. What remains open is a test that asserts the capsule's bounded content and size. See `.ai/GAP_REGISTER.md`.
