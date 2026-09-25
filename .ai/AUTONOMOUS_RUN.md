# 自動連跑協議（施工者用）

目標：一次啟動，依序完成 **0013 批次 9–11 → 0014 → 0015**，中間不需要人來回傳話。品質由 **驗收閘門** `scripts/review-gate.cjs` 機械把關，它取代人工審查。

## 迴圈（每個單位 = 0013 的一批，或 0014 的一項，或 0015 整張）

1. `git fetch origin`；確認本地與遠端一致；工作區乾淨；記下 `BASE=$(git rev-parse HEAD)`。
2. 先跑 `npm run verify`，必須綠；不綠就停下回報，不要修。
3. 依該單位的施工單施工。**每一條 `IMPLEMENTED` 都要把破壞紀錄追加到 `.ai/sabotage-log.jsonl`**（JSON 一行一筆）：
   `{"ids":["B04-L11"],"file":"electron/lib/security-policy.cjs","from":"精確且唯一的原文","to":"替換文字","tests":["tests/xxx.test.cjs"]}`
   `file` 必須是 `electron/`、`ui/`（0015 也可含 `scripts/`）下的產品程式，不可是測試本身。`from` 必須在該檔只出現一次。你自己先用 `node scripts/sabotage-check.cjs <file> "<from>" "<to>" <tests...>` 確認 DETECTED 再記錄。
4. `npm run verify` 全綠、`node scripts/traceability-audit.cjs --strict` 通過 → commit（只加你改過的檔案）→ `git push origin feat/control-plane-complete-loop`。
5. 跑閘門：
   `node scripts/review-gate.cjs --base $BASE --mode tests --ci`（0014 用 `--mode fix`）
   - `ACCEPTED` → 在該施工單「回報」追加簡短紀錄，做下一個單位。
   - `REJECTED` → 依它列出的每一個問題修正（不是繞過），修完重新推送並重跑閘門。**同一個單位連續 2 次仍 REJECTED 就停下回報**，列出閘門原文。
6. 閘門的 `--ci` 會等待 GitHub 的 AECP Security 與 AECP CI；它們不綠就是 REJECTED，先修好。

## 停止條件（其餘情況不要停下來問）

- 基線 `npm run verify` 是紅的。
- 同一單位閘門連續 2 次 REJECTED。
- 需要改 `Blueprint/`、`.github/`、`.ai/ACCEPTANCE.md`，或需要新增權限／放寬安全檢查才能繼續。
- 兩條藍圖規範互相矛盾。
- 全部完成。

## 完成時

在 `.ai/STATUS.md` 頂部「結論」更新最終矩陣統計與仍待人工／環境／擁有者的清單，再輸出一份最終摘要（各單位 commit、最終矩陣統計、所有仍為 `CONFIRMED_GAP`／`PARTIAL` 的條文與原因、你最不確定的 10 個判斷），然後停下。

## 硬性禁止（任何時候）

不改 `Blueprint/`、`.github/`、`.ai/ACCEPTANCE.md`；不放寬或刪除既有測試的斷言；不新增權限；不 merge PR、不 force push、不用 `--no-verify`；不標任何 `ENVIRONMENT`／`OWNER` 項目完成；不處理超出各施工單範圍的缺陷（發現就標 `CONFIRMED_GAP` 或寫進回報）。
