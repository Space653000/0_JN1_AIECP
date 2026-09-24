# AECP 驗收標準（Acceptance Criteria）

本文件整理自 [`Blueprint/REQUIREMENTS.md`](../Blueprint/REQUIREMENTS.md)、[`Blueprint/08_ROADMAP_ACCEPTANCE.md`](../Blueprint/08_ROADMAP_ACCEPTANCE.md) 與 [`Blueprint/13/17/19_*_TRIPLE_AUDIT.md`](../Blueprint/13_TRIPLE_AUDIT.md) 的稽核方法論，是判斷「這件事算不算做完」的唯一依據。與 [BLUEPRINT.md](BLUEPRINT.md)（要做成什麼樣子）互補：這裡回答「怎麼證明做到了」。

---

## 0. 證據等級規則（最重要的一條規則）

任何完成宣稱都必須標明證據等級，**下層證據不能冒充上層證據**：

| 等級 | 意思 | 誰能簽署 |
|---|---|---|
| **STATIC** | 語法檢查/程式碼審閱通過 | `npm run check` |
| **TESTED** | 有確定性單元/整合測試覆蓋且通過 | `npm test` |
| **CI** | 在 GitHub Actions **exact-HEAD commit** 上跑出 PASS | 需附 workflow 名稱 + run 編號 |
| **ENVIRONMENT** | 需要真實機器/帳號/供應商端點執行才能證明 | 需附真實 run 的證據（架構、worker 身分、CODEX_HOME hash、模型、健康度、verifier 結果） |
| **OWNER / EXTERNAL** | 需要專案擁有者的憑證/身分/帳戶（簽章憑證、Microsoft Store 身分、正式網域） | 只有 repo 擁有者本人能完成，程式碼與測試永遠無法自證 |

> 鐵律：**Blueprint 存在 ≠ Runtime 完成**；**repo 測試 ≠ 真實 provider 證據**。任何人（含 Claude Code）都不得把 ENVIRONMENT 或 OWNER/EXTERNAL 等級的項目標記為完成，除非附上對應等級的真實證據。

## 1. R1–R8 正規需求（驗收檢查表）

逐條核對 [`Blueprint/REQUIREMENTS.md`](../Blueprint/REQUIREMENTS.md)：

- **R1 信任邊界**：ChatGPT DOM/session 不被碰觸；renderer 無 Node 特權（contextIsolation/sandbox/窄 preload）；檔案系統/程序操作限制在授權根目錄；憑證僅以不透明的 OS 保護參照存在；RED 操作需明確人工閘門。
- **R2 正規工程迴圈**：狀態機持久且有界（非無限對話）；Planner/Builder/Reviewer 透過 Provider Router 解析角色；Builder 透過任務級 worktree 隔離；會變更狀態的任務需要確定性驗證證據；有界重試/rework 預算；crash/restart 復原不得擴權；高風險交付需 CI 後人工核准。
- **R3 供應商獨立/本地模型**：每個角色可明確選擇供應商；多供應商不需改 schema；本地供應商僅能從受信任設定啟動；Ollama 需明確選模型；換供應商不得暗中改變權限；選用供應商失敗不得拖垮 Safe Bridge；Provider 與 Worker 身分分離；OFFICIAL/PEGA 各自獨立 CODEX_HOME/auth/env；PEGA 需經 Provider Router 抽象，真實相容性需 ENVIRONMENT 證據。
- **R4 Git/GitHub/多倉庫**：多倉庫任務路由；持久鎖/lease；受管分支/PR + CI 關聯；已驗證/防重放的 webhook + polling fallback；CI 失敗導向分類化有界 rework；合併需 CI 成功 + 人工核准；同倉庫並行任務使用不同 worktree。
- **R5 證據/可觀測性/復原**：狀態/事件/證據可跨重啟存活；證據有雜湊/清單；Dashboard/遠端僅為投影；維運處理過期鎖/TTL/保留/孤兒清理；漂移掃描只診斷、不得默默改動。
- **R6 本地 MCP/遠端監督**：預設僅 loopback 且需驗證；能力範圍受限、唯讀、無 raw shell；短效一次性配對碼；配對不授予寫入/執行/合併/憑證/系統權限；非 loopback 需驗證加密傳輸，預設無公開對外埠。
- **R7 Windows 發行**：CI 建置 x64/ARM64 + 自動偵測；發布前需安裝/解除安裝 smoke test；SHA-256 完整性；未取得真實 owner 證據前不得宣稱正式簽章/Store 完成；不需 OpenAI API key 也能使用。
- **R8 UX/人類主導權**：明確選擇 Workspace，不得任意掃描磁碟；新手/工程模式共用同一狀態；剪貼簿僅在明確操作時寫入；Goal/Done/狀態/風險/證據/核准需可見；使用者暫停/取消/緊急停止具最高權威；Dashboard 顯示 canonical 欄位或 UNKNOWN。

