# AI Engineering Control Plane

**AI Engineering Control Plane (AECP)** is a Windows-first local control plane that lets you keep using **official ChatGPT Web** as your conversational AI while AECP manages the local engineering side: Workspace boundaries, repositories, task state, local tools, evidence, and future provider adapters.

> **Target release: v0.3.0 Preview.** Official ChatGPT Web remains the normal supervisor. v0.3 adds real bounded autonomous execution: AECP builds in an isolated Git worktree, verifies each iteration, and only applies a verified patch to your real Workspace after your explicit approval.

## The idea in one picture

```text
┌─────────────────────┬────────────────────────┬─────────────────────────┐
│ LOCAL COMPUTER      │ AECP CONTROL PLANE     │ OFFICIAL CHATGPT WEB    │
│ Workspace / Git     │ Board / Pipeline       │ Your normal browser     │
│ Tools / Terminal    │ Graph / Trace/Evidence │ Your normal account     │
└──────────┬──────────┴───────────┬────────────┴────────────┬────────────┘
           │                      │                         │
           └──────────────────────▼─────────────────────────┘
                    LOCAL AGENT HARNESS
              governed capabilities + verification
```

AECP does **not** replace ChatGPT, scrape ChatGPT, inject JavaScript into ChatGPT, copy your ChatGPT cookies, call undocumented ChatGPT APIs, or attempt to bypass service limits. The browser remains the official OpenAI surface.

---

# 第一次使用：新人只要照這裡做

一般使用者**不需要**先安裝 Node.js、Python、本地模型，也不需要 OpenAI API Key。

## 1. 只下載一個主安裝檔

到這個 repository 的 **Releases** 頁面，優先下載：

`AI-Engineering-Control-Plane-Setup-0.3.0.exe`

這是 **Auto-Detect 安裝版**，內含 Windows x64 與 ARM64 payload。安裝時會自動判斷你的 Windows 架構並選擇正確版本，所以一般使用者不用知道自己是 Intel / AMD / Snapdragon，也不用自己選 ARM64 或 x64。

Release 仍會保留下面兩個故障排除用 fallback：

- `AI-Engineering-Control-Plane-Setup-x64-0.3.0.exe`
- `AI-Engineering-Control-Plane-Setup-arm64-0.3.0.exe`

只有主 Auto-Detect 安裝檔真的無法使用時才需要碰 fallback。

## 2. 安裝

1. 雙擊 `AI-Engineering-Control-Plane-Setup-0.3.0.exe`。
2. 使用預設的 **per-user** 安裝即可，不需要管理員權限。
3. 想要桌面捷徑就保留 **Desktop shortcut**。
4. 完成後開啟 **AI Engineering Control Plane**。

### Windows SmartScreen 如果跳出來

v0.3.0 Preview 目前尚未做 Authenticode 簽章，因此 Windows 可能顯示 SmartScreen 警告。

不要為此關閉整個 Windows Security。請確認：

1. 安裝檔確實來自本 repository 的官方 Release。
2. 檔名正確。
3. 如果要再驗證一次，可用同一個 Release 的 `SHA256SUMS.txt` 比對 SHA-256。

## 3. 第一次開啟：AECP 會自動做什麼

啟動後 AECP 會自動判別：

- Windows / App 架構（x64 或 ARM64）
- Git
- PowerShell / PowerShell 7
- Python
- Node.js
- GitHub CLI
- Ollama
- OpenCode
- 之後 Workspace 裡的 Git repositories
- branch
- dirty / clean 狀態

這些工具**不是全部必裝**。沒有偵測到時，AECP 顯示未安裝或 unavailable，不應因為少一個選配工具就整個不能開。

## 4. 唯一需要你自己選的：Workspace

第一次按：

**Choose my first Workspace**

然後選擇你希望 AECP 可以讀取的本機專案資料夾。

這一步刻意不做「全硬碟自動猜測」。原因是 Workspace 本身就是安全邊界；AECP 不應該為了省一次點擊，自動掃描你的桌面、文件或其他私人資料夾。

選過一次後會存在本機，下次開 AECP 不需要重新設定。

## 5. 開官方 ChatGPT

