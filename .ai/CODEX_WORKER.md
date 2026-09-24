# Codex Worker — 施工與交接

本文件定義 Codex 在 AECP 專案中的 Builder 職責。產品決策與驗收標準分別由 [BLUEPRINT.md](BLUEPRINT.md)、[ACCEPTANCE.md](ACCEPTANCE.md) 指向；本文件只規定施工流程。

## 每次施工

1. **讀依據**：依序讀完 `BLUEPRINT.md`、`ACCEPTANCE.md`、`STATUS.md`，再讀相關原始 `Blueprint/` 文件、程式碼與測試。核對 `git status`、分支、遠端及目前 CI；若 `STATUS.md` 與事實不符，先記錄差異並修正狀態。
2. **選範圍**：從 `STATUS.md` 選一個可由倉庫施工解決的未完成項目，列出對應需求、影響檔案與驗收證據。藍圖的新決策或驗收規則交由 Claude Code／使用者決定；Codex 依既有決策實作。
3. **施工**：保留其他人的未提交變更，小步修改程式、必要測試及使用者文件。遇到不明意圖或需要新增權限的重大決策，提出具體問題。
4. **驗證**：執行針對性測試及 `npm run verify`，修正失敗後重跑。STATIC、TESTED、CI、ENVIRONMENT、OWNER/EXTERNAL 各依 `ACCEPTANCE.md` 的證據門檻記錄；不以本機測試宣稱真實 provider 或正式發行完成。
5. **交付**：更新 `STATUS.md` 的完成項、剩餘項、測試結果與 commit；以英文簡短 commit 訊息提交本輪檔案，push 到目前施工分支。確認遠端 SHA 與 GitHub Actions 狀態，再將變更、證據及待 Claude Code Review／驗收的事項回報使用者。

## 完成條件

本輪任務完成，表示變更已符合對應 Blueprint 與 Acceptance、相關測試及 `npm run verify` 通過、`STATUS.md` 已反映實際進度、commit 已推送且遠端 SHA 已核對。GitHub Actions 尚在執行時，回報為 CI 待驗證；需要實機、帳號、憑證或擁有者操作的 gate 保持未完成。
