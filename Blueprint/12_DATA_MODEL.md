# 12 — Canonical Data Model

## 1. Principle

Board, Pipeline, Graph, Trace, provider status and repository panels must derive from one local model. UI state is not the source of truth.

## 2. Entities

### Workspace

```ts
Workspace {
  id: string
  name: string
  rootPath: string
  createdAt: string
  policyId: string
  preferredProviderId: string
  resources: ResourceBinding[]
}
```

### Resource

Types:
- folder
- local-repo
- github-repo
- tool
- provider
- desktop-app
- compute-service

### ResourceBinding

```ts
ResourceBinding {
  resourceId: string
  capabilities: Capability[]
  mode: 'allow' | 'ask' | 'deny'
}
```

### Task

```ts
Task {
  id: string
  workspaceId: string
  title: string
  goal: string
  state: TaskState
  risk: 'GREEN' | 'YELLOW' | 'RED'
  card: CommandCard
  steps: Step[]
  createdAt: string
  updatedAt: string
  result?: ResultCapsule
}
```

### Provider

```ts
Provider {
  id: string
  name: string
  kind: 'human-mediated-web'|'remote-mcp'|'api'|'local'
  status: ProviderStatus
  credentialRef?: string
  config: Record<string, unknown>
}
```

### Worker

A Worker is a concrete isolated runtime identity, not a Provider alias.

```ts
Worker {
  id: string
  name: string
  providerId: string
  model?: string
  role: 'planner'|'builder'|'reviewer'|'general'
  runtime: string
  processId?: number
  codexHome?: string
  taskId?: string
  runId?: string
  runtimeState: string
  repository?: string
  worktree?: string
  verificationState?: string
  startedAt?: string
  heartbeatAt?: string
  timeoutAt?: string
  cancelState?: string
  evidenceRefs: string[]
}
```

Initial canonical Builder Workers are `codex-official` and `codex-pega`. Their `codexHome`, auth/session/runtime storage and process environments are distinct. Secrets are not part of the public Worker projection.

### Evidence

Metadata references files stored under AECP user data, never arbitrary public URLs by default.

## 3. Bootstrap persistence

Use simple versioned JSON files in the Electron user-data directory to avoid native database modules during first x64/ARM64 packaging.

Suggested layout:

```text
<userData>/
├─ config.json
├─ workspaces.json
├─ providers.json          # no plaintext secrets
├─ credentials.dat         # encrypted payload/reference
└─ evidence/
   └─ TASK-xxxx/
      ├─ task.json
      ├─ trace.jsonl
      ├─ stdout.txt
      ├─ stderr.txt
      └─ result.json
```

Writes use temp-file + rename where practical to reduce corruption risk. Provider usage telemetry uses a serialized write queue with unique temp files to avoid concurrent-writer races.

## 4. Migration

Every persisted document includes `schemaVersion`. Future releases apply explicit migrations; unknown newer versions cause read-only recovery mode rather than destructive downgrade.

## 5. Data deletion/export

Settings provides:
- export configuration/state/runtime/evidence backups with credentials excluded by default;
- clear AECP task/runtime evidence;
- remove the current Workspace binding without deleting or modifying original Workspace files;
- delete stored AECP credentials and the Local MCP bearer;
- reset AECP active local state while preserving pre-restore safety backups.

Destructive local-data operations require native confirmation and are blocked while Harness, bounded Autonomy, or active Control Plane work is running. The data manager operates only on explicit AECP-owned paths under the application data root.

## 6. Graph semantics

Graph is derived:
- Workspace `CONTAINS` LocalRepo
- LocalRepo `TRACKS` GitHubRepo
- Task `USES` Resource
- Task `EXECUTED_BY` ToolAdapter
- Workspace `SUPERVISED_BY` Provider
- Workspace `GOVERNED_BY` Policy

Capability/mode live on the edge. Graph editing is a policy/resource mutation and must go through validated control-plane commands.


## Blueprint owner decision D7 — 2026-09-25 (append-only)

The persisted schema identifier of the form `aecp.<name>/v<N>` (for example `aecp.worker-registry/v1`) is accepted as equivalent to the `schemaVersion` requirement in section 4. No field rename or in-place migration is required. What remains open is a test proving that every persisted store carries a versioned schema identifier and that an unknown newer version enters read-only recovery. See `.ai/GAP_REGISTER.md`.
