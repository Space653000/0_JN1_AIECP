# Codex 工作入口

Codex 在本倉庫擔任 Builder：負責依既定藍圖施工、修改程式與文件、執行測試、修正失敗，並回報可驗證的結果。Claude Code 負責藍圖、Review 與驗收；角色細則見 [`.ai/CODEX_WORKER.md`](.ai/CODEX_WORKER.md) 與 [`.ai/CLAUDE_REVIEWER.md`](.ai/CLAUDE_REVIEWER.md)。

每次開始任何施工前，依序完整讀取：

1. [`.ai/BLUEPRINT.md`](.ai/BLUEPRINT.md)：產品方向與原始 Blueprint 索引。
2. [`.ai/ACCEPTANCE.md`](.ai/ACCEPTANCE.md)：需求、驗收條件與證據等級。
3. [`.ai/STATUS.md`](.ai/STATUS.md)：目前進度與未完成項目。
4. [`.ai/CODEX_WORKER.md`](.ai/CODEX_WORKER.md)：Codex 施工流程。

再讀 [`.ai/WORK_ORDERS/`](.ai/WORK_ORDERS/) 中編號**最小**、狀態為 OPEN 的施工單（由 Claude Code 簽發，依編號順序施工）；一張完成並標 `DONE-PENDING-REVIEW` 後，若仍有 OPEN 施工單，直接接續下一張，不必等待 Review，全部完成後一次回報。有施工單時，以施工單的範圍、邊界與交付要求為準。沒有 OPEN 施工單時，才依 `STATUS.md` 選擇明確、可執行的未完成項目，核對 Git 工作區與相關程式碼後再修改。每次施工完成，執行相關測試及 `npm run verify`、更新 `STATUS.md`、以英文簡短訊息 commit，並 push 至目前受管施工分支。GitHub Actions 結果須對照新 commit；需要真實環境或擁有者證據的項目保持待驗證。
