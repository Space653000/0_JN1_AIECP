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

Writes use temp-file + rename where practical to reduce corruption risk.

## 4. Migration

Every persisted document includes `schemaVersion`. Future releases apply explicit migrations; unknown newer versions cause read-only recovery mode rather than destructive downgrade.

## 5. Data deletion/export

Settings must eventually provide:
- export configuration (without secrets by default)
- clear task evidence
- remove Workspace binding (does not delete original Workspace files)
- delete stored credentials
- reset AECP local state

## 6. Graph semantics

Graph is derived:
- Workspace `CONTAINS` LocalRepo
- LocalRepo `TRACKS` GitHubRepo
- Task `USES` Resource
- Task `EXECUTED_BY` ToolAdapter
- Workspace `SUPERVISED_BY` Provider
- Workspace `GOVERNED_BY` Policy

Capability/mode live on the edge. Graph editing is a policy/resource mutation and must go through validated control-plane commands.
