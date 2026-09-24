# AECP Blueprint — 唯一藍圖依據

**本文件是本專案的單一藍圖入口（Single Source of Truth Index）。**
它不取代 `Blueprint/` 目錄下任何原始文件，而是整理、引用、索引它們，讓 Claude Code（或任何協作者）能在動工前快速取得完整、正確的產品/架構脈絡。

> 規則：本文件與原始 `Blueprint/*.md` 衝突時，以編號最新、日期最新的原始 Blueprint 文件為準；若牽涉「目前是否完成」，一律以 [`../Blueprint/23_IMPLEMENTATION_STATUS.md`](../Blueprint/23_IMPLEMENTATION_STATUS.md) 與 [`STATUS.md`](STATUS.md) 為準，Blueprint 描述的是「應該長成什麼樣子」，不是「現在做到哪」。

---

## 0. 產品是什麼

**AI Engineering Control Plane（AECP）** — Windows-first 的本地工程控制平面。

- 使用者持續使用**官方 ChatGPT Web** 作為主要對話介面（監督者）。
- AECP 提供本地端持久執行環境：Workspace、檔案、Git 倉庫、工具、任務狀態、政策、驗證、證據、（選用）本地運算與其他模型供應商。
- AECP **不是另一個聊天機器人**，不複製、不注入、不爬取 ChatGPT；它是「AI 對話」與「使用者電腦上真實工程工作」之間的操作層。

**產品不可退讓原則（Product Invariants）**——摘自 [`00_MASTER_BLUEPRINT.md`](../Blueprint/00_MASTER_BLUEPRINT.md)：

1. 官方 ChatGPT 保持不被碰觸（無 DOM 注入、無隱藏爬蟲、無回應攔截、無 cookie/session 竊取、無逆向工程）。
2. 不規避供應商用量限制。
3. 本地優先：原始碼、大型 log、索引、embedding、執行證據預設留在本地。
4. 最小必要雲端上下文：優先使用 Context Capsule 而非整包上傳。
5. 人類權威：破壞性/特權/憑證/發布/計費/安全敏感/不可逆操作需要政策檢查與通常需要明確人工核准。
6. 供應商獨立：ChatGPT Web 是偏好的監督者，不是寫死的執行期依賴。
7. 證據優於自我宣稱：任務完成靠狀態/測試/證據證明，不是模型自己說完成。
8. 可恢復性：每個任務都有持久狀態、trace、輸出、timeout/cancel 行為與明確終止狀態。
9. 單一狀態來源：Board、Pipeline、Graph、Trace 都是同一個 canonical task/workspace model 的視圖。

## 1. 系統架構（現況目標架構）

```text
Official ChatGPT Web
        │  Safe Bridge / 未來 official MCP
        ▼
AECP Command Center
        │
        ▼
Control Plane
  Mission / Plan / Task DAG
  Queue / Scheduler / Lease
  Policy / Approval
  Lock / Recovery
  Event Journal
  Evidence / Context Capsule
        │
        ├── Planner / Reviewer → Provider Router
        ├── Builder → 隔離 worktree（Codex OFFICIAL / Codex PEGA / 其他 Worker）
        └── Verifier → 確定性驗證閘門
        │
        ▼
Git / GitHub（工程真理來源）
        │
        ├── governed branch
        ├── Draft PR
        └── GitHub Actions CI
                │
        ┌───────┴────────┐
        │                │
       PASS             FAIL
        │                │
  人工核准             有界 REWORK
        │                │
      MERGE ◄───────────┘
        │
       DONE
```

角色穩定、供應商可替換：`Supervisor / Planner / Researcher / Builder / Reviewer / Verifier / Maintainer / Local Compute / Harness`，任何角色都可由不同 Provider/Worker（Claude Code、Codex OFFICIAL、Codex PEGA、Ollama…）擔任，細節見 [`21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md`](../Blueprint/21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md)。

## 2. 三個真理來源（Sources of Truth）