右側 **Official ChatGPT Web** 按：

**Open official ChatGPT**

AECP 會用你的正常預設瀏覽器開 `chatgpt.com`。你照平常方式登入即可。

AECP 不取得你的 ChatGPT 密碼、Cookie 或 Session Token。

## 6. 第一次先跑安全範例

回到 AECP：

1. 按 **Create sample task**。
2. Task 會進入 Board。
3. 選取 Task。
4. 按 **Run locally**。
5. 打開 **Evidence**。
6. 確認有成功的 verified local result。

v0.3.0 的安全範例只會做 read-only：

- `inspect-workspace`
- 或 Workspace root 是 Git repository 時執行 `git-status`

不會修改你的檔案。

## 7. 第一次 ChatGPT → AECP → ChatGPT

在 ChatGPT 要求：

```text
Please output an AECP Command Card using schema aecp.task/v1.
Use only one of these preview actions:
- inspect-workspace
- git-status
Do not include any shell command.
```

ChatGPT 可以回傳例如：

```json
{
  "schema": "aecp.task/v1",
  "title": "Inspect Workspace",
  "workspace": "current",
  "goal": "Perform a read-only local inspection and return verified evidence.",
  "action": { "type": "inspect-workspace" },
  "permissions": ["workspace:read"],
  "verification": { "type": "operation-success", "expected": true }
}
```

接著：

1. 在 ChatGPT 按 Copy。
2. 回 AECP 按 **Import from Clipboard**。
3. AECP 驗證 schema。
4. 選 Task → **Run locally**。
5. 看 **Evidence**。
6. 按 **Copy Result Capsule**。
7. 貼回同一個 ChatGPT 對話。

AECP 只在你明確按 **Import from Clipboard** 時讀 Clipboard，不會在背景偷讀 ChatGPT。

如果上述流程完成，你的 AECP 基本安裝與 Safe Bridge 就正常。

---

# 第一次跑「自動施工」：新人只做 5 件事

v0.3 的 Local Autonomous 不需要你理解 Git worktree。

前提：
- Workspace 本身是 Git repository 根目錄
- Workspace 目前是 Clean
- OpenCode 或 Codex CLI 至少一個可用
- 專案有 AECP 支援的 verifier（例如 `npm run verify` / `npm test` / pytest）

操作：

1. 到 **Goal Loop**。
2. 填 **Goal**：你要完成什麼。
3. 填 **Definition of Done**：什麼證據才算完成。
4. AECP 自動推薦 Worker 和 Verifier，按 **Start autonomous run**。
5. 等狀態變 **DONE**，可先按 **Open worktree** 看結果；確認後按 **Apply verified changes**。

實際底層是：

```text
你的乾淨 Workspace
        ↓ 不直接修改
AECP 建立隔離 worktree
        ↓
OpenCode / Codex Worker
        ↓
AECP verifier
   ├─ FAIL → 自動下一輪
   └─ PASS → verified.patch
                  ↓
         你按 Apply
                  ↓
真正 Workspace 才產生未 commit 的變更
```

重要安全規則：
- 原 Workspace 在執行期間不會被 Worker 直接修改。
- OpenCode autonomous 模式拒絕 external directory 與任意 shell；只開放 worktree 內的讀寫與少量 read-only Git。
- Codex autonomous 模式使用 `workspace-write` sandbox 並關閉 sandbox network。
- AECP 不會自動 commit / push / release。
- 原 Workspace 如果在執行期間被你改過、HEAD 變了、或變 Dirty，**Apply 會拒絕**。

---

# 自動偵測原則

AECP 採用：

> **能安全判斷的就自動判斷；涉及資料授權或高風險操作才詢問使用者。**

| 項目 | 行為 |
|---|---|
| Windows x64 / ARM64 | Auto-Detect installer 自動選擇 |
| AECP runtime architecture | 自動顯示 |
| Git / PowerShell / Python / Node / gh / Ollama | 啟動時自動偵測 |
| Workspace repositories | 選定 Workspace 後自動偵測 |
| branch / dirty-clean | 自動偵測 |
| 已保存 Workspace | 下次啟動自動恢復 |
| 第一個 Workspace | **使用者自己選一次**，避免未授權掃描 |
| ChatGPT login | 由官方 ChatGPT / Browser 自己處理 |
| 高風險寫入、刪除、push | 不應靠自動猜測授權 |