## 2. 交付階段驗收閘門（P0–P7，摘自 [`08_ROADMAP_ACCEPTANCE.md`](../Blueprint/08_ROADMAP_ACCEPTANCE.md)）

| 階段 | 驗收閘門重點 |
|---|---|
| P0 產品基礎 | 無特權 renderer；無特權 ChatGPT preload；無需 API key 即可啟動 |
| P1 Safe Bridge MVP | 無背景剪貼簿輪詢；無效 Command Card 給出可行動錯誤；無爬取/注入/攔截 |
| P2 本地工程執行 | cwd 超出 Workspace 一律拒絕；危險操作阻擋/需核准；write 任務需驗證 |
| P3 多倉庫控制平面 | 防止衝突寫入；不得默默覆蓋 dirty 的 main checkout |
| P4 供應商/工具可擴充 | 停用所有選用供應商時 Safe Bridge 仍可用；換供應商不暗改安全政策 |
| P4.5 執行模式解析 | 不可用模式不得顯示為 ready；本地 worker 偵測需真實；模式切換不暗改權限；Full MCP 需 e2e 健康檢查後才可寫入；Local Autonomous 的限制在模型之外強制執行 |
| P4.6 有界自主執行 | 執行中 Workspace 不變；迭代僅在預算內；來源過期則阻擋 apply；無自動 commit/push/publish；CI 需在真實暫存 Git repo 上證明隔離+顯式 apply |
| P4.7 Harness Engineering 控制平面 | Goal→Plan→Task graph；無需人工複製貼上即可派工；Verifier 獨立判定完成；Reviewer 產出 PASS/REWORK/HUMAN_REQUIRED；佇列可派下一個合格任務；過期鎖可復原；有限預算；外部事件可關聯 |
| P5 桌面/工程轉接器 | 桌面轉接器能力受限；ChatGPT DOM 不被碰觸 |
| P6 遠端監督 | 預設無公開對外埠；遠端不得超出本地政策；遺失裝置/session 可撤銷 |
| P6.5 Store 私有發行 | 乾淨裝置可從 Store 取得；顯示 Microsoft 發行者信任；Store 取得不觸發 SmartScreen；不破壞 GitHub Preview 通道 |
| P7 穩定 1.0 | 受信任 Windows 發行；備份/遷移；升級/解除安裝測試；無障礙；在地化；依賴/授權/安全稽核；崩潰復原；文件齊全 |

## 3. 稽核方法論（沿用既有三軸模式，見 [`13`](../Blueprint/13_TRIPLE_AUDIT.md)/[`17`](../Blueprint/17_V0_2_TRIPLE_AUDIT.md)/[`19`](../Blueprint/19_V0_3_TRIPLE_AUDIT.md)）

任何重大版本/範圍的驗收，沿用三軸稽核：

- **Audit A — 需求/Blueprint 覆蓋度**：逐條需求 vs 證據 vs PASS/DEFERRED。
- **Audit B — 安全與架構符合度**：逐項控制 vs 實際程式碼/測試的 PASS/FAIL 檢查表。
- **Audit C — 新使用者/發布/建置可操作性**：附真實 CI run ID、job 結果、artifact 名稱/大小、文件完整性檢查。

每筆發現需標註處置狀態（已解決 / 已接受的設計限制 / 已揭露限制），並在文末給出明確的「合併/發布決定」，且必須明確標註本次稽核範圍版本，**不得**推論到更高層級（例如不可從 v0.3 稽核推論「全自主 1.0」已完成）。

