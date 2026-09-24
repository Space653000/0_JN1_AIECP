# AECP 真實環境證據操作手冊

**施工單：** [0001](../.ai/WORK_ORDERS/0001.md) · **日期：** 2026-09-24 · **狀態：** 操作手冊，未執行下列環境驗收

本手冊對應 [`.ai/STATUS.md`](../.ai/STATUS.md) 的十個 ENVIRONMENT 待辦。依據為 [provider-environment.yml](../.github/workflows/provider-environment.yml)、[provider-environment-verify.cjs](../scripts/provider-environment-verify.cjs)、[Blueprint 24](../Blueprint/24_LOCAL_MODEL_PROVIDER_VERIFICATION.md)、[Blueprint 03](../Blueprint/03_PROVIDER_ROUTER.md)、[CodexWorkerRuntime](../electron/lib/codex-worker-runtime.cjs) 與 [PEGA adapter](../electron/lib/pega-provider.cjs)。每次驗收只接受實際目標機器、帳號與供應商的結果；程式碼、mock、舊 artifact 或本手冊本身都不是 ENVIRONMENT PASS。

## 共通執行與回報規則

1. 擁有者在目標 Windows 機器準備與欲驗證的 `source_ref` 相同的**完整 40 碼 commit** checkout；用 `git rev-parse HEAD` 確認 SHA，`node -p "process.arch"` 確認 `x64` 或 `arm64`。操作 repo 擁有者或獲授權的 runner；模型、帳號、憑證由擁有者提供。任何憑證只透過 GitHub Actions secret、程序環境變數或 AECP 的 `credentialRef` 傳入，不寫入 Git、README、artifact 或回報。
2. 現有 workflow 名稱是 **AECP Real Provider Evidence**，檔案為 `.github/workflows/provider-environment.yml`；基本 runner 標籤為 `[self-hosted, Windows, aecp-provider]`，`expected_arch: x64` 時另要求 `X64`，`arm64` 時另要求 `ARM64`，`any` 時只用基本標籤。runner 指派使用 GitHub Actions 支援的 `runs-on`/`fromJSON` 表達式，執行期的 `process.arch` hard gate 仍保留。擁有者須實際配置相應標籤；標籤與架構不符仍會被 hard gate 拒絕。`workflow_dispatch` inputs 為 `source_ref`、`mode`、`model`、`local_command`、`local_args_json`、`official_model`、`pega_model`、`pega_wire_api`、`codex_worker_root`、`expected_arch`。其中 `mode` 可選 `ollama`、`opencode-ollama`、`canonical-local`、`local-command`、`codex-official`、`codex-pega`、`multi-codex`、`codex-fault-isolation`、`all`；`expected_arch` 可選 `any`、`x64`、`arm64`。PEGA credential 由 Actions secret `AECP_PEGA_API_KEY` 提供。
3. **目前派發缺口：** 2026-09-24 在本 repo 查詢 `gh workflow list --all` 未列出此 workflow；`gh run list --workflow provider-environment.yml` 回 404。原因是 workflow 目前只在 PR #7 施工分支，尚未在預設 `main` 提供可派發的 workflow。不得為產證而擅自 merge PR #7。待 workflow 可派發後，擁有者在 GitHub Actions 的 **AECP Real Provider Evidence → Run workflow** 輸入上述欄位；目前可在目標機器的對應 commit checkout，以相同底層 script 手動執行。
4. **目前的本機執行模板（PowerShell）：** 在目標 checkout 中設定下表相應的環境變數後執行 `node scripts/provider-environment-verify.cjs`。script 的模式由 `AECP_PROVIDER_VERIFY_MODE` 指定，架構由 `AECP_PROVIDER_VERIFY_EXPECTED_ARCH` 指定，輸出路徑由 `AECP_PROVIDER_EVIDENCE_PATH` 指定；未設定輸出路徑時寫入被 Git 忽略的 `artifacts/provider-environment-evidence.json`。使用者須自行以受保護的環境方式設定 `AECP_PEGA_API_KEY`，不可把值貼進命令紀錄。所有操作在授權的測試 checkout／暫存 worktree 進行。

   ```powershell
   git rev-parse HEAD
   node -p "process.arch"
   $env:AECP_PROVIDER_VERIFY_MODE = '<下節指定的 mode>'
   $env:AECP_PROVIDER_VERIFY_EXPECTED_ARCH = 'any'
   node scripts/provider-environment-verify.cjs
   ```

