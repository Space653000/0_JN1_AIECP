# 11 — Task and Handoff Protocol

## 1. Goals

- explicit user authorization
- stable structured handoff independent of provider
- validation before execution
- compact context/results
- versioned protocol

Protocol identifier: `aecp.task/v1`.

## 2. Command Card

Minimal example:

```json
{
  "schema": "aecp.task/v1",
  "title": "Run project tests",
  "workspace": "current",
  "goal": "Run the existing test suite and report failures. Do not modify files.",
  "action": {
    "type": "shell",
    "command": "npm test"
  },
  "permissions": ["workspace:read", "shell:execute"],
  "verification": {
    "type": "exit-code",
    "expected": 0
  }
}
```

Rules:
- unknown schema version is rejected;
- `title` and `goal` required;
- Workspace from card is advisory; user-selected AECP Workspace is authoritative;
- requested permissions never grant themselves — Policy Engine decides;
- arbitrary command is classified at least YELLOW unless allowlisted/read-only;
- delete/admin/publish/credentials are RED.

## 3. Context Capsule

A context summary intended for a provider/user, not an execution command:

```json
{
  "schema": "aecp.context/v1",
  "workspace": "Alpha",
  "objective": "Fix test failure",
  "git": {"branch":"task-142","dirty":true},
  "relevantFiles": ["src/auth.ts", "tests/auth.test.ts"],
  "facts": ["142 tests; 1 failure"],
  "constraints": ["Do not change public API"],
  "decisionsNeeded": ["Increase timeout or change retry policy?"]
}
```

## 4. Result Capsule

```json
{
  "schema": "aecp.result/v1",
  "taskId": "TASK-0142",
  "status": "PASS",
  "summary": "Test command completed successfully.",
  "execution": {
    "exitCode": 0,
    "durationMs": 18420
  },
  "verification": {
    "status": "PASS",
    "method": "exit-code"
  },
  "changes": [],
  "evidenceRef": "local://evidence/TASK-0142",
  "nextDecision": null
}
```

Result Capsule must not include secrets or huge raw logs. It may include a bounded failure excerpt and local evidence reference.

## 5. Execution Trace event

```json
{
  "schema": "aecp.trace/v1",
  "taskId": "TASK-0142",
  "seq": 12,
  "at": "2026-09-17T22:33:18+08:00",
  "type": "verification.completed",
  "severity": "info",
  "data": {"status":"PASS","method":"exit-code"}
}
```

Events are append-only within a task trace.

## 6. Clipboard framing

AECP should detect JSON directly and optionally fenced payloads beginning with:

`AECP_COMMAND_CARD_V1`

It must display parsed fields before execution. Clipboard contents unrelated to the protocol are not persisted merely because Import was pressed; invalid content results in a local validation message.

## 7. Size limits

Bootstrap defaults:
- Command Card: 64 KiB maximum
- single stdout/stderr capture persisted: bounded/truncated at configurable limit
- Result Capsule: target < 32 KiB

Large artifacts are referenced locally rather than pasted into ChatGPT automatically.
