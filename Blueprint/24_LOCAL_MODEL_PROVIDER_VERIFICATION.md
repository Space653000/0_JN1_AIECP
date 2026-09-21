# 24 — Local Model Provider Verification

**Purpose:** make local-model execution a first-class, testable provider capability without coupling the Harness contract to a vendor.

## Verified in source

- Provider Router exposes stable roles independently from vendor identity.
- Ollama is registered as a local provider for Planner / Builder / Reviewer / General roles.
- Ollama requires an explicit model through the runtime option or `AECP_OLLAMA_MODEL`; there is no silent model selection.
- Ollama execution is a local CLI process (`ollama run <model> <prompt>`), with the Harness working directory supplied as the process cwd.
- Codex Builder retains the existing bounded workspace-write sandbox and disables network access in its sandbox configuration.
- Provider command generation is deterministic and covered by `tests/provider-router.test.cjs`.

## Local execution boundary

```text
AECP Control Plane
       |
       v
Provider Router
       |
       +--> Ollama CLI --> local model / local machine
       +--> Codex CLI  --> local or configured Codex model
       +--> OpenCode   --> configured provider/model
       +--> Gemini CLI --> configured provider/model
       +--> Claude CLI --> configured provider/model
```

No provider adapter may bypass SecurityPolicy. Provider selection changes the model worker, not the authority of the Harness.

## Runtime configuration contract

- `options.provider` selects a provider when invoking Provider Router directly.
- `options.model` selects the model explicitly.
- `AECP_<PROVIDER>_MODEL` supplies a process-level default when no explicit model is provided.
- Ollama is intentionally rejected when no model is specified.

## Evidence levels

| Evidence | Meaning |
|---|---|
| Source + deterministic unit test | Provider command contract is wired correctly |
| GitHub CI PASS | Current source passes repository verification |
| Local Ollama smoke | Actual local model process starts and returns output |
| Canonical Harness E2E with Ollama | Planner → Builder → Verify → Reviewer runs with a local model |
| Clean Windows E2E | Packaged application performs the same flow on a clean machine |

The first two levels are repository-verifiable. The remaining levels require an environment containing Ollama/model artifacts and therefore must not be represented as completed without execution evidence.

## Security invariant

Local model execution does not grant shell, filesystem, network, credential, GitHub, merge, or system privileges. Those remain controlled by the same Control Plane policy and explicit approval gates used by cloud providers.