5. workflow 通過時上傳 artifact `aecp-real-provider-<mode>-<github.run_id>`，其中檔案是 `artifacts/provider-environment-evidence.json`，保留 30 天。JSON 必須含 `schema: aecp.provider-environment-evidence/v1`、`sourceCommit`、`mode`、`platform`、`arch`、`expectedArch`、`checks[]`、`summary`、`privacy`；成功項目的 `status` 為 `PASS`，`summary.failed` 為 `0`。workflow 額外核對 checked-out SHA、架構及三個 privacy 布林值均為 false。手動執行須由操作者同樣核對，不得把本機 JSON 說成 GitHub workflow PASS。
6. 回報 Claude Code 前，先在不修改證據檔的環境執行 `node scripts/verify-evidence-bundle.cjs artifacts/provider-environment-evidence.json --expect-sha <40 碼 SHA> --expect-mode <mode> --expect-arch <any|x64|arm64>`；一個命令可列多個 JSON 路徑，任一 FAIL 會 exit 1。沒有 `workflowRun` 時輸出 `PROVENANCE: LOCAL_SCRIPT（非 workflow PASS）`；僅在 `GITHUB_ACTIONS=true` 時腳本寫入五個非機密 GitHub 識別欄位，有合法 `workflowRun` 時輸出 `PROVENANCE: WORKFLOW_CLAIMED`，**不是已核實的 workflow PASS**。驗證器會印出可複製的 `gh run view <runId> --repo <repository> --json headSha,conclusion,workflowName`；操作者／Claude 必須另行核對 `headSha` 等於 evidence `sourceCommit`、`conclusion` 為 `success`，並確認 workflow 身分。驗證器本身不聯網；`workflowRun.sha` 與 `sourceCommit` 矛盾會 FAIL。提供 exact-source SHA、執行日期、機器/架構、mode、model 名稱、workflow run URL/ID（若有）、artifact 名稱、驗證器結果與 JSON 的 `summary`、相關 `checks[].id/status` 及下節指定的非敏感欄位。只傳雜湊、狀態與驗證結果，不傳 credential、prompt 或 response body。Claude Code 依 [ACCEPTANCE](../.ai/ACCEPTANCE.md) 第 0 節審核，並確認證據與擬結案項目完全對應；本機驗證器 PASS 不是 ENVIRONMENT 結案。

## 1. 真實 Codex OFFICIAL 執行

- **前置條件：** 擁有者提供真實可用的 Codex OFFICIAL 帳號、Windows `aecp-provider` runner／目標機器及 Codex CLI。`codex_worker_root`（本機對應 `AECP_PROVIDER_VERIFY_CODEX_ROOT`）須是持久、受保護的目錄；`codex-official/codex-home` 必須已有隔離登入的 `auth.json` 或 `credentials.json`。AECP 的 `loginOfficialCodexWorker()` 實際以該 `CODEX_HOME` 執行 `codex login`；操作者可使用該顯式登入入口，或在受信任互動終端先設定 `$env:CODEX_HOME = Join-Path $env:AECP_PROVIDER_VERIFY_CODEX_ROOT 'codex-official\codex-home'`，再執行 `codex login`。帳號檔不得複製到 PEGA home。
- **操作：** workflow 設 `mode: codex-official`、`source_ref: <40 碼 SHA>`、`expected_arch: x64` 或 `arm64`、必要時 `official_model` 與 `codex_worker_root`。手動模式設 `AECP_PROVIDER_VERIFY_MODE=codex-official`、`AECP_PROVIDER_VERIFY_EXPECTED_ARCH`、`AECP_PROVIDER_VERIFY_CODEX_ROOT`，選用 `AECP_PROVIDER_VERIFY_OFFICIAL_MODEL`，再執行共通模板的 `node` 指令。script 會先 `prepareOfficial()` 與 `inspect()`，再呼叫真實 CLI。
- **成功證據：** `codex-official.real-smoke: PASS`；該 check 含 `workerId=codex-official`、`provider`、`model`、`health=READY`、`codexHomeSha256`、`fileVerifier: {path,sha256,expectedSha256Match:true}`、`timedOut=false`、`aborted=false`；全域 `arch`/`sourceCommit` 相符。Worker 在隔離暫存 Git worktree 寫入 `worker_result.txt`，script 獨立讀檔比對，JSON 不含檔案內容。
- **回報：** 共通欄位加上該 check 的 worker 身分、model、health、home hash、`fileVerifier`、超時／取消旗標。檔案 verifier 的倉庫施工已補；真實供應商執行仍待 ENVIRONMENT 證據。