## 4. 驗收判定守則（Claude Code Reviewer 必須遵守）

1. 未附 CI run 編號或測試檔名的「完成」宣稱一律視為未驗證。
2. `ENVIRONMENT` / `OWNER-EXTERNAL` 等級項目，只有實機/擁有者本人提供的真實紀錄可以結案，Claude Code 不得代為結案。
3. 任何宣稱與 [`Blueprint/23_IMPLEMENTATION_STATUS.md`](../Blueprint/23_IMPLEMENTATION_STATUS.md) 或 [`STATUS.md`](STATUS.md) 矛盾時，先更新這兩份文件再繼續其他工作。
4. 驗收永遠針對「明確範圍版本」，不得把某個小改動的通過膨脹成整個階段/整個產品完成。

## 5. ENVIRONMENT / OWNER 項目的驗收協定（2026-09-24 新增）

適用於 [STATUS.md](STATUS.md) 的環境閘門。通則：證據須含 **exact-source 40 碼 SHA、日期、機器與 `process.arch`、操作者聲明**；只傳雜湊/狀態/截圖，不含憑證、prompt、response 內容。Codex 不得自行結案，由 Claude Code 對照 repo SHA 審核後才可改 STATUS。無 workflow provenance（`provider-environment.yml` 尚未在 `main`）時，以本機腳本產出的 JSON 為證據，須標明「非 workflow PASS」，等級仍為 ENVIRONMENT。

| 項目 | 必備證據 | 判定 PASS 條件 |
|---|---|---|
| 實體 ARM64 UI smoke | 該 SHA 的 arm64 Packaging artifact 之 SHA-256 與 checksum 相符；`node -p process.arch` = `arm64`；截圖/操作者勾選：安裝、啟動、Dashboard 顯示八問視圖、選 Workspace、以 `inspect-workspace` Command Card 跑一次、STOP ALL 有效、解除安裝乾淨 | 清單全數勾選且無崩潰；任一失敗即 FAIL |
| 使用者筆電 CLI / verifier 安全 | 在一次性測試 repo 跑 Local Autonomous：run 證據 manifest、verified patch diff、verifier 輸出；操作者書面確認已審閱專案 verifier 腳本無對外網路、無 worktree 外寫入、無刪除 | patch 僅出現在 worktree；Apply 前 source 不變；verifier 決定 pass/fail；審閱聲明齊全 |
| Official Full MCP | 需真實 ChatGPT Business/Enterprise/Edu workspace：tunnel/connector 健康紀錄；讀取工具呼叫的 event id；寫入工具**未核准被拒**與**核准後成功**各一筆 event id；斷線後回退 Safe Bridge 的紀錄 | 四項證據皆對應事件帳本 id；缺任一項不得標 Ready（見 Blueprint 16 §7） |
| PEGA/OFFICIAL 故障隔離 | 兩次 run：(a) 讓 PEGA 失敗（僅在該次程序環境注入無效 key，不動已存 auth）→ OFFICIAL 仍 PASS；(b) 讓 OFFICIAL 失敗 → PEGA 仍 PASS；期間 Safe Bridge 可用；恢復後兩者 READY。附 evidence JSON，含每側 `registryState`（失敗方 FAILED/UNKNOWN、健康方 IDLE，來自既有 Worker Registry 狀態模型）與 Provider `health`（失敗方非 READY 或 run FAIL、健康方 READY 且 PASS）；Safe Bridge 若無法在無 Electron 下自動檢查，由操作者以擁有者範本補證 | 失敗不外溢；階段 (b) 前後真實 OFFICIAL home 的 auth 檔摘要不變、PEGA home 無 auth 檔；`codexHomeSha256` 僅為路徑雜湊，不作內容保護證據；無靜默 fallback；細則見 [施工單 0002 決策紀錄 D1](WORK_ORDERS/0002.md)。Safe Bridge 部分以 `safe-bridge-during-fault` 範本補證。 |

## 6. 人工／視覺驗收協定（2026-09-25 新增）

適用於追溯矩陣（`.ai/TRACEABILITY.json`）中所有 `MANUAL` 條目：這些條文無法用單元測試證明，必須在**已安裝的 AECP** 上由人操作與觀察。結果一律記錄為 `samples/owner-evidence/manual-ui-acceptance.template.json` 的填妥版本，再用下列指令驗證（未填的範本、佔位符殘留、任一勾選為 false、SHA 不符、含機密樣式皆判 FAIL）：