| 來源 | 代表什麼 | 絕不可以做 |
|---|---|---|
| **GitHub**（commit / PR / CI） | 工程真理來源 | Dashboard 不可宣稱與 GitHub 不同的合併/CI 狀態 |
| **Harness 執行期狀態**（`harness.json`、event ledger） | 任務/流程真理來源 | 不可與 GitHub 狀態混為一談 |
| **Dashboard** | 上述兩者的**投影（projection）** | 絕不可成為獨立真理來源；驗證不到就顯示 `UNKNOWN`，不可造假綠燈 |

## 3. Blueprint 文件索引（`Blueprint/` 全目錄，25 份，未刪改任何原檔）

| # | 文件 | 內容一句話 |
|---|---|---|
| 00 | [00_MASTER_BLUEPRINT.md](../Blueprint/00_MASTER_BLUEPRINT.md) | 產品定義、不可退讓原則、系統架構總覽 |
| 01 | [01_UX_UI_SPEC.md](../Blueprint/01_UX_UI_SPEC.md) | 三面板 UX、新手模式、Board/Pipeline/Graph/Trace 視圖 |
| 02 | [02_LOCAL_AGENT_HARNESS.md](../Blueprint/02_LOCAL_AGENT_HARNESS.md) | 任務執行期、狀態機、驗證、復原、Harness Engineering 擴充 |
| 03 | [03_PROVIDER_ROUTER.md](../Blueprint/03_PROVIDER_ROUTER.md) | ChatGPT Web 優先；官方 MCP／API／本地模型為選用；Provider 與 Worker 分離 |
| 04 | [04_SECURITY_AND_POLICY.md](../Blueprint/04_SECURITY_AND_POLICY.md) | 信任邊界、風險分級（GREEN/YELLOW/RED）、政策即程式碼、憑證處理 |
| 05 | [05_GITHUB_MULTI_REPO.md](../Blueprint/05_GITHUB_MULTI_REPO.md) | 多倉庫/worktree/並發鎖模型 |
| 06 | [06_DESKTOP_CHATGPT_INTEGRATION.md](../Blueprint/06_DESKTOP_CHATGPT_INTEGRATION.md) | Official ChatGPT 隔離與安全交接（Safe Bridge） |
| 07 | [07_INSTALL_RELEASE.md](../Blueprint/07_INSTALL_RELEASE.md) | Windows 自動偵測安裝、x64/ARM64、發布、更新 |
| 08 | [08_ROADMAP_ACCEPTANCE.md](../Blueprint/08_ROADMAP_ACCEPTANCE.md) | 交付階段 P0–P7 與可量測驗收閘門 |
| 09 | [09_RESEARCH_NOTES.md](../Blueprint/09_RESEARCH_NOTES.md) | 外部研究筆記與採納的設計模式 |
| 10 | [10_CONVERSATION_DECISION_LOG.md](../Blueprint/10_CONVERSATION_DECISION_LOG.md) | 創始需求/決策簡史 |
| 11 | [11_TASK_PROTOCOL.md](../Blueprint/11_TASK_PROTOCOL.md) | Command Card / Context Capsule / Result Capsule / Trace schema |
| 12 | [12_DATA_MODEL.md](../Blueprint/12_DATA_MODEL.md) | 持久實體模型（Workspace/Resource/Task/Provider/Worker/Evidence） |
| 13 | [13_TRIPLE_AUDIT.md](../Blueprint/13_TRIPLE_AUDIT.md) | v0.1.0 三軸獨立稽核（**歷史文件**，現況見 23 號） |
| 14 | [14_GUIDED_UX_AND_GOAL_LOOP.md](../Blueprint/14_GUIDED_UX_AND_GOAL_LOOP.md) | 新手導引 UX、Goal Loop、預算、checkpoint、停止條件 |
| 15 | [15_SELF_EVOLUTION_PRIVATE_UPDATE_AGENT_INTEROP.md](../Blueprint/15_SELF_EVOLUTION_PRIVATE_UPDATE_AGENT_INTEROP.md) | 私有更新通道、Agent Adapter、跨代理交接 |
| 16 | [16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md](../Blueprint/16_CONSTRAINT_RESOLUTION_DISTRIBUTION_EXECUTION_MODES.md) | Store 私有發行、Web/Local/Official-MCP 三種執行模式 |
| 17 | [17_V0_2_TRIPLE_AUDIT.md](../Blueprint/17_V0_2_TRIPLE_AUDIT.md) | v0.2 稽核（**歷史文件**，現況見 23 號） |
| 18 | [18_BOUNDED_AUTONOMOUS_EXECUTION.md](../Blueprint/18_BOUNDED_AUTONOMOUS_EXECUTION.md) | 隔離 worktree、有界 worker、確定性驗證、顯式 Apply 閘門 |
| 19 | [19_V0_3_TRIPLE_AUDIT.md](../Blueprint/19_V0_3_TRIPLE_AUDIT.md) | v0.3 稽核（**歷史文件**，現況見 23 號） |
| 20 | [20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md](../Blueprint/20_HARNESS_ENGINEERING_MULTI_AGENT_LOOP.md) | Harness Engineering、Planner/Worker/Reviewer 迴圈、佇列/鎖、CI 事件、成熟度模型 |
| 21 | [21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md](../Blueprint/21_AGENT_ROLES_AND_HANDOFF_PROTOCOL.md) | 供應商中立角色與明確交接契約 |
| 22 | [22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md](../Blueprint/22_DASHBOARD_QUEUE_AND_EVENT_ARCHITECTURE.md) | 工程指揮中心、佇列、事件流、行動裝置友善視圖 |
| 23 | [23_IMPLEMENTATION_STATUS.md](../Blueprint/23_IMPLEMENTATION_STATUS.md) | **現況實作快照（權威）**：已完成/凍結決策/成熟度/外部閘門 |
| 24 | [24_LOCAL_MODEL_PROVIDER_VERIFICATION.md](../Blueprint/24_LOCAL_MODEL_PROVIDER_VERIFICATION.md) | 本地模型（Ollama）與真實 Provider 驗證等級 |
| — | [REQUIREMENTS.md](../Blueprint/REQUIREMENTS.md) | R1–R8 正規需求清單（見 [ACCEPTANCE.md](ACCEPTANCE.md)） |
| — | [INDEX.md](../Blueprint/INDEX.md) | 原始藍圖目錄索引 |
| — | [Conversation/2026-09-17_FOUNDING_CONVERSATION.md](../Blueprint/Conversation/2026-09-17_FOUNDING_CONVERSATION.md) | 創始對話完整存檔 |

