# CLAUDE.md — AECP 專案入口指示

本檔案是 Claude Code 在 `0_JN1_AIECP`（AI Engineering Control Plane, AECP）這個專案中的**入口點**。它會被 Claude Code 自動載入。

## 開始任何工作之前，必須先讀這四份文件（依序）

1. [`.ai/BLUEPRINT.md`](.ai/BLUEPRINT.md) — 唯一藍圖依據：這個專案應該長成什麼樣子、產品不可退讓原則、系統架構、永久邊界。索引並引用 `Blueprint/` 目錄下全部原始文件（00–24 號 + REQUIREMENTS/INDEX/Conversation），不取代它們。
2. [`.ai/ACCEPTANCE.md`](.ai/ACCEPTANCE.md) — 驗收標準：怎樣才算做完，證據等級規則（STATIC/TESTED/CI/ENVIRONMENT/OWNER-EXTERNAL），R1–R8 需求檢查表，P0–P7 階段閘門。
3. [`.ai/STATUS.md`](.ai/STATUS.md) — 現況進度：已完成/施工中/未完成/被卡住的項目，以及誰能解除每個阻塞。**這份文件會隨時間改變，每次重大變更後都要更新它。**
4. [`.ai/CLAUDE_REVIEWER.md`](.ai/CLAUDE_REVIEWER.md) — Claude Code 在本專案的角色：Research → Plan → Review → Accept 的具體工作方式與檢查清單。

沒有讀過這四份文件、或它們與目前的請求明顯不一致時，先重新讀取最新版本，不要依賴對話記憶中的舊摘要——這四份文件本身也可能被更新過。

## 這四份文件與 `Blueprint/` 原始目錄的關係

- `Blueprint/00`–`24` 號文件、`REQUIREMENTS.md`、`INDEX.md`、`Conversation/` 是**原始藍圖**，永遠不要刪除或覆寫其歷史內容。
- `.ai/BLUEPRINT.md` 是它們的索引與整理層；新的產品決策應該先落在對應編號的原始文件（或新增編號），再回頭更新 `.ai/BLUEPRINT.md` 的索引。
- `Blueprint/23_IMPLEMENTATION_STATUS.md` 是原始的現況快照文件；`.ai/STATUS.md` 是給 Claude Code 快速查閱用的整併版本，兩者應保持一致，發現不一致時以最新事實（`git log`、`gh pr view`、GitHub Actions 結果）為準並同步修正兩份文件。

## 基本工作原則（承接使用者全域設定，此處只列本專案特有的重點）

- 一律使用繁體中文回覆；程式碼、指令、技術名詞保留英文。
- 複雜或破壞性任務先規劃、先徵求同意，才動手。
- 任何「已完成」的宣稱都必須附上證據等級（見 `.ai/ACCEPTANCE.md` 第 0 節）；不得把 STATIC/TESTED 包裝成 CI 或 ENVIRONMENT 等級。
- ENVIRONMENT 與 OWNER-EXTERNAL 等級的項目，Claude Code 沒有權限單方面標記為完成。
- GitHub 是工程真理來源，Harness 執行期狀態是任務真理來源，Dashboard 永遠只是投影——三者不可混淆（詳見 `.ai/BLUEPRINT.md` 第 2 節）。

## 快速定位

- 想知道「產品該長怎樣」→ `.ai/BLUEPRINT.md`
- 想知道「怎樣算做完」→ `.ai/ACCEPTANCE.md`
- 想知道「現在做到哪、卡在哪」→ `.ai/STATUS.md`
- 想知道「我（Claude Code）該怎麼做事」→ `.ai/CLAUDE_REVIEWER.md`
