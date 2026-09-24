# AECP 現況進度（Status）

**最後盤點日期：** 2026-09-24
**權威來源：** [`Blueprint/23_IMPLEMENTATION_STATUS.md`](../Blueprint/23_IMPLEMENTATION_STATUS.md)、[`Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md`](../Reports/V3_IMPLEMENTATION_PROGRESS_REPORT.md)
**目前分支：** `feat/control-plane-complete-loop` ｜ **PR：** [#7](https://github.com/Space653000/0_JN1_AIECP/pull/7) 已由擁有者於 2026-09-24 09:24 UTC 合併進 `main`（head `294ff93`）；後續施工的 Draft PR 為 [#8](https://github.com/Space653000/0_JN1_AIECP/pull/8)（**本 repo 的 CI 只在 PR 或 push 到 main 時執行，故分支必須保持有 open PR，否則 push 不會有 CI**）。`provider-environment.yml` 已在 `main`，可於 GitHub 派發，合併後首次派發驗證仍待擁有者執行。

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
  - commit `36c7b871…`（新增 `.ai/` 治理入口）→ AECP Security run #35949301577、AECP CI #35949301581、CI/Packaging #35949301594、Build and Release #35949301578（皆 SUCCESS）。
  - commit `268f01d31861d157aaa50895d188ce6a36a0d7fd`（Codex 工作入口、provider process 修正、README 索引）→ [AECP Security #35950467641](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35950467641)、[AECP CI #35950467611](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35950467611)、[CI/Packaging #35950467650](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35950467650)、[Build and Release #35950467606](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35950467606)（皆 SUCCESS）。最新分支 HEAD 的狀態以 [PR #7](https://github.com/Space653000/0_JN1_AIECP/pull/7) 即時檢查為準。

### 其他已實作 P0–P4.7 範圍
- 崩潰復原（孤兒執行階段重新排隊、待處理 CI 監控恢復）、CI 失敗日誌落證據、多倉庫資源綁定/鎖、簽章 GitHub webhook 接收器 + polling fallback、維運/保留排程、依賴與安全漂移掃描（診斷用、不自動改動）、遠端唯讀配對監督、Windows UI 唯讀檢視、Provider 健康狀態機（NOT_CONFIGURED/READY/DEGRADED/UNAVAILABLE/AUTH_REQUIRED）、Local-data 治理（清除證據/憑證/重設，工作中禁止）。

---

## 🚧 施工中 / 部分完成

- **施工單 [0002](WORK_ORDERS/0002.md) 倉庫施工完成，Claude 驗收 CLOSED（TESTED；審查紀錄見該施工單末尾）**：A `7d098e09be09c9beba15921bfca21ec4a427566d` 增加 OFFICIAL、PEGA、固定 local-command 的獨立暫存 worktree 檔案 verifier；B `b97746109b07addf57d4aa138971f9123eb759c8` 增加 `codex-fault-isolation` 與安全的 scratch Registry／保護斷言／recovery；runbook 同步 `a0b2a343cbce4d6064a48925a4bcd8bc6c22368f`。本機 `npm run verify` 通過，`npm test` 267/267 PASS。三個施工 commit 同批推送，無各自 exact-SHA CI run；本張交付 HEAD 的 CI 待驗證。真實 provider 與 Safe Bridge 實機證據仍屬 ENVIRONMENT 待辦。
- **施工單 [0003](WORK_ORDERS/0003.md) 倉庫施工完成，Claude 驗收 CLOSED（TESTED；審查紀錄見該施工單末尾）**：A `6c8ef5560f7095503940ef1cc339a717d9034d39` 增加唯讀 JSON 證據驗證器與機密掃描；B `a65e5a2c5d897c10c977f56e38beca1f0f4bfead` 增加 `X64`／`ARM64` 動態 runner 標籤並保留 runtime hard gate，補正 acceptance audit `119a77c4190cf3307935f2af0db6786b1d98e2f6`；C `5521ab47bc231ba48c6cdaeba502a317f1d1f0cf` 新增 [PR #7 合併就緒檢查](../Reports/PR7_MERGE_READINESS.md)，未合併。施工後本機 `npm run verify` 通過，`npm test` 278/278 PASS。各施工 commit 的 exact-SHA CI 只依各自 run 記錄；本張最終 HEAD 尚需 CI 核對。`actionlint` 本機不可用，已以 YAML parser 測試結構；動態標籤語法另對照 GitHub 官方文件。實體 runner、真實供應商等 ENVIRONMENT 未完成。
- **施工單 [0004](WORK_ORDERS/0004.md) 倉庫施工完成，Claude 驗收 CLOSED（TESTED；審查紀錄見該施工單末尾）**：A `31de01ba6fcf588783fc0f66bd22b06b25bb1a5f` 新增三種 owner 證據 JSON 範本與唯讀姊妹驗證器；B `16286b4756836ffde4981ce2326f998f53dba93f` 新增 [Owner Gates 手冊](../Reports/OWNER_GATES_RUNBOOK.md)；C `6b3117656a3c74394d87663dc7dfdc276f398976` 僅以 append-only 更新 [Blueprint/23](../Blueprint/23_IMPLEMENTATION_STATUS.md)。本機 `npm run verify` 通過，`npm test` 285/285 PASS；交付 HEAD 的 exact-SHA CI 待驗證。手冊已明列遠端部署／正式生產供應商認證的自動化缺口；所有 ENVIRONMENT 與 OWNER-EXTERNAL 閘門仍未完成。
- **施工單 [0005](WORK_ORDERS/0005.md) 倉庫施工完成，Claude 驗收 CLOSED（TESTED；含 Claude 熱修，見施工單末尾）**：A `e0b286a20573bc3139276c1ffae5e1721352defe` 僅在 Actions 寫入指定 `workflowRun` 識別欄位，驗證器改標 `WORKFLOW_CLAIMED` 並要求人工核對 run；B `204d61700de7a2ad52a89b68d8efecde9c980aea` 新增 Safe Bridge 故障期 owner 範本、驗證及驗收說明；C `6bcb27d5bf1adcadad430f31355f5baf00712a57` 僅在 PR #7 就緒文件末尾追加合併後首次派發負向檢查清單。本機 `npm run verify` 通過，`npm test` 290/290 PASS。新 HEAD 的 CI 需按其實際 run 核對；首次派發、真實供應商與 Safe Bridge 實機證據仍是 ENVIRONMENT 待辦，PR #7 未合併。

- **Codex 施工入口與前輪修正**：`AGENTS.md`、`.ai/CODEX_WORKER.md` 已建立；`provider-router.cjs` 原有 pipe/程序收斂修正已納入測試；README 已區分 `v0.3.0` 套件版本與 V3.0 Multi-Worker 藍圖階段，並補齊 19–24 號藍圖索引。前輪本機 `npm run verify` 通過、`npm test` 254/254 PASS；`268f01d` 的四組 GitHub workflows 皆 SUCCESS。Claude Code Review（2026-09-24，HEAD `9c232a9`）：**接受**，證據等級 CI；非阻擋意見 R1、R2 已由下述施工單 0001 實作，並經 Claude 驗收（CLOSED，2026-09-24，HEAD `bf1ab25`）。
- **施工單 [0001](WORK_ORDERS/0001.md)：A/B/C 倉庫內施工完成，Claude 驗收 CLOSED**。A `017dca4df28d20109e322924c44460531d301669`：新增 timeout、abort、output limit、exit 寬限內資料、late close 五個收斂測試。B `dd54cdf0e7405acb5c92e84d13eec520b6bffd06`：README 日期狀態逐字封存於 [`Reports/README_STATUS_HISTORY.md`](../Reports/README_STATUS_HISTORY.md)，保留單一 Current status。C `86236b44deedfcd2a25eb287fcb569ead46aec9b`：新增 [`Reports/ENVIRONMENT_EVIDENCE_RUNBOOK.md`](../Reports/ENVIRONMENT_EVIDENCE_RUNBOOK.md)，逐項列出十個 ENVIRONMENT 閘門的操作、證據與缺口。完工後本機 `npm run verify` 全綠，`npm test` **259/259 PASS**。三個施工 commit 隨同批推送，**沒有各自的 exact-SHA workflow run**，不能宣稱個別 CI PASS；整批交付 HEAD 的結果如下。
- **交付 HEAD 的 exact-SHA CI（2026-09-24）**：`34e262d3bd455788a86445cee59ad221a8282873` 的 [AECP Security #35967550698](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35967550698)、[AECP CI #35967550747](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35967550747)、[CI/Packaging #35967550767](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35967550767)、[Build and Release #35967550886](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35967550886) 均為 **SUCCESS**。這只證明該 SHA 的倉庫 CI，不是任何 ENVIRONMENT／OWNER-EXTERNAL 驗收。補記本段所產生的新文件 commit 需另以其 exact SHA 核對 CI。

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

**結論（2026-09-24 更正，Claude 於 `c98ad0f` 驗收後更新）：** 0006–0009 已解決 GAP_REGISTER 的 G1（Reviewer 看不到實際 diff）、G2、G3、G4／G5（Dashboard 視圖，已用真實 `ui/` 渲染驗證）、G6（追溯矩陣）。仍有：**G7**（通知規則與真實事件名稱不一致，CRITICAL 永不出現；0010 修）與 **G8**（追溯矩陣 178 條尚未分類的 GAP，多數應是「已實作但缺測試」，但可能藏有真缺口；0010、0011 逐條分類）。在 `--strict` 追溯稽核通過、且所有 `CONFIRMED_GAP` 都被修補或明確裁定之前，**不得宣稱「對標藍圖完整」**。ENVIRONMENT / OWNER-EXTERNAL 閘門仍如上所列。

### 施工單 0006 施工進度（Claude 驗收 CLOSED）

- 新增條文追溯矩陣與機械稽核，納入 `npm run verify`；原有藍圖覆蓋稽核明示僅查檔案存在。矩陣目前 231 條：24 IMPLEMENTED（有具名測試）、1 PARTIAL、206 GAP（含尚未證明的證據缺口）。此數字**不是產品完成率**，不得將證據缺口等同功能缺失或反過來當作完成。
- 新發現 Blueprint/12 §4 `schemaVersion` 一致性疑點；未修改 Blueprint 或執行邏輯，待藍圖擁有者裁定。Blueprint/21 §10 實際 8 條，施工單誤寫 10 條。
- 0007–0009 尚待施工；ENVIRONMENT／OWNER-EXTERNAL 閘門及 PR #7 狀態不變。

### 施工單 0007 施工進度（Claude 驗收 CLOSED）

- A/B/C 已分別提交：Reviewer 取得有界且遮罩的 Blueprint/Plan/unified diff/Verifier 證據；`aecp.review/v1` 六維度驗證器拒絕舊式或矛盾 PASS；`aecp.worker-report/v1` 的變更檔取自 Git，Worker 自述不能作驗收證明。
- 追溯矩陣從 231 條中確認 32 IMPLEMENTED、1 PARTIAL、198 GAP；GAP 主要為未取得同條文具名測試的保守證據分類，非已證明 198 個功能缺失。0008、0009 與外部環境／擁有者閘門仍待處理。

### 施工單 0008 施工進度（Claude 驗收 CLOSED）

- A/B/C 已分別提交：repo 內分層 AGENTS/藍圖/驗證指令/ADR 發現；依 provider 能力分送有界內容或 metadata；漂移掃描只給 WARNING，不改檔。`npm test` 312/312 PASS，完整 `npm run verify` 見施工單回報。
- TRACEABILITY 231 條中 35 IMPLEMENTED、1 PARTIAL、195 GAP（保守證據分類）。0009 Dashboard 視圖仍待施工，ENVIRONMENT／OWNER-EXTERNAL 閘門不變。

### 施工單 0009 施工進度（Claude 驗收 CLOSED，附缺陷 D1 見 0010）

- A–F 已各自提交；Run timeline、Diff、Review、GitHub、Notifications 與五階段進度皆由正式 task／event／delivery 狀態唯讀投影，缺資料顯示 UNKNOWN。A 另有持久化 Harness 事件日誌的獨立修正 commit；詳見 [0009 回報](WORK_ORDERS/0009.md)。
- `npm run verify` 通過，`npm test` **326/326 PASS**。TRACEABILITY 231 條中 52 IMPLEMENTED、1 PARTIAL、178 GAP；狀態只表示具名測試證據程度，非整體完成率。尚缺 Electron 實機 UI／輔助技術驗收；本次 HEAD 的 CI 需依 exact SHA workflow 實際結果核對。
- 0006–0009 已由 Claude 驗收 CLOSED（0009 附通知映射缺陷，0010 修正）；另有 0010、0011 分類與修補中，**未宣稱整體藍圖完成**；ENVIRONMENT／OWNER-EXTERNAL 閘門仍未完成，不自行更改 PR #7 合併狀態。