---

# 多 AI 切換與私人 GitHub 一鍵更新

AECP 現在把「AI 是誰」和「本機工程環境」分開。

右側 **Agent Switcher** 會自動偵測：

- ChatGPT Web
- Codex CLI
- Claude Code
- Gemini CLI
- Ollama

可用的 Agent 會顯示版本與 **Open / Launch**；沒有安裝的會顯示 **Not detected**，不會假裝可用。

CLI 類 Agent 只會在你已經授權的 Workspace 中開啟，而且命令是 AECP 固定允許的 launcher，不接受聊天內容自行指定任意 executable。

## 這個 ChatGPT 對話如何持續升級 AECP

未來你可以直接在這個對話提出：

- 新功能
- UX / UI 修改
- 新 Provider
- Claude Code / Gemini / Codex 整合
- MCP
- 工程軟體 Adapter
- 外掛
- 安全策略
- 新的 Goal Loop preset
- 安裝 / 更新改善

在你已授權 GitHub 連接的前提下，開發流程可以是：

```text
你在 ChatGPT 提需求
        ↓
更新 private GitHub
        ↓
CI / Build / Audit
        ↓
Merge main
        ↓
GitHub Release
        ↓
AECP → Check update
        ↓
AECP → Apply update
```

**聊天內容不會直接覆蓋本機 EXE。** 必須先經 GitHub、CI、Release，再由 AECP 的 trusted update channel 安裝。

## Private GitHub Update

如果 repository 改成 Private，AECP 仍能更新。

第一次只需要把本機 GitHub CLI 登入自己的 GitHub：

1. AECP 右側按 **Connect GitHub**。
2. 如果本機已有 `gh`，AECP 會開官方 `gh auth login --web` 流程。
3. 完成 GitHub 網頁授權。
4. 回 AECP 按 **Check update**。
5. 有新 Release 時按 **Apply update**。

AECP 不會把 GitHub Token 抽出來交給 ChatGPT，也不會把 Token 存進專案。

更新時 AECP 只接受固定 repository：

`Space653000/AI-Engineering-Control-Plane`

並且只會：

1. 讀取 GitHub Release。
2. 比較 Semantic Version。
3. 優先選 Auto-Detect installer。
4. 下載 installer + `SHA256SUMS.txt`。
5. 驗證 SHA-256。
6. 驗證成功才啟動安裝。

所以即使聊天內容說「去別的網址下載 EXE」，AECP 更新器也不會照做。

---

# 兩個 Preview 限制的正式解法

AECP v0.2 不再把下面兩件事當成永久限制：

## A. SmartScreen / 未簽章安裝

**建議的正式解法：Microsoft Store Private Audience。**

這條路可以：
- Repository 繼續 Private
- Store 只對指定 Microsoft 帳號開放
- Microsoft 代簽 Store package
- Store 安裝不會遇到一般下載 EXE 的 SmartScreen download warning
- 更新改由 Store 管理

GitHub Release 仍保留作為 Preview / Developer channel。

目前穩定的 electron-builder v26 仍以 NSIS/AppX 為主；MSIX target 位於 v27 prerelease。AECP 不會為了搶先使用 prerelease packager 而破壞現有 NSIS release。Store identity/asset 準備會先做，等 v27 stable 後再決定是否正式切 MSIX。

## B. ChatGPT Web 無人值守

AECP 採三種 Execution Mode：

| Mode | 何時使用 | ChatGPT Web | 自動化 |
|---|---|---:|---:|
| Web Safe Bridge | 所有方案通用 | 主主管 | 半自動 |
| Local Autonomous | 本機/CLI worker 可用 | 定義 Goal / Review | 高 |
| Official Full MCP | 支援 full MCP write 的 ChatGPT workspace | 直接主管與工具呼叫 | 最高 |

### Web Safe Bridge
目前可用。保留官方 ChatGPT Web，不碰 DOM。

### Local Autonomous
v0.2 目標。ChatGPT Web 先定義：
- Goal
- Definition of Done
- constraints
- risk policy