## 4. 永久邊界 / Non-Goals（跨文件一致）

- 絕不對 `chatgpt.com` 做 DOM 注入、訊息爬取、cookie/session 竊取、逆向工程私有端點、規避用量限制。
- 絕不開放任意 AI 文字驅動的無限制 shell 執行。
- 絕不允許代理自我核准權限（no self-grant of permission）。
- 遠端任務提交（remote task submission）目前**刻意停用**，等待未來獨立驗收閘門。
- 自動化迴圈必須有界（bounded）；沒有無限自動迴圈。
- 高風險操作（發布/合併/刪除/憑證/系統層級）必須經政策 + 明確人工核准。
- Dashboard 永遠是投影，不是獨立資料來源；驗證不到就顯示 UNKNOWN，不可造假。

## 5. 如何使用本文件

1. 開始任何工作前，先讀本文件了解「應該長成什麼樣子」。
2. 需要細節時，點進對應編號的原始 Blueprint 文件。
3. 想知道「現在做到哪」，去看 [STATUS.md](STATUS.md)（本文件不記錄進度）。
4. 想知道「什麼才算做完」，去看 [ACCEPTANCE.md](ACCEPTANCE.md)。
5. 新決策/新範圍變更，先寫回對應編號的 Blueprint 原始文件（或新增編號），再回來更新本索引——**本檔案只做索引與整理，不單獨承載新的產品決策**。
