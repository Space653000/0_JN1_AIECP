# 24 — Local Model Provider Verification

**Purpose:** make local-model execution a first-class, testable provider capability without coupling the Harness contract to a vendor.

## Verified in source

- Provider Router exposes stable roles independently from vendor identity.
- Ollama is registered as a local provider for Planner / Builder / Reviewer / General roles.
- Ollama requires an explicit model through the runtime option or `AECP_OLLAMA_MODEL`; there is no silent model selection.
- Ollama execution is a local CLI process (`ollama run <model> <prompt>`), with the Harness working directory supplied as the process cwd.
- Codex Builder retains the existing bounded workspace-write sandbox and disables network access in its sandbox configuration.
- Provider command generation is deterministic and covered by `tests/provider-router.test.cjs`.
- Provider health exposes `NOT_CONFIGURED / READY / DEGRADED / UNAVAILABLE / AUTH_REQUIRED` without silently using network or credentials.
- Provider invocation emits bounded privacy-safe usage metadata (request outcome, model/role, latency, numeric token/cost fields when available) into a serialized local store; prompts/responses/secrets are excluded.

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
| Source + deterministic unit test | Provider command, health, policy and usage-observability contracts are wired correctly |
| GitHub CI PASS | Current source passes repository verification |
| Local Ollama smoke | Actual local model process starts and returns output |
| Canonical Harness E2E with Ollama | Planner → Builder → Verify → Reviewer runs with a local model |
| Clean Windows E2E | Packaged application performs the same flow on a clean machine |

Source/unit checks and GitHub CI are repository-verifiable. Windows packaging/install smoke can also be repository-verifiable through GitHub Windows runners and is accepted only from the exact PR HEAD. `Local Ollama smoke` and `Canonical Harness E2E with Ollama` require an environment containing the actual Ollama/model artifacts; deterministic adapter tests must not be presented as real-model execution evidence.

The repository includes `.github/workflows/provider-environment.yml` plus `scripts/provider-environment-verify.cjs` for this external evidence. It runs only on a dedicated `self-hosted + Windows + aecp-provider` runner, checks out an explicit source ref, and can verify: raw Ollama smoke, OpenCode+Ollama real file edit, fixed local/company command smoke, and a canonical Ollama Planner → OpenCode/Ollama Builder → deterministic Verify → Ollama Reviewer Harness loop. Evidence is emitted as `aecp.provider-environment-evidence/v1` and intentionally stores hashes/state/metrics rather than prompt or response bodies.

## OFFICIAL / PEGA Worker environment verification extension

Repository tests may prove Worker isolation, Provider Adapter routing, worktree locking, cancellation isolation, Dashboard projection and mock/loopback API compatibility.

They may **not** claim real PEGA success without an actual environment run against:

`https://aiapi.t-cyber.com/v1`

Real PEGA evidence must identify the exact source commit, worker identity, isolated `CODEX_HOME` identity/hash, negotiated API family, actual model identifier, health result, bounded task result and deterministic verifier result. Credentials and prompt/response bodies must not be persisted.

Real OFFICIAL and PEGA Worker runs are separate ENVIRONMENT evidence. One passing does not imply the other passed.

Required environment cases:

1. Codex OFFICIAL starts with its own `CODEX_HOME` and performs a bounded task.
2. Codex PEGA starts with a different `CODEX_HOME` and performs a bounded task.
3. PEGA Chat Completions-compatible path is checked when supported.
4. PEGA Responses-compatible path is checked when supported.
5. Unsupported API family is reported as capability-unavailable rather than silently remapped.
6. Both Workers may execute separate tasks concurrently with separate worktrees.
7. PEGA failure does not terminate OFFICIAL or Web Safe Bridge.
8. OFFICIAL failure does not terminate PEGA or Web Safe Bridge.

## Security invariant

Local/provider Worker execution does not grant shell, filesystem, network, credential, GitHub, merge, or system privileges. Those remain controlled by the same Control Plane policy and explicit approval gates used by cloud providers. The real-provider evidence fixture runs in temporary directories and uses the same deny-first policy; it is evidence of provider execution, not authority expansion.