之後 AECP 本機 Goal Loop Runtime 讓受治理的 Local/CLI worker 反覆：

`RESEARCH → PLAN → ACT → VERIFY → REFLECT`

ChatGPT 只在 checkpoint / review / approval 介入。

### Official Full MCP
這是最接近原始願景的官方路徑：

```text
ChatGPT Web
  ↓ custom MCP app
Secure MCP Tunnel
  ↓
AECP Local MCP Server
  ↓
Policy / Local Harness
```

它不需要把 ChatGPT Web 變成 browser bot，也不依賴 DOM scraping。

目前 full MCP write/modify 取決於 ChatGPT workspace plan；AECP 會把它當成可插拔 transport，而不是把整個產品綁死。

---

## Local MCP：本機端已開始實作

v0.2 branch 已加入 **read-only Local MCP Server**，讓未來 Official Full MCP / Secure MCP Tunnel 不需要重寫本機核心。

目前工具：
- `aecp_status`
- `inspect_workspace`
- `git_status`
- `read_text_file`

安全邊界：
- 只監聽 `127.0.0.1`
- Bearer token 必須驗證
- token 使用 OS `safeStorage` 加密保存
- 只有按 **Copy connection** 才會放進剪貼簿
- 只讀
- 禁止絕對路徑與 Workspace traversal
- 文字檔讀取上限 256 KiB
- **沒有 raw shell / write / delete / push**

右側會提供：

```text
Local MCP
[Start Local MCP] [Stop] [Copy connection]
```

**Copy connection 內含 bearer secret，只能貼進你信任的 MCP Tunnel / Client 設定。**

注意：本機 MCP 啟動成功，**不代表你的 ChatGPT 方案已具有 Full MCP write**。它只是把 AECP 的本機端準備好。

## Local Autonomous 的優先 Worker

除了 Codex CLI、Claude Code、Gemini CLI、Ollama，v0.2 也偵測 **OpenCode**。

OpenCode 特別適合作為 Local Autonomous worker，因為它可以作為本地 agent runtime，再搭配本地模型。AECP 仍會由自己的 Goal Loop / Policy / Evidence 控制外層停止條件，不會把「是否一直跑」交給 Worker 自己決定。

---

# 完整功能地圖

下面刻意區分「v0.3.0 現在真的有」與「Blueprint 已規劃但尚未開放」，避免把 roadmap 誤認為完成品。

| Area | v0.3.0 Preview | What it means |
|---|---|---|
| Official ChatGPT Web companion | ✅ | 開官方 `chatgpt.com`；AECP 不接管登入 |
| Agent Switcher | ✅ | 偵測/啟動 ChatGPT Web、Codex CLI、Claude Code、Gemini CLI、Ollama |
| Private GitHub update channel | ✅ | `gh` 私有 Release 檢查、固定 repo、SHA-256 驗證、Apply Update |
| Auto-Detect Windows installer | ✅ | 單一 installer 自動選 x64 / ARM64 payload |
| Architecture-specific fallback installers | ✅ | x64、ARM64 個別安裝檔供故障排除 |
| Windows Workspace selection | ✅ | 原生資料夾選擇器與本地安全邊界 |
| Saved Workspace restore | ✅ | 選過後下次自動恢復 |
| Git repository discovery | ✅ | 掃描 Workspace root / direct child repos |
| Git branch/status | ✅ | Read-only Git state / evidence |
| Local tool discovery | ✅ | Git、PowerShell、Python、Node.js、gh、Ollama |
| Task Board | ✅ | 按狀態管理任務 |
| Pipeline view | ✅ | Understand → Prepare → Execute → Verify → Package Result |
| Workspace Graph | ✅ | Workspace / repo / provider / tool 關係 |
| Execution Trace | ✅ | 任務的本機事件紀錄 |
| Evidence view | ✅ | 顯示可驗證本機結果 |
| `aecp.task/v1` Command Card | ✅ | ChatGPT → AECP 結構化交接 |
| `aecp.result/v1` Result Capsule | ✅ | AECP → ChatGPT 驗證結果交接 |
| Clipboard Safe Bridge | ✅ | 只有使用者按 Import 才讀 clipboard |
| Provider Registry | ✅ foundation | 為未來 API / Local / MCP provider 預留 |
| Protected provider secret storage | ✅ | 使用 OS-backed Electron `safeStorage` |
| Dark / Light theme | ✅ | 使用者可切換 |
| Beginner / Engineering mode | ✅ | 新人預設簡化，高階使用者可展開 |
| Arbitrary AI shell execution | ❌ | v0.3.0 刻意禁止 |
| Bounded autonomous file modification | ✅ | isolated Git worktree + deterministic verification + verified patch/apply |
| Harness Planner → Builder → Verify → Reviewer | ✅ | bounded multi-task orchestration with rework and HUMAN_REQUIRED stop states |
| Durable scheduler / bounded parallel workers | ✅ | persisted queue, leases, recovery, concurrency and locks |
| GitHub delivery gateway / CI foundation | ✅ foundation | governed GitHub primitives + CI/security workflows; full event callback/auto-merge remains gated |
| Autonomous Git commit/push | ❌ | v0.3 刻意保持未 commit；push/publish 仍需後續高風險 gate |
| Arbitrary Windows GUI control | ❌ | 後續 desktop-control adapter |
| ChatGPT DOM scraping/injection | ❌ | 不是產品方向 |
| Role-based provider router | ✅ foundation | Claude/Codex/Gemini/OpenCode/Ollama adapters behind stable roles |
| Public Remote MCP exposure | ❌ | 不自動把本機暴露到公網 |
| Mobile remote local execution | ❌ | Roadmap，不是 v0.3.0 功能 |

