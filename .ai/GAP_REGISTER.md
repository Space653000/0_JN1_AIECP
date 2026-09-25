# 藍圖落差登記簿（Blueprint ↔ 現實施工）

**建立：** 2026-09-24，Claude Code。**方法：** 逐條把藍圖的規範性條文對照實際程式碼／測試（不是對照 STATUS.md 或 `Blueprint/23` 的自述）。
**重要更正：** 先前 [STATUS.md](STATUS.md) 的結論「剩餘不完整幾乎全是外部閘門，不是未追蹤的程式碼待辦」**不成立**。原因：`scripts/blueprint-coverage.cjs` 等既有稽核只檢查「對應證據**檔案是否存在**」，不檢查每條 MUST 是否真的被實作，因此「藍圖 100% 覆蓋」從未被真正驗證。本登記簿列出這次抽查實證的落差。

**覆蓋範圍誠實聲明：** 本輪僅抽查 Blueprint 18 §13（15 條）、20 §27（20 條）、22 §5–§16、21 §6–§7、04 §5、11、12。**尚未逐條審計** 01、05、14、15、16、02/03/04 的全部 MUST。這正是施工單 0006（可機器驗證的追溯矩陣）的目的。

## 已驗證「符合」（有程式碼實證）
| 藍圖條文 | 實證 |
|---|---|
| 18 §13 #2 OpenCode deny-first（`external_directory`/`webfetch` 等皆 deny） | `electron/lib/autonomy.cjs:89-103` |
| 18 §13 #3 Codex `workspace-write` + `network_access=false` | `autonomy.cjs:150-153` |
| 18 §13 #10 有界 binary patch（`git diff --binary`、`maxPatchBytes`） | `autonomy.cjs:76,366-380` |
| 18 §13 #11 Apply 前重驗 HEAD | `autonomy.cjs:396` |
| 11 Command Card 64 KiB、剪貼簿寫入 128 KiB 上限 | `protocol.cjs:8`、`main.cjs:1775` |
| 22 §16 新手八問（一屏） | `tests/dashboard-acceptance.test.cjs` |

