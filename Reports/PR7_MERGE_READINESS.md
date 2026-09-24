# PR #7 合併就緒檢查（非合併授權）

**資料截點：** 2026-09-24 08:22 UTC，分支 `feat/control-plane-complete-loop`，PR [#7](https://github.com/Space653000/0_JN1_AIECP/pull/7)。本報告的 exact-source HEAD 是 `119a77c4190cf3307935f2af0db6786b1d98e2f6`；本文件及後續施工若再提交，必須重新核對新的 HEAD，不得將本截點的 CI 結果沿用。

## 指令實測的範圍

- `git rev-parse origin/main` → `74e1ecada2bff4ee07fb666d8e0b5aa02bbc17f6`。
- `git rev-list --count origin/main..HEAD` → **775 commits**；`git diff --name-only origin/main...HEAD | Measure-Object -Line` → **151 個變更檔案**。這是相對 `main` 的整個 PR 累積差異，不是施工單 0003 的改動數。
- `git status --short --branch` → 乾淨；`git rev-parse HEAD` 與 `git rev-parse origin/feat/control-plane-complete-loop` 在資料截點均為上述 `119a77c…`。PR API 回報 `state=OPEN`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`；後者不得解讀為已達人工合併條件。
- 本機 `npm run verify` **PASS**，`npm test` **278/278 PASS**；涵蓋 `check`、測試、license、requirements、blueprints、roadmap、acceptance 稽核。這是本機 TESTED，不替代 exact-SHA CI 或真實環境證據。

## 四組 exact-SHA workflow（本截點）

| Workflow | Run | 本截點實際狀態 |
|---|---|---|
| AECP Security | [#35974675389](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35974675389) | SUCCESS |
| AECP CI | [#35974675411](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35974675411) | SUCCESS |
| CI / Packaging | [#35974675400](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35974675400) | QUEUED — CI 待驗證 |
| Build and Release | [#35974675434](https://github.com/Space653000/0_JN1_AIECP/actions/runs/35974675434) | IN_PROGRESS — CI 待驗證 |

上述 run 均經 `gh run list --branch feat/control-plane-complete-loop --json headSha,...` 核對為本截點 SHA。**目前不得宣稱四組 CI 全綠**；若任何 run 失敗，先修正與重跑新 exact HEAD。

## `main` 尚缺的 workflow

`git diff --name-status origin/main...HEAD -- .github/workflows` 實測下列檔案為 `A`（PR 帶入、`main` 尚無）：

| Workflow 檔案 | 用途／派發影響 |
|---|---|
| `.github/workflows/aecp-ci.yml` | AECP CI |
| `.github/workflows/aecp-security.yml` | AECP Security |
| `.github/workflows/provider-environment.yml` | 自架 Windows 真實 provider 證據；**合併至預設分支後**才有可由 GitHub Actions 派發的入口，仍須 runner/帳號/模型 |
| `.github/workflows/signed-release.yml` | 擁有者授權的簽章發布 |
| `.github/workflows/store-package.yml` | 擁有者 Store 身分套件 |

同一指令顯示 `.github/workflows/ci.yml`、`.github/workflows/release.yml` 為 `M`（原本已在 `main`，由 PR 修改），不可誤列為缺失。

## 風險與人工合併前閘門

1. PR 累積差異達 775 commits／151 檔，合併前須由 Claude Code 審閱最終 diff 與安全邊界；中間 commit 的 CI 不能借用最終 HEAD 結果。
2. 真實 OFFICIAL／PEGA、ARM64 provider、實體 ARM64 UI、筆電 verifier 安全、Full MCP、故障隔離及四類 OWNER-EXTERNAL 閘門仍未取得相應證據；合併程式碼不會讓它們自動完成。
3. `provider-environment.yml` 的 `X64`／`ARM64` 路由只是排程條件；自架 runner 標籤、真實架構與可用性須由擁有者確認。未提供 runner 時 workflow 可能持續排隊。
4. 此資料截點的 Packaging／Build and Release 未完成，且本報告提交後 HEAD 會改變；在最終提交上重新核對四組 workflow，並確認 PR 的 Review／branch protection 要求。
5. 若人工合併後發現回歸，先停止發布、保留 CI/artifact 證據；由擁有者評估對合併 commit 使用 `git revert -m 1 <merge-sha>` 建立可審查的回退提交。此處**僅描述**回退方式，不執行 revert、reset 或 force push。

## 合併後立即驗證清單

- 在 `main` 核對 merge SHA 與四組 workflow 的 exact-SHA PASS；重新跑 `npm run verify`，確認 `git status`、預設分支 workflow 可見。
- 在 GitHub Actions 確認 **AECP Real Provider Evidence** 可供授權操作者派發，但不在未配齊憑證、模型、runner 時執行或宣稱 PASS。
- 由擁有者按 [ENVIRONMENT 證據手冊](ENVIRONMENT_EVIDENCE_RUNBOOK.md) 與 `.ai/ACCEPTANCE.md` 第 5 節逐項產證；需擁有者身分的簽章、Store、網域與正式供應商宣稱仍保持待驗收。
- 保留 PR、CI、artifact 與人工 Review 記錄；若部署/發布另有閘門，按其獨立授權流程處理。

**合併為人工閘門，由 repo 擁有者執行。Codex 不合併 PR #7。**

## 合併後首次派發驗證

此小節只供**擁有者完成 PR #7 人工合併後**操作；目前不派發、不合併。`.github/workflows/provider-environment.yml` 的 `workflow_dispatch` 與 `runs-on: ${{ fromJSON(...) }}` 需在進入 `main` 後由 GitHub 首次派發，才能觀察實際解析與 runner 選擇。先確認 `main` 已包含該 workflow，並記錄合併後的 exact SHA。以下 PowerShell 範例只使用 workflow 現有的 `source_ref`、`mode`、`expected_arch` inputs：

```powershell
git fetch origin
$mainSha = (git rev-parse origin/main).Trim()
gh workflow run provider-environment.yml --repo Space653000/0_JN1_AIECP --ref main -f "source_ref=$mainSha" -f mode=local-command -f expected_arch=x64
gh run list --repo Space653000/0_JN1_AIECP --workflow provider-environment.yml --branch main --event workflow_dispatch --limit 10 --json databaseId,headSha,status,conclusion,url
gh run view <run-id> --repo Space653000/0_JN1_AIECP --json jobs,status,conclusion,url
```

若擁有者已配置 ARM64 自架 runner，可另外以同一指令派發 `expected_arch=arm64`，分別核對 `X64`、`ARM64` 路由；`any` 只要求基本標籤。範例故意選 `mode=local-command` **且不填 `local_command`**：現有 `Validate local verification prerequisites` 步驟會在檢查 Node 架構後因缺少固定指令而安全失敗，`Run real provider verification` 不會執行。這是預期的**負向排程測試**，不是 provider PASS、ENVIRONMENT 證據或 CI 全綠。不要為了使它通過而填入真實憑證或工作指令。

在 Actions 的該次 run/job 檢查：workflow 已受理、job 是否依預期標籤排入自架 Windows runner、實際 `node -p "process.arch"` 與 `expected_arch` 是否一致，並保留 run URL、run/job ID、狀態與錯誤訊息（遮蔽任何敏感資料）。若長時間排隊，先核對 runner 在線及 `self-hosted`、`Windows`、`aecp-provider`、`X64`／`ARM64` 標籤；若在 workflow 解析前失敗，回報 GitHub 顯示的解析錯誤與該次 `main` SHA；若到前置檢查因缺 `local_command` 失敗，則只記錄「排程/解析路徑已觀察到」，不宣稱真實 provider 驗收。任何意外進入 provider 執行、標籤錯配或架構錯配都應停止後續派發，將 exact run URL、job 狀態、預期/實際標籤與架構交回 Claude Code／擁有者決策；不得藉此放寬 runtime hard gate 或新增權限。