---

# 介面說明

## Left — Local Computer

顯示：

- active Workspace
- detected repositories
- Git branch / dirty-clean
- local tools / versions
- Open Workspace
- Open Terminal（Engineering mode、使用者主動觸發）

## Center — Control Plane

同一份 canonical task data 可以切不同工程視圖：

- **Board** — 任務狀態
- **Pipeline** — stage / step
- **Graph** — Workspace / repo / provider / tools 關係
- **Trace** — 執行歷程
- **Evidence** — 驗證結果

## Right — Official ChatGPT Web

這是 companion pane，不是假 ChatGPT clone。

按鈕開啟官方 ChatGPT，OpenAI authentication 與官方網頁維持獨立。

---

# Providers / 未來擴充

右上角 **Providers** 可管理 Provider metadata。

內建：

- **ChatGPT Web** — 不需 API key，使用 Safe Bridge

架構已預留：

- API Provider
- Local Provider
- Remote MCP Provider

如果未來輸入 API key，AECP 使用 Electron/Windows OS-backed `safeStorage` 保存；plaintext 不寫進 project repository。

**v0.3.0 尚未呼叫這些外部 API。** Provider Registry 先建立是為了未來換模型時不用重寫 Local Harness。

---

# v0.3.0 刻意不做的事

第一個可下載 EXE 先以安全、可驗證為優先，因此目前不會：

- 執行 AI 對話複製來的任意 shell command
- 直接在 active Workspace 自主修改（v0.3 改為 isolated worktree + verified patch）
- 自主 Git commit / push
- 任意控制 Windows GUI
- scrape / automate ChatGPT DOM
- 規避 ChatGPT usage limit
- 實際呼叫已保存的外部 API provider
- 自動把本地 MCP server 暴露到 Internet
- 提供手機遠端本地施工

這些能力如果後續加入，必須經過 Blueprint 定義的 permission、policy、verification、evidence gate。

---

# Architecture / Blueprint

完整 Source of Truth：[`Blueprint/`](Blueprint/INDEX.md)

核心文件：