## 2. 真實 Codex PEGA 執行

- **前置條件：** 擁有者提供 `https://aiapi.t-cyber.com/v1` 的真實帳號、模型名稱與 `AECP_PEGA_API_KEY`（Actions secret 或受保護的程序環境），以及 Codex CLI/Windows 目標機器。PEGA 的 `CODEX_HOME` 由 `codex_worker_root/codex-pega/codex-home` 建立；`prepareCustom()` 只把 `env_key` 名稱寫入 config，秘密值只進程序環境。
- **操作：** workflow 設 `mode: codex-pega`、`source_ref`、`pega_model`、`pega_wire_api: responses` **或** `chat`、`codex_worker_root`、`expected_arch`，並在 repository/environment secret 設 `AECP_PEGA_API_KEY`。手動模式設 `AECP_PROVIDER_VERIFY_MODE=codex-pega`、`AECP_PROVIDER_VERIFY_PEGA_MODEL`、`AECP_PROVIDER_VERIFY_PEGA_WIRE_API`、`AECP_PROVIDER_VERIFY_CODEX_ROOT`、`AECP_PROVIDER_VERIFY_EXPECTED_ARCH`，由受保護環境注入 `AECP_PEGA_API_KEY` 後執行共通 `node` 指令。若兩種 wire API 都聲稱支援，分別執行並保存兩份 run；不支援者保留 FAIL／能力不足結果。
- **成功證據：** `codex-pega.real-smoke: PASS`；含 `workerId=codex-pega`、實際 `model`、`health=READY`、`codexHomeSha256`、`baseUrlSha256`、`wireApi`、`fileVerifier: {path,sha256,expectedSha256Match:true}`、`timedOut=false`、`aborted=false`，另核對 `sourceCommit`、`arch`、`privacy`。Worker 在隔離暫存 Git worktree 寫檔，由 script 獨立讀回驗證。
- **回報：** 共通欄位加上 PEGA worker/model/wire API、health、home/base URL hash、`fileVerifier`。**缺口：** 對不支援 wire API 的細分錯誤僅記錄安全的 error code，沒有完整 capability negotiation 報告。

## 3. 真實 OFFICIAL + PEGA 並行執行

- **前置條件：** 第 1、2 節的真實帳號、模型、PEGA secret 及隔離 OFFICIAL 登入均已就緒；同一台 Windows runner 可同時啟動兩個 Codex 程序。兩個 home 不得共用。
- **操作：** workflow 設 `mode: multi-codex`、`source_ref`、`pega_model`、`pega_wire_api`、選用 `official_model`、`codex_worker_root`、`expected_arch`；手動模式設對應 `AECP_PROVIDER_VERIFY_MODE=multi-codex`、`AECP_PROVIDER_VERIFY_PEGA_MODEL`、`AECP_PROVIDER_VERIFY_PEGA_WIRE_API`、`AECP_PROVIDER_VERIFY_CODEX_ROOT`、`AECP_PROVIDER_VERIFY_EXPECTED_ARCH`，並由環境注入 `AECP_PEGA_API_KEY`，執行共通 `node` 指令。script 會在暫存 Git repo 建兩個 worktree，透過 `Promise.all` 執行兩個真實 file edit，再讀回 `worker_result.txt` 驗證。
- **成功證據：** `codex.multi-worker-real-concurrency: PASS`；`workers[]` 各有 `workerId`、provider、model、`health=READY`、`codexHomeSha256`、`worktreeSha256`、`fileSha256`；`distinctCodexHomes`、`distinctWorktrees`、`distinctProcesses` 皆 true，另有 `spawnDeltaMs`、`durationMs`、`pegaWireApi`、source/arch。check PASS 已代表兩份檔案 token 通過 script 的確定性讀回比對；JSON 不保存 PID 或 token 內容。
- **回報：** 共通欄位加上兩名 Worker 的身份／model／health／home、worktree、file hash，三個 `distinct*` 布林值及 `spawnDeltaMs`。**缺口：** 此 fixture 記錄並行啟動與不同 PID，但沒有完整執行時間重疊區間的逐事件 trace。

