# AECP 現況進度（Status）

**最後盤點日期：** 2026-09-24
**權威來源：** [`Blueprint/23_IMPLEMENTATION_STATUS.md`](../Blueprint/23_IMPLEMENTATION_STATUS.md)、[`Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md`](../Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md)
**目前分支：** `feat/control-plane-complete-loop` ｜ **整合中的 PR：** [#7](https://github.com/Space653000/0_JN1_AIECP/pull/7)（OPEN）

> 本文件只記錄「現在做到哪」。要知道「應該做成什麼樣子」看 [BLUEPRINT.md](BLUEPRINT.md)；要知道「怎樣才算做完」看 [ACCEPTANCE.md](ACCEPTANCE.md)。每次重大變更後都必須更新本文件，過期的 STATUS 比沒有 STATUS 更危險。

---

## ✅ 已完成（IMPLEMENTED + TESTED，倉庫內可自證）

### Control Plane 核心
- 持久 Mission/Task 狀態、Planner 驅動任務分解、有界排程器/可設定並行度。
- 任務相依檢查、任務租約（lease）與心跳、重啟後過期租約復原。
- Pause / Resume / Cancel、人工核准佇列、Electron IPC 曝露 mission/task/event 狀態、緊急 STOP ALL。

### Harness 執行
- Planner → Builder → 確定性 Verify → Reviewer 全流程。
- 隔離任務 worktree、有界迭代、Reviewer 產出 PASS/REWORK/HUMAN_REQUIRED、每次執行的證據根目錄、Result Capsule。

### 治理（Governance）
- 安全行為分級：READ/TEST/WRITE/INSTALL/COMMIT/PUSH/PR/MERGE/DELETE/CREDENTIAL/SYSTEM。
- GREEN/YELLOW/RED 風險模型；Builder 執行前強制 Workspace 寫入政策；高風險合併需明確人工核准；CI 須通過才能受管合併；代理無法自我核准權限。

### GitHub 交付
- gh CLI gateway、`agent/<task-id>` 分支慣例、重試冪等的 Draft PR 建立、依 commit SHA 監控 CI、CI 失敗導回有界 rework、CI 成功持久化為任務證據、受管人工合併路徑、無不受限的自動合併/推送。

### 可觀測性
- 持久 JSON 狀態、JSONL 事件日誌、每次執行的事件證據、事件回放 API、證據雜湊/清單、Command Center（missions/tasks/approvals/CI/PR/事件流）。

### Multi-Worker 執行期（2026-09-23 更新）
- 獨立 `WorkerRegistry`：Worker 身分、程序/任務指派、心跳、驗證狀態、取消狀態、重啟安全 UNKNOWN 復原語意。
- `CodexWorkerRuntime`：`codex-official` 與 `codex-pega` 各自物理獨立 `CODEX_HOME`，PEGA 憑證透過程序環境注入、不寫入 Codex 設定。
- PEGA Provider Adapter（`https://aiapi.t-cyber.com/v1`），明確 `responses`/`chat` 選線，無 PEGA 專屬 Task/Queue 狀態機。
- Mission 可選擇 Builder Worker pool；Scheduler 保留不同的閒置 Worker，拒絕靜默 fallback。
- 同倉庫並行任務使用不同任務級 worktree 根目錄/鎖；Git worktree 管理性變更序列化於倉庫級 admin lock。
- 任務取消僅影響自身 Worker/任務；Mission 取消全域；Dashboard STOP ALL 保留跨 mission 操作者權威。
- Dashboard 投影 canonical Worker 執行期欄位與健康度；無法驗證時顯示 UNKNOWN。

### 架構閘門與 CI 證據
- ARM64/x64 架構軟體側選擇閘門（`expected_arch`）已實作 + 測試 + **CI 驗證**。
- Exact-HEAD CI 證據：
  - commit `94d86a3f…` → AECP Security #663、AECP CI #792、Packaging #706、Build&Release #454（皆 SUCCESS）
  - commit `2d16de14…`（架構閘門）→ AECP Security #675、AECP CI #804、Packaging #718、Build&Release #466（皆 SUCCESS）

### 其他已實作 P0–P4.7 範圍
- 崩潰復原（孤兒執行階段重新排隊、待處理 CI 監控恢復）、CI 失敗日誌落證據、多倉庫資源綁定/鎖、簽章 GitHub webhook 接收器 + polling fallback、維運/保留排程、依賴與安全漂移掃描（診斷用、不自動改動）、遠端唯讀配對監督、Windows UI 唯讀檢視、Provider 健康狀態機（NOT_CONFIGURED/READY/DEGRADED/UNAVAILABLE/AUTH_REQUIRED）、Local-data 治理（清除證據/憑證/重設，工作中禁止）。

---

## 🚧 施工中 / 部分完成

- **本地未提交的工作區變更**（尚未 commit）：`Blueprint/10、15、23`、`README.md`、`Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md`、`electron/main.cjs`、`tests/release-workflow.test.cjs` — 屬於 PR #7 的進行中內容，建立本文件前尚未整理提交。
- **README.md 版本標示不一致**：標題仍寫「Target release: v0.3.0 Preview」與對應安裝檔名，但內文已混入 V3.0 Multi-Worker 內容與 2026-09-22/23 的狀態區塊，且 Blueprint 檔案列表只列到 18 號、漏列 19–24 與 REQUIREMENTS.md/INDEX.md。**待辦：下次修訂 README 時一併更新版本橫幅與 Blueprint 索引。**
- **文件累積雜訊**：README 內多段按日期附加的狀態區塊（2026-09-19/22/23）尚未整併，閱讀體驗差但無實質矛盾。

---

## ⛔ 未完成 / 環境閘門（ENVIRONMENT gate — 需真實機器/帳號/供應商才能結案）

> 這些項目**不能**靠增加程式碼或測試關閉，只能靠在目標環境上實際跑一次並附上證據關閉。

- 真實 Codex OFFICIAL 執行（使用其隔離、已登入的 `CODEX_HOME`）。
- 真實 Codex PEGA 執行（對 `https://aiapi.t-cyber.com/v1` 使用真實帳號/模型）。
- 真實 OFFICIAL + PEGA 同時並行執行（多 codex 併發，跨程序/worktree）。
- 上述於目標 Windows 機器（含 **ARM64**）重跑一次 —— 注意：ARM64 的**架構選擇閘門機制本身**已 CI 驗證通過，但「真實 provider 在 ARM64 上執行」仍待驗證。
- 本地 Ollama smoke test / 使用真實 Ollama 模型的 canonical Harness E2E。
- 真實 OpenCode+Ollama 檔案編輯 smoke、透過 `provider-environment.yml` 的固定 local/company 指令 smoke。
- 實體 Windows-on-ARM64 裝置由真人操作的啟動/UI smoke test。
- 真人驗證 OpenCode/Codex CLI 確實安裝於使用者筆電並產出可用修改；驗證專案自身 verifier/測試腳本安全。
- 對真實受支援 ChatGPT Business/Enterprise/Edu workspace 的 Secure MCP Tunnel 佈建與 Official Full MCP 端到端驗收（連接器/tunnel 健康、讀取工具、政策閘門寫入工具、斷線 fallback）。
- 真實 PEGA/OFFICIAL 故障隔離行為（實際斷線情境下）。

## ⛔ 未完成 / 外部擁有者閘門（OWNER-EXTERNAL GATE — 只有 repo 擁有者本人能結案）

- 正式 Authenticode 程式碼簽章憑證的擁有權/密鑰，以及擁有者授權的簽章發布執行。
- Microsoft Store / Partner Center：發行者身分對應、套件保留、Store 認證/送審、乾淨裝置的 Private Audience 取得。
- 選用的公開/區網遠端閘道網域、裝置身分與 TLS 擁有權/部署。
- 任何特定供應商「正式生產」宣稱所需的真實第三方/本地執行環境、模型檔案或憑證。

## 🚫 刻意不做 / 已停用（設計選擇，不是遺漏）

- 任意由 AI 文字驅動的無限制 shell 執行 — 刻意從未曝露。
- 遠端任務提交（remote task submission）— 刻意停用，待未來獨立驗收閘門開放。
- Full MCP 寫入/修改工具 — 在端到端連接器/tunnel + 政策閘門寫入路徑就緒前不宣稱。
- Claude Code / Gemini CLI 作為自主寫入 Worker — 尚未啟用於有界寫入迴圈，待對等沙箱/權限模型。
- 不受限的 Windows GUI 控制與瀏覽器/ChatGPT 自動化樹狀檢視 — 預設拒絕；視窗狀態 docking 變更需 SYSTEM 層級核准。
- 自主迴圈中的自動 commit/push/publish — 不存在；Apply 後變更維持未提交狀態；合併永遠人工把關。

---

## 阻塞項總表（供快速檢視）

| 類別 | 數量級 | 誰能解除 |
|---|---|---|
| ENVIRONMENT gate | 10 項 | 需要在真實機器/帳號上實際執行並回報證據 |
| OWNER-EXTERNAL gate | 4 類 | 只有 `Space653000`（repo 擁有者）本人 |
| 刻意不做 | 6 項 | 需要新的獨立 Blueprint 決策才會開放，非「忘記做」 |

**結論（與 [`23_IMPLEMENTATION_STATUS.md`](../Blueprint/23_IMPLEMENTATION_STATUS.md) 一致）：** 專案已從「只有藍圖」進化到「治理完整、可由倉庫自證的控制平面」，剩餘的不完整幾乎全部是外部信任/帳號/供應商證據缺口，或是刻意的安全邊界，而不是未追蹤的程式碼待辦清單。