- `00_MASTER_BLUEPRINT.md`
- `01_UX_UI_SPEC.md`
- `02_LOCAL_AGENT_HARNESS.md`
- `03_PROVIDER_ROUTER.md`
- `04_SECURITY_AND_POLICY.md`
- `05_GITHUB_MULTI_REPO.md`
- `06_DESKTOP_CHATGPT_INTEGRATION.md`
- `07_INSTALL_RELEASE.md`
- `08_ROADMAP_ACCEPTANCE.md`
- `09_RESEARCH_NOTES.md`
- `10_CONVERSATION_DECISION_LOG.md`
- `11_TASK_PROTOCOL.md`
- `12_DATA_MODEL.md`
- `13_TRIPLE_AUDIT.md`
- `14_GUIDED_UX_AND_GOAL_LOOP.md`
- `15_SELF_EVOLUTION_PRIVATE_UPDATE_AGENT_INTEROP.md`
- `16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md`
- `17_V0_2_TRIPLE_AUDIT.md`
- `18_BOUNDED_AUTONOMOUS_EXECUTION.md`

創始需求與工程決策另外封存於 `Blueprint/Conversation/`。

---

# Developer setup

一般使用者完全不需要這一節。

需求：

- Node.js 24
- npm
- Windows（建 Windows installer 時）

```powershell
git clone https://github.com/Space653000/AI-Engineering-Control-Plane.git
cd AI-Engineering-Control-Plane
npm install
npm run verify
npm start
```

Build：

```powershell
# 新人主要 Release：單一自動判斷 x64 / ARM64
npm run dist:auto

# 故障排除 / 工程驗證
npm run dist:x64
npm run dist:arm64
```

輸出在 `release/`。

## Renderer security

Renderer：

- context isolation enabled
- Node integration disabled
- sandbox enabled
- narrow preload API

官方 ChatGPT 網頁不會載入 AECP privileged preload script。

---

# Automated CI / Release

Pull Request 會驗證：

1. syntax checks
2. unit tests
3. Windows x64 fallback installer
4. Windows ARM64 fallback installer
5. Windows x64+ARM64 Auto-Detect installer

Merge / push 到 `main` 後，Release workflow 會重新 build 並建立該版本的 GitHub **pre-release**，內容包含：

- `AI-Engineering-Control-Plane-Setup-0.3.0.exe` — **一般使用者下載這個**
- x64 fallback installer
- ARM64 fallback installer
- blockmaps
- `SHA256SUMS.txt`
- release notes

---

# Privacy

v0.3.0：

- no analytics SDK
- no telemetry
- no automatic source upload
- local task/evidence storage
- explicit clipboard handoff

Local AECP application data 存在 Electron per-user application-data directory；實際路徑由 App runtime 顯示。

---

# License

MIT. See [`LICENSE`](LICENSE).

# Status

This repository is an active preview. A `1.0.0` claim is blocked until the Blueprint's stable-release gates—including signed installers, broader harness adapters, migration/update testing, accessibility, and security review—are satisfied.


# Blueprint / Architecture

The **Blueprint is the product source of truth**. The complete architecture is now consolidated into `Blueprint/`, including the Harness engineering expansion:

- `20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md` — Planner → Queue → Worker → Verify → CI → Reviewer → Rework/Accept, bounded autonomy, scheduler/locks/recovery.
- `21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md` — vendor-neutral Supervisor/Planner/Builder/Reviewer/Verifier roles and versioned handoff contracts.
- `22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md` — Board/Queue/Agents/Trace/Git/CI/Evidence dashboard, event stream and mobile-ready supervision model.

### What is designed vs. what is implemented

**Blueprint complete:** the target end-state architecture, contracts, security boundaries, UX, event model, multi-repo model, provider abstraction, autonomous loop and acceptance gates are documented.

**Implementation is staged:** v0.3.0 Preview currently provides the safe bridge, workspace/task UI, local detection, bounded isolated-worktree autonomous worker, deterministic verification, evidence and verified-patch apply flow. The v0.3.x runtime now includes a bounded Planner → Builder → Verify → Reviewer orchestration path. It is deliberately sequential and bounded; durable multi-process scheduling, parallel workers, GitHub PR automation and CI-event feedback remain the next hardening stage.

### Canonical end-state loop

```text
Goal / Blueprint
      ↓
Planner (Claude / replaceable provider)
      ↓
Durable Task Queue
      ↓
Harness Scheduler + Policy + Locks
      ↓
Builder Worker (Codex / replaceable provider)
      ↓
Deterministic Verify
      ↓
Git / PR / GitHub Actions
      ↓
Reviewer (Claude / replaceable provider)
   ├─ PASS → ACCEPT → next task
   ├─ REWORK → Builder
   └─ HUMAN_REQUIRED → user approval
```