## 落差（有實證，需施工）
| ID | 藍圖條文 | 實際狀況（證據） | 嚴重度 | 施工單 |
|---|---|---|---|---|
| G1 | 20 §27 #6「Reviewer sees Blueprint + Plan + Diff + Evidence」；21 §7 Review Report（`aecp.review/v1`：blueprint/plan/implementation/tests/security/architecture 六項＋result 含 BLOCKED） | `harness.cjs:220` `reviewerPrompt(task, goal, done, diff, verification)`：**沒有 Blueprint、沒有完整 Plan（只有單一 task）**；`diff` 來自 `diffSummary()`（`harness.cjs:231`），只是 `git status --short` + `git diff --stat` 且截斷 6000 字元——**Reviewer 看不到實際程式碼差異**；回傳格式僅 `{result, findings, required_changes}`，無 schema、無六項判定、無 BLOCKED | **高**（核心迴圈的審查品質） | 0007 |
| G2 | 21 handoff 規則：每次交接含 schema 版本與 Task/Run correlation ID；`aecp.worker-report/v1`、`aecp.context/v1`、`aecp.goal/v1` | 程式碼只有 `aecp.plan/v1`、`aecp.task/v1`、`aecp.result/v1`、`aecp.trace/v1`；**無 `aecp.review/v1`、`aecp.worker-report/v1`**；Builder 輸出為原始 process 輸出，未結構化 | 中 | 0007 |
| G3 | 20 §27 #19「Repository knowledge is legible to agents」；20 §14「Repository as agent memory」、§15 AGENTS.md 策略 | `electron/lib/` 內**沒有任何**發現/注入 AGENTS.md、Blueprint、驗證指令的程式；Planner 的 CONTEXT 只吃使用者手動提供的 `options.context`（`harness.cjs:444`）；本 repo 在 2026-09-24 之前連根目錄 `AGENTS.md` 都沒有 | **高** | 0008 |
| G4 | 22 §6 Run timeline（點事件開證據）、§7 Diff view、§8 Review view、§11 六類 Notifications；20 §16 專案進度總覽（Planning/Implementation/Testing/Review/Acceptance %） | 主控台區塊只有 Runtime Signals / Worker Runtime / Mission Queue / Approval Queue / Task Board / Live Event Stream；`ui/` 中 `notification`、`timeline` 零命中；無 Diff/Review 視圖；無進度百分比 | 中高 | 0009 |
| G5 | 22 §9 GitHub view 欄位（branch、base、commit、PR、CI、workflow、artifacts、release、last event） | 僅部分欄位存在（PR/CI），完整度未驗證 | 中 | 0009（順帶補齊，缺者顯示 UNKNOWN） |
| G6 | 所有「完整性」宣稱 | 既有 `blueprint-coverage`/`requirements-coverage`/`roadmap-gate-audit` 只驗檔案存在與字串，無「條文→測試」追溯 | **高**（讓落差長期不可見） | 0006 |
| G7 | 22 §11 六類通知（含 CRITICAL＝政策/安全違規） | 通知規則用的事件名稱與系統實際發出的不一致：`policy.violation`／`security.*` 從未被發出（CRITICAL 永不出現）；真實 CI 失敗事件 `ci.failed_rework`／`ci.failed_max_iterations` 被歸為 INFO；測試用自訂事件名，自我印證 | 中高 | 0010 |
| G8 | 全部規範條文的完整性 | 已完成分類（0010、0011）：231 條中 115 已實作、91 部分、5 確認缺失、9 人工、3 擁有者、8 蓄意不做，無任何未分類項；「部分」與「確認缺失」由 G9、G10 承接 | 中 | 0011 |
| G9 | B04 Electron 基線、B11、B21 | **已全部修復（5/5）**：導覽限制、剪貼簿位元組上限、IPC 統一參數驗證、Evidence 不可變（write-once）、Result Capsule 未驗證不得宣稱成功；並額外修掉兩條路徑穿越（模型控制的任務 ID、`task:trace`／`task:evidence`）。詳見 0012 | 已解決 | 0012 |
| G10 | 89 條 PARTIAL | 行為存在但缺針對該條文的測試；`policy.violation` 已涵蓋所有政策閘門（0012 D）。剩餘 89 條依風險分 11 批，見 `.ai/WORK_ORDERS/0013-batches.md` | 中 | 0013 |
| G11 | B05 §7、§8、B02 | 0013 批次 3 發現並經 Claude 重現的真缺陷：①Webhook 簽章長度不符丟 RangeError 使請求掛住（github-webhook.cjs verify）；②external.correlated 因與 external.received 共用 idempotencyKey 被去重而從未寫入；③ResourceManager.scan 把帶內嵌憑證的 remote URL 原樣寫入 resources.json（B05-L20）；④鎖回收不記錄釋放原因（B02-L109）；⑤跨倉庫鎖無決定順序／BLOCKED（B05-L88） | 高（①③涉及安全） | 待簽發 0014 | **更新：** ①webhook 簽章崩潰、②external.correlated 未寫入 已修復（見 0013 批次 7 審查）；③④⑤仍開。
| G12 | 20 §27 #2 | **已修復**：control-plane.cjs 呼叫未 import 的 prepareWorktree，所有派發任務 ReferenceError（自 c3e547d）。修復與端到端測試見 0013 批次 4 審查 | 已解決（嚴重） | 0013 |
| G13 | B05 §7 | **已修復（0013 批次 5 後）：** 人工核准後 Mission 卡死（R2.1）、CI 失敗後 rework 因 worktree 登記殘留失敗（R4.5）、reviewer 缺 credentialApproved（B20-27-18）。**仍開：** 同 repo 兩任務同時派發時 git-admin 鎖不等待，第二個以 Lock busy 失敗（與藍圖 05 §7 不符） | 中高 | 待簽發 0014 |
| G14 | R5.4 / 藍圖維運 | 孤兒 worktree 清理兩缺陷：①多 repo 任務的 repoRoot 誤用 run.sourceRoot（容器目錄），git worktree remove 失敗被吞，worktreesRemoved 恆為 0；②每輪對所有歷史終態任務各跑 2 個 git 行程、無每輪上限，成本隨歷史無限增長（與 bounded budgets 不符） | 中 | 待簽發 0014 |
| G15 | B03 §隔離、供應商 | ①**CODEX_HOME 隔離可被繞過（安全）：** WorkerRegistry 只比路徑字串，junction 別名、巢狀路徑、上層目錄皆被接受，兩個 worker 可共用同一份登入與 session（B03-L56，已重現）；②codex worker 健康檢查不連線端點就回 READY，不驗證 wire API（B03-L68）；③createMission 省略 maxTurns／maxFailedAttempts 時退化為 1，預設公式失效；④B03-L168 沒有為 agent 交接寫 Context Capsule | 高（①） | 已修復（0014，2026-09-25） |
| G16 | R3.6 / 藍圖 04、03 | 狀態檔損毀（worker-registry.json 或 control-plane.json）會讓 App 啟動失敗：main.cjs 在 registerIpc() 之前 await initControlPlane()，所有 IPC（含 Safe Bridge）都不會註冊。應隔離損毀、降級啟動並顯示錯誤 | 中高 | 待簽發 0014 |
| G17 | B04 路徑安全 / CI | **AECP CI 自 0013 批次 3 起全紅（失敗或 20 分鐘逾時被取消）的根因，已在本機以 junction 臨時目錄重現：** `SecurityPolicy`／`isWithinRoot`（path-safety.cjs）只做文字比對、不做 realpath；Control Plane 的 rootDir 若是 8.3 短名或 junction 別名（GitHub Windows runner 的 `C:UsersRUNNER~1...`），就與 `git worktree` 回報的長路徑不同，任務以「Path is outside the configured allowlist」FAILED（fail-closed，不是安全洞，是可靠度缺陷；使用者資料夾若以別名路徑綁定也會遇到）。測試端已用 `tests/support/canonical-tmp.cjs`（`npm test` 預載）讓測試使用正規臨時路徑；**產品端尚未修**（需判斷是 SecurityPolicy 比對前先 realpath，或在 Workspace/rootDir 綁定時正規化） | 中 | 待簽發 |
| G18 | B12 §4（B12-L134） | `persistTask`（main.cjs）寫入的 `evidence/<task>/task.json` 與 `evidence.json` 沒有任何 schema 標識；其餘各持久化檔案（state、credentials、result、trace、control-plane、events、locks、resources、worker-registry）都有。「每份持久化文件都有版本」因此不成立 | 低中 | 待簽發 |