```bash
node scripts/verify-owner-evidence.cjs <填妥的記錄.json> --expect-sha <被驗收版本的40碼SHA>
```

通則：證據等級為 ENVIRONMENT；須附安裝檔 `fileName` + `sha256`（必須是該 SHA 的 Packaging artifact）、截圖的 `fileName` + `sha256`、機器代號與 `arch`、操作者聲明。截圖不得含憑證、帳號或私人內容。Codex 不得代為填寫或結案，只有 Claude Code 對照 SHA 審核後才可改 STATUS。

### 6.1 視覺、對比與縮放

對應勾選項：`contrastLightTheme45`、`contrastDarkTheme45`、`statusNotColorOnly`、`scaling125`、`scaling150`、`scaling200`、`layout1366x768`、`layout1920x1080`、`brandProminence`。

1. **對比 4.5:1（Blueprint/01 §10）：** 在淺色與深色主題各取一次，對主控台、新手八問、Harness 六視圖的一般文字與狀態文字，用瀏覽器開發者工具（或同等對比量測工具）量測前景／背景對比；一般文字須 ≥ 4.5:1。記錄最低值與位置。
2. **狀態不得只靠顏色：** 對每個狀態呈現（通過／失敗／待核准／UNKNOWN／BLOCKED／HUMAN_REQUIRED）把畫面轉為灰階（或使用系統色彩濾鏡）後，仍可由文字或圖示分辨。
3. **縮放：** Windows 顯示縮放設定為 125%、150%、200% 各一次，主控台與 Harness 分頁無文字被截斷、無控制項被遮住、頁面無橫向捲動（表格／程式碼區塊的內部捲動除外）。
4. **版面：** 1366×768 與 1920×1080 各一次，三面板可用，關鍵控制（STOP ALL、核准、暫停）不需捲動即可到達。
5. **品牌主次（Blueprint/01）：** AECP 自身的名稱與識別比供應商（含 ChatGPT）識別更醒目；由擁有者判斷並在備註寫明依據。

通過條件：以上每項皆有截圖與備註，且實測值符合上列門檻；任一失敗即整份記錄 FAIL。

### 6.2 輔助技術

對應勾選項：`screenReaderSixViews`。

使用 Windows 朗讀程式（Narrator）或 NVDA，以鍵盤操作，逐一朗讀 Harness 分頁的六個新視圖（執行時間軸、差異檢視、審查檢視、GitHub 檢視、通知、任務進度）與核准控制，確認：標題有被朗讀、狀態以文字（非僅顏色）朗讀、`UNKNOWN` 被明確朗讀、焦點順序合理且焦點可見。備註寫明所用朗讀程式與版本，並附操作錄影或逐項記錄。

### 6.3 Electron 實機流程

對應勾選項：`officialBrowserExternalized`、`harnessSixViewsWithData`、`harnessSixViewsUnknown`、`stopAllWorks`。

1. **官方瀏覽器外部化：** 開啟官方 ChatGPT 後，它在系統瀏覽器（而非 AECP 內嵌）開啟，AECP 右側窗格仍可使用（Blueprint/01）。
2. **六視圖有資料：** 建立一個小型 Mission，使 Harness 分頁六個視圖出現真實資料，並確認顯示值與 GitHub／事件帳本一致。
3. **六視圖缺資料：** 全新狀態（無 Mission）下六個視圖皆顯示 `UNKNOWN`，不顯示假的 0% 或 100%。
4. **STOP ALL：** 執行中觸發 STOP ALL，所有進行中任務停止且狀態一致。

### 6.4 新手首用與產品感

對應勾選項：`productCohesion`。

找一位未參與開發的人，在只看到「新手」模式的前提下，5 分鐘內回答：現在控制的是哪個專案？正在做什麼？需要我嗎？下一步是什麼？（對應 Blueprint/22 §16 八問）。記錄該人的回答與卡住之處；若大多數問題無法回答，視為 FAIL。此項本質上是主觀判斷，備註必須包含觀察者與受測者的具體描述，不得只寫「通過」。