The Harness owns state, permissions, budgets, retries, timeouts, evidence and recovery. A model never grants itself permission or declares technical completion by itself.

### Current release truth

Do not treat Blueprint roadmap items as installed features. The **Complete Feature Map** below is the authoritative v0.3.0 Preview status table. Future features must pass the Blueprint acceptance gates before being marked implemented.


## Control Plane Hardening (current branch)

The current hardening stage adds the runtime infrastructure required for a governed engineering operating system:

- **SecurityPolicy** — GREEN/YELLOW/RED action classification and approval gates.
- **LockManager** — durable workspace/repository leases with recovery after expiry.
- **EvidenceManager** — hashed evidence files and manifests.
- **ContextBus** — bounded, expiring Context/Result Capsules so large repositories and logs do not flow through model prompts.
- **ProviderRouter** — role-based provider selection for Claude, Codex, Gemini, OpenCode and Ollama without making the control plane vendor-dependent.
- **GitHubGateway** — authenticated branch/commit/push/PR/check/workflow primitives for the future governed delivery loop.
- **CI/security workflows** — deterministic verification and dependency/security checks.
- **Mission activation** — automatic planner decomposition is now part of mission creation; a mission does not enter execution without a generated task plan.
- **Workspace locking** — concurrent tasks cannot silently mutate the same workspace at the same time.
- **Evidence + capsules** — completed tasks publish bounded result evidence for dashboard/review layers.

The system still deliberately refuses to make high-risk operations autonomous by default. Push, merge, delete, credential and system-level actions remain approval-gated. This is a safety property, not a missing feature.


# Current Engineering Status — 2026-09-19

> **Implementation truth:** AECP is now a working governed Control Plane prototype. The Blueprint and runtime have been synchronized to the same architecture. A roadmap item is not marked complete until code and verification exist.

## What is implemented now

- Durable Mission / Task state and bounded scheduler.
- Planner-driven Task decomposition with dependencies.
- Isolated task worktrees, leases, heartbeat and restart recovery.
- Planner → Builder → deterministic Verify → Reviewer loop.
- Bounded REWORK loop with iteration limits and timeouts.
- GREEN / YELLOW / RED security policy foundation with actual Builder write enforcement.
- Durable workspace/task locks.
- Evidence hashing, manifests, event journal and replay API.
- Bounded Context Bus / Context Capsules.
- Role-based Provider Router foundation for Claude, Codex, Gemini, OpenCode and Ollama.
- GitHub gateway and governed agent/<task-id> delivery branch.
- Idempotent Draft PR creation across retries.
- GitHub Actions CI monitoring tied to commit SHA.
- CI failure → bounded Task REWORK; CI success → approval gate.
- Human-gated PR merge; merge is blocked without CI PASS + explicit human approval.
- Live Harness Command Center with Mission Queue, Task Board, Approval Queue, PR/CI state, event stream and STOP ALL.
- CI and security workflows plus automated syntax/unit/infrastructure verification.

## Current truth / important limitation

The latest observed Security workflow passed. The main CI run was still in progress when this status was recorded; it is deliberately not described as passed until GitHub reports success.

The current implementation is not yet production-complete. The core control-plane architecture is established; remaining work is hardening and integration rather than redesigning the core concept.

## Remaining work

### P0 — Production correctness
- crash-safe resume at every execution phase;
- idempotent external event processing and correlation IDs;
- complete GitHub workflow/job/log evidence ingestion;
- no duplicate PRs during all rework/restart paths;
- security enforcement on every high-risk adapter path;
- full canonical-loop integration/E2E tests.

### P1 — Multi-repository engineering
- task-to-repository resource graph — implemented;
- per-repository/worktree scheduling and locks — implemented;
- cross-repo dependency handling — implemented through task dependencies and repository-per-task execution;
- GitHub repository/branch/PR state projection — implemented in delivery/task state.

### P2 — Event-driven integration
- event deduplication/idempotency ledger — implemented;
- signed GitHub webhook receiver — implemented and opt-in via secret;
- commit-SHA CI polling and failed-log evidence — implemented;
- authenticated GitHub webhook/repository_dispatch receiver — remaining integration; polling remains the safe fallback.

