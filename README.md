# AI Engineering Control Plane

**AI Engineering Control Plane (AECP)** is a Windows-first local control plane that lets you keep using **official ChatGPT Web** as your conversational AI while AECP manages the local engineering side: Workspace boundaries, repositories, task state, local tools, evidence, and future provider adapters.

> **Current release: v0.1.0 Preview.** The normal path uses ChatGPT Web and does **not** require an OpenAI API key. The preview intentionally exposes read-only local task capabilities first; it does not yet allow arbitrary AI-generated shell commands or autonomous file modification.

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

`AI-Engineering-Control-Plane-Setup-0.1.0.exe`

這是 **Auto-Detect 安裝版**，內含 Windows x64 與 ARM64 payload。安裝時會自動判斷你的 Windows 架構並選擇正確版本，所以一般使用者不用知道自己是 Intel / AMD / Snapdragon，也不用自己選 ARM64 或 x64。

Release 仍會保留下面兩個故障排除用 fallback：

- `AI-Engineering-Control-Plane-Setup-x64-0.1.0.exe`
- `AI-Engineering-Control-Plane-Setup-arm64-0.1.0.exe`

只有主 Auto-Detect 安裝檔真的無法使用時才需要碰 fallback。

## 2. 安裝

1. 雙擊 `AI-Engineering-Control-Plane-Setup-0.1.0.exe`。
2. 使用預設的 **per-user** 安裝即可，不需要管理員權限。
3. 想要桌面捷徑就保留 **Desktop shortcut**。
4. 完成後開啟 **AI Engineering Control Plane**。

### Windows SmartScreen 如果跳出來

v0.1.0 Preview 目前尚未做 Authenticode 簽章，因此 Windows 可能顯示 SmartScreen 警告。

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

v0.1.0 的安全範例只會做 read-only：

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

# 完整功能地圖

下面刻意區分「v0.1.0 現在真的有」與「Blueprint 已規劃但尚未開放」，避免把 roadmap 誤認為完成品。

| Area | v0.1.0 Preview | What it means |
|---|---|---|
| Official ChatGPT Web companion | ✅ | 開官方 `chatgpt.com`；AECP 不接管登入 |
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
| Arbitrary AI shell execution | ❌ | v0.1.0 刻意禁止 |
| Autonomous file modification | ❌ | 等 governed write adapter |
| Autonomous Git commit/push | ❌ | 等 policy / approval / evidence gate |
| Arbitrary Windows GUI control | ❌ | 後續 desktop-control adapter |
| ChatGPT DOM scraping/injection | ❌ | 不是產品方向 |
| External API provider execution | ❌ | v0.1.0 只有 Registry foundation |
| Public Remote MCP exposure | ❌ | 不自動把本機暴露到公網 |
| Mobile remote local execution | ❌ | Roadmap，不是 v0.1.0 功能 |

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

**v0.1.0 尚未呼叫這些外部 API。** Provider Registry 先建立是為了未來換模型時不用重寫 Local Harness。

---

# v0.1.0 刻意不做的事

第一個可下載 EXE 先以安全、可驗證為優先，因此目前不會：

- 執行 AI 對話複製來的任意 shell command
- 自主修改 / 刪除專案檔案
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

- `AI-Engineering-Control-Plane-Setup-0.1.0.exe` — **一般使用者下載這個**
- x64 fallback installer
- ARM64 fallback installer
- blockmaps
- `SHA256SUMS.txt`
- release notes

---

# Privacy

v0.1.0：

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