## 決策紀錄（Claude Code，Blueprint 擁有者）
- **D2｜Blueprint 22 §6–§9、§11 與 20 §16 為必要項。** `22 §17` 有一段「深入視覺檢視……為選用的呈現強化，非缺失的驗收需求」的收尾註記，是先前施工者為結案而加，且與同文件本文「dashboard must show…」衝突；依「Blueprint 是標準」，以本文為準，該註記視為被取代（不改動原檔，於此登記）。
- **D3｜Blueprint 04 §5 的 YAML 政策檔屬「Example」。** 實質要求是「政策由模型之外的決定性程式強制」，現行 JSON `workspace-policy` + `SecurityPolicy` 已達成；接受偏離，不要求 YAML 載入器。若日後要求檔案化政策，另立施工單。
- **D4｜Review Report 的 `BLOCKED`**：視為 `HUMAN_REQUIRED` 閘門並記錄原因，不得自動放行。
- **D5｜成熟度（20 §26）如實標示：** M0–M4 於倉庫內已具備；**M5（自我維護的 Agent Repository）僅部分**——現有維運/漂移掃描只診斷、不自動修正，屬刻意邊界，不宣稱 M5。
- **D6｜ENVIRONMENT / OWNER 閘門不變**：不因本輪審計而改動。

## 尚未審計（誠實揭露，交 0006 產出追溯矩陣後再補登）
01 UX（含無障礙目標）、05 GitHub 多倉庫細節、14 Goal Loop 全部 MUST、15 私有更新/Agent Adapter、16 執行模式、02/03/04 其餘 MUST、08 各階段 bullet、12 `schemaVersion`（程式碼多用 `schema` 欄位，命名與藍圖「schemaVersion」是否等價未確認）。