## 4. 目標 Windows x64／ARM64 真實 provider 重跑

- **前置條件：** 擁有者提供相應架構的實體或受控 Windows runner、各模式真實帳號／模型。ARM64 驗收必須在 `node -p "process.arch"` 回 `arm64` 的目標上執行；一般 Windows x64 runner 的包裝 CI 不足以證明 ARM64 provider runtime。
- **操作：** 對第 1–3 節的 `codex-official`、`codex-pega`、`multi-codex` 逐一設 `expected_arch: arm64`（x64 目標設 `x64`），`source_ref` 用同一 exact SHA。手動模式設 `AECP_PROVIDER_VERIFY_EXPECTED_ARCH=arm64`，每個 mode 各執行共通 `node` 指令；先記錄 `node -p "process.arch"`。workflow 的 prerequisite 與 artifact provenance 會拒絕架構不符。
- **成功證據：** 每個 mode 的 JSON 均有 `platform=win32`、`arch=arm64`、`expectedArch=arm64`、相同 `sourceCommit`、`summary.failed=0` 及各自 PASS checks。回報 Claude Code 三個獨立 run/artifact 與 SHA。
- **缺口：** workflow 已按 `expected_arch` 路由 `X64`／`ARM64` 額外標籤，但擁有者仍須實際提供並標記目標架構 runner；本倉庫程式碼不能證明該 runner 已上線或真實 provider 已在其上執行。`expected_arch` 的執行期拒錯 gate 仍保留。

## 5. 本地 Ollama smoke 與 canonical Harness E2E

- **前置條件：** 擁有者在目標 Windows 機器安裝 Ollama、實際模型檔與 OpenCode（canonical Harness 需要）；模型名稱由擁有者提供，不假設下載或可用。這些模式不需要 PEGA credential。
- **操作：** 先用 workflow `mode: ollama`、`model: <已安裝模型>`、`source_ref`、`expected_arch`，再用 `mode: canonical-local` 搭配同一 `model`。手動模式先設 `AECP_PROVIDER_VERIFY_MODE=ollama`、`AECP_PROVIDER_VERIFY_MODEL=<模型>`、`AECP_PROVIDER_VERIFY_EXPECTED_ARCH` 執行共通 `node` 指令；保存 artifact 後改為 `canonical-local` 再執行。script 以 `ollama/<model>` 路由 OpenCode，Harness fixture 執行 Planner → Builder → Verify → Reviewer。
- **成功證據：** Ollama run 的 `ollama.health`、`ollama.real-smoke` 均 PASS，含模型及 `outputSha256`；canonical run 的 `canonical-harness.ollama-opencode: PASS` 含 `providers`、`models`、`state=DONE`、每個 `taskStates[].verificationPassed=true`、`reviewResult`、`patchSha256`、`eventCount`。兩份 JSON 均需匹配 source/arch/privacy。
- **回報：** 兩個 mode 的 run/JSON、實際模型、health、Harness task verifier/review 結果與 patch hash。**缺口：** Ollama 單獨 smoke 只有輸出 token hash；完整檔案驗證來自 canonical Harness run。

## 6. 真實 OpenCode+Ollama 編輯與固定 local/company 指令