### P3 — Operations
- bounded maintenance/garbage-collection scheduler — implemented;
- expired lock/capsule recovery — implemented;
- evidence retention — implemented;
- deeper orphan worktree/drift scans — remaining hardening.

### P4 — Distribution
- clean-machine installer tests;
- signed/trusted release channel;
- update rollback;
- Private Microsoft Store lane.

### P5 — Remote supervision
- local authenticated read-only loopback gateway — implemented;
- authenticated LAN/device pairing — remaining;
- mobile read-only dashboard — gateway API is ready, UI/client remains remaining;
- remote approvals/task submission — intentionally gated until pairing/revocation is implemented.

For the complete maturity matrix, decisions, non-goals and ordered backlog, see Blueprint/23_IMPLEMENTATION_STATUS.md.

## Source-of-truth rule

- **GitHub:** engineering truth — code, Blueprint, commits, PRs, CI and releases.
- **Control Plane runtime:** runtime truth — queue, locks, heartbeats, budgets, current execution and local events.
- **Command Center:** human-facing projection — never an independent state database.

When these disagree, do not guess. Reconcile them through the event/state model and update the Blueprint if the architecture has changed.


## Current closure rule

The core AECP engineering loop is now considered **implemented and hardened prototype-complete**. Remaining items are external integration/trust operations or deliberately gated remote capabilities. In particular, Microsoft Store publication and production code-signing require user-owned publisher identity/certificates; repository code cannot legitimately manufacture those credentials.


## Optional GitHub webhook hardening

AECP includes a signed inbound GitHub webhook receiver. It is disabled by default. To enable the software-side receiver, configure the process environment with `AECP_GITHUB_WEBHOOK_SECRET` and optionally `AECP_GITHUB_WEBHOOK_PORT`. The receiver binds to loopback by default, verifies `X-Hub-Signature-256`, assigns a delivery idempotency key from `X-GitHub-Delivery`, and sends the event through the Control Plane event ledger. Exposing it to GitHub requires a user-owned authenticated tunnel or GitHub App/webhook endpoint; AECP never opens a public inbound port automatically.


## Runtime closure update — 2026-09-19

The current implementation also includes: signed GitHub webhook ingestion (opt-in), external-event idempotency, CI failed-log evidence, crash/restart recovery, repository-per-task routing, maintenance/worktree garbage collection, and an authenticated local read-only supervision gateway. GitHub commit-SHA polling remains the fallback when no webhook transport is configured. These capabilities are governed by the same Control Plane policy and are reflected in the Harness Command Center.


## Current implementation truth — 2026-09-19

### Completed in the current Control Plane branch

- durable Mission/Task scheduler with leases, heartbeat and restart recovery;
- Planner → Builder → Verify → Reviewer bounded loop;
- repository discovery and task-to-repository routing;
- per-repository/worktree locks and isolated execution;
- GitHub branch + idempotent Draft PR delivery;
- CI monitoring, bounded CI-driven rework and failed-log evidence;
- explicit human gate before governed merge;
- signed GitHub webhook receiver with delivery-id replay protection (opt-in);
- event ledger/replay, Context Capsule TTL and maintenance/garbage collection;
- local authenticated read-only supervision gateway;
- x64/ARM64 release workflow and SHA-256 artifact manifest;
- live Harness Command Center and synchronized Blueprint/status documentation.

### Remaining engineering gates

1. Failed-run recovery assistant and deeper drift/security/documentation maintenance scans.
2. Complete adapter-by-adapter SecurityPolicy audit.
3. Full integration/E2E matrix on clean temporary Git repositories and clean Windows environments.
4. Production code signing, installer smoke/update rollback and release provenance.
5. Authenticated LAN/mobile pairing; public exposure remains disabled by default.
6. Windows UI automation and public/remote MCP gateway remain separate capability layers.
7. Microsoft Store submission requires the publisher account/certificate owned by the operator.

**Important:** GitHub Actions is the verification authority for the current branch. Documentation is not used to mark a build as passed; only an actual successful run does that.