- **前置條件：** OpenCode、Ollama 與本地模型在目標機器可用；若測 local/company Worker，擁有者須先確認固定、受信任的可執行檔路徑與其參數。`local_command` 由操作者提供，不從任務文字選取。
- **操作：** workflow 分別以 `mode: opencode-ollama`、`model: <已安裝模型>` 及 `mode: local-command`、`local_command: <固定路徑>`、`local_args_json: <字串 JSON 陣列，預設 []>`，皆帶 `source_ref`、`expected_arch`。手動分別設 `AECP_PROVIDER_VERIFY_MODE=opencode-ollama`、`AECP_PROVIDER_VERIFY_MODEL`；或 `AECP_PROVIDER_VERIFY_MODE=local-command`、`AECP_PROVIDER_VERIFY_LOCAL_COMMAND`、`AECP_PROVIDER_VERIFY_LOCAL_ARGS_JSON`，再執行共通 `node` 指令。這兩類可在不同機器／run 驗證，無需用 `all` 強迫全部前置條件同時成立。
- **成功證據：** OpenCode 的 `opencode.health`、`opencode.ollama-real-edit` PASS，後者含 `fileSha256`（script 讀回 `provider_verify.txt` 比對 token）；local command 的 `local-command.health`、`local-command.real-smoke` PASS，含 `resolvedCommandSha256`、`fileVerifier: {path,sha256,expectedSha256Match:true}`。local Worker 在隔離暫存 Git worktree 寫入 `worker_result.txt`，script 獨立讀回驗證。全域 source/arch/privacy 相符。
- **回報：** 各 mode 的獨立 run 與 JSON、模型／固定命令的非敏感身分、health、file hash。**缺口：** 固定 local/company Worker 必須能依任務提示寫檔；只會回傳文字的命令不再能通過此 mode，其其他能力仍需另行定義驗收。

## 7. 實體 Windows-on-ARM64 啟動／UI smoke

- **前置條件：** 擁有者提供實體 Windows ARM64 裝置、欲測安裝包及使用者操作權限；正式簽章與 Store 身分仍是獨立 OWNER/EXTERNAL gate。
- **操作：** 目前 `.github/workflows/provider-environment.yml` 只測 provider script；`CI`/`Build and Release` workflow 的安裝 smoke 是 CI runner，不是人手操作的實體裝置。擁有者可在實體裝置核對 `node -p "process.arch"` 與來源／安裝包 SHA，但現有 repo **沒有**對實體裝置啟動及 UI 操作產生標準化證據的 script/workflow。
- **證據與回報：** **缺口**。需 Claude Code／擁有者先定義裝置識別、安裝包 provenance、啟動畫面、Workspace 選擇、Safe Bridge、UI 操作與測試紀錄格式；在該證據實際產生並審查前，此項維持未完成。

## 8. 使用者筆電的 CLI、實際修改與 verifier 安全

- **前置條件：** 擁有者提供指定筆電與授權的隔離測試工作區、OpenCode/Codex CLI、所需本地模型／官方帳號。不得在使用者真實工作樹上用臨時 smoke 任務直接修改檔案。
- **操作：** 在該筆電執行 `opencode --version`、`codex --version`、`npm run verify`；要驗證實際修改，可在同一筆電、相同 exact source checkout 執行第 3 節 `multi-codex` 或第 6 節 `opencode-ollama` fixture。這些 fixture 使用暫存 worktree/目錄並讀回檔案；其 JSON 可證明該機器上的實際檔案修改。不可把別台 self-hosted runner 的成功歸到使用者筆電。
- **證據與回報：** source SHA、筆電架構、CLI version、fixture run/JSON 的 `fileSha256`／`verificationPassed` 等欄位。**缺口：** 現有 script 不產出「人類已檢查 verifier/測試腳本安全」的審查紀錄，也沒有可靠的設備識別欄位；需擁有者與 Claude Code 另行審查並簽署。

## 9. Secure MCP Tunnel 與 Official Full MCP 端到端驗收

- **前置條件：** 擁有者提供實際受支援的 ChatGPT workspace、tunnel/connector 身分與 credential；憑證只能在受保護設定或程序環境。Blueprint 16 的驗收包含 connector/tunnel 健康、read tool、政策閘門 write tool、同任務結果回傳、斷線 fallback。
- **操作：** 本 repo 的 [`electron/mcp-server.mjs`](../electron/mcp-server.mjs) 提供本機 loopback、bearer 驗證的唯讀 MCP 基礎；`provider-environment.yml` 沒有 `full-mcp` mode，也沒有 tunnel 佈建或上述 write/fallback E2E script。可先按現有 `npm test` 檢查本機 MCP 邊界，但那只是 TESTED，不是 Official Full MCP ENVIRONMENT 證據。
- **證據與回報：** **缺口**。需 Claude Code／擁有者定義並在受支援 workspace 真實執行完整驗收路徑；目前沒有可引用的 run ID、write verifier 或 tunnel 證據，保持未完成。

## 10. PEGA／OFFICIAL 真實故障隔離

- **前置條件：** 第 1–3 節先於真實兩供應商環境通過，擁有者可安全地讓其中一方暫時不可用並恢復；測試不能危及正式帳號或工作資料。
- **操作：** 在真實隔離的目標機器以 workflow `mode: codex-fault-isolation`、`source_ref: <40 碼 SHA>`、`pega_model`、`pega_wire_api`、`codex_worker_root`、`expected_arch` 執行；尚不能派發 workflow 時，設定對應的 `AECP_PROVIDER_VERIFY_MODE=codex-fault-isolation`、`AECP_PROVIDER_VERIFY_PEGA_MODEL`、`AECP_PROVIDER_VERIFY_PEGA_WIRE_API`、`AECP_PROVIDER_VERIFY_CODEX_ROOT`、`AECP_PROVIDER_VERIFY_EXPECTED_ARCH` 與受保護的 `AECP_PEGA_API_KEY`，在目標 checkout 執行共通 `node` 指令。mode 先以子程序環境中的無效 PEGA key 使 PEGA 失敗、OFFICIAL 成功，再用 scratch 全新空 OFFICIAL home 使 OFFICIAL 失敗、真實 PEGA 成功；最後對兩個真實 home 做 `recovery` health 檢查。真實 auth 檔不刪改複製；既有 AECP 管理 `config.toml` 可按 D1 冪等準備。
- **成功證據：** `codex.fault-isolation: PASS` 的 `stages[]` 各含失敗／健康方的 `workerId`、`status`、`health`、`registryState`（暫存 WorkerRegistry，失敗方 FAILED/UNKNOWN、健康方 IDLE）、`noFallback`、安全錯誤代碼；`protection` 的真實 OFFICIAL auth 摘要不變、PEGA 無 auth 且 config digest 穩定、不同 home/no fallback 等布林值全為 true；`recovery: PASS` 兩側 `health=READY`。`codexHomeSha256` 是**路徑雜湊**，不可當檔案內容保護證據。JSON 只含 auth 檔名、大小與內容 SHA-256 摘要，不含內容。
- **回報與缺口：** 提供兩階段及 recovery check、`protection`、exact-source SHA、機器架構與操作者聲明。現有 `inspect-workspace` 唯讀執行路徑在 Electron main process，無無 Electron 的純 Node 呼叫入口；本 mode 記錄 `safeBridge.status=OPERATOR_REQUIRED`，**不能**以其 PASS 取代 Safe Bridge 證據。操作者須在實機 UI 於兩階段各執行一次唯讀 Command Card，填寫 [`safe-bridge-during-fault` 範本](../samples/owner-evidence/safe-bridge-during-fault.template.json)，將該次 `codex-fault-isolation` evidence JSON 的檔名及 SHA-256 填入 `artifacts.providerEvidence`，再以 `node scripts/verify-owner-evidence.cjs <填妥的 JSON 路徑> --expect-sha <40 碼 SHA>` 檢查。**同時提交**該次 provider evidence JSON 與填妥的 owner 記錄；未填範本本身必須 FAIL，驗證器 PASS 亦不能替代真人實機與 Claude 審核。真實 provider 跑過並經 Claude 驗收前仍是 ENVIRONMENT 未完成。

## 目前缺口清單（供 Claude Code 決策）

1. `provider-environment.yml` 尚不在預設分支，GitHub 手動派發目前不可用；本機 script 可執行，但不具 workflow run/provenance artifact。
2. 單 Worker OFFICIAL／PEGA／local-command 的獨立檔案 verifier 已施工並有確定性測試；仍須在真實目標環境取得對應 PASS artifact。
3. ARM64/X64 動態標籤路由已施工；擁有者仍須供應、標記並維護正確的實際 runner，架構 hard gate 負責再次拒絕錯配。
4. 實體 ARM64 UI、人類筆電設備／verifier 安全審查、Official Full MCP 仍無完整自動證據路徑。故障隔離 mode 可產生兩階段及 recovery 證據，但 Safe Bridge 連續可用仍須實機操作者補證；真實供應商執行尚未完成。
5. PEGA 不支援 wire API 的真實能力分類尚無獨立報告；僅能保留各次 run 的安全 error code 與 PASS/FAIL。
