# Bank Transfer Implementation Plan

> **状态：** 已于 2026-11-26 完成全部 5 项任务与交付验收（后端 90 项、学习端组件 59 项、管理端 5 项、E2E 4 项通过，两个前端生产构建成功，`npm run api:check` 通过）。本文保留为实施和验收记录，不再作为待执行计划。

**Goal:** 在管理端题库页按题库导出（JSON / CSV）和导入（JSON / CSV / TSV）题目，并给出可核对的导入报告。

**Architecture:** 后端在 `mtt/corpus/` 新增 `transfer.py` 承担格式解析与导入导出，接口挂在既有的 `/api/v1/questions/banks/{id}` 下；复用现有的 `validate_question` 与 `resolve_category_path`。管理端只改题库页。

**Tech Stack:** FastAPI、SQLModel、pytest；React 18、Ant Design 5、Vitest、Testing Library。

## Global Constraints

- 设计以 `docs/superpowers/specs/2026-11-26-bank-transfer-design.md` 为准。
- 所有路径相对仓库根目录；后端命令在 `moneyToTip/`，管理端命令在 `moneyToTipConsole/`，学习端命令在 `moneyToTipApp/`。
- 题库导出不含学习进度；导入的合法行一次事务提交，无法解析的文件整份拒绝。
- 每个任务按 RED → GREEN → 回归验证执行。
- 学习端的 OpenAPI 类型由服务端生成，后端接口变化后必须重新生成并确认无漂移。

## File Structure

- `moneyToTip/mtt/corpus/transfer.py`：题库导出、表格与 JSON 解析、导入报告。
- `moneyToTip/mtt/corpus/router.py`：导出与导入两个接口。
- `moneyToTip/tests/test_bank_transfer.py`：接口验收。
- `moneyToTipConsole/src/pages/BanksPage.tsx`：行内导出、导入弹窗与报告。
- `moneyToTipConsole/src/pages/BanksPage.test.tsx`：组件测试。

---

### Task 1: 设计说明与实施计划

**Files:**
- Create: `docs/superpowers/specs/2026-11-26-bank-transfer-design.md`
- Create: `docs/superpowers/plans/2026-11-26-bank-transfer.md`

- [x] **Step 1: 记录接口、文件格式、导入规则与测试范围**

---

### Task 2: 题库导出

**Files:**
- Create: `moneyToTip/mtt/corpus/transfer.py`
- Modify: `moneyToTip/mtt/corpus/router.py`
- Test: `moneyToTip/tests/test_bank_transfer.py`

**Interfaces:**
- `GET /api/v1/questions/banks/{bank_id}/export?format=json|csv`：附件响应；JSON 为 `moneytotip-bank` v1，CSV 十列。

- [x] **Step 1: 写导出测试**

JSON 只含该题库的题、分类为 `::` 路径、不含状态与日志；CSV 表头与中文文案正确、选项一格一行；他人题库 404。

- [x] **Step 2: 实现导出**
- [x] **Step 3: 回归**

```bash
cd moneyToTip && uv run --frozen pytest tests/test_bank_transfer.py -q
```

---

### Task 3: 题库导入

**Files:**
- Modify: `moneyToTip/mtt/corpus/transfer.py`
- Modify: `moneyToTip/mtt/corpus/router.py`
- Test: `moneyToTip/tests/test_bank_transfer.py`

**Interfaces:**
- `POST /api/v1/questions/banks/{bank_id}/import`（multipart `file`）：返回 `created`、`duplicates`、`by_status`、`invalid`、`needs_review`、`truncated`。

- [x] **Step 1: 写导入测试**

CSV 往返、JSON 数组与题库文件、中英文表头与 TSV、去重与无效行、降级待确认、缺表头 / 空文件 / 格式不符 422、他人题库 404。

- [x] **Step 2: 实现导入**
- [x] **Step 3: 回归**

```bash
cd moneyToTip && uv run --frozen pytest -q
```

---

### Task 4: 管理端题库页

**Files:**
- Modify: `moneyToTipConsole/src/pages/BanksPage.tsx`
- Test: `moneyToTipConsole/src/pages/BanksPage.test.tsx`

- [x] **Step 1: 写组件测试**

行内导出带凭证请求导出接口；导入后展示报告并刷新题库列表。
- [x] **Step 2: 实现导出菜单、导入弹窗与报告**
- [x] **Step 3: 回归与构建**

```bash
cd moneyToTipConsole && npm test && npm run build
```

---

### Task 5: 回归与交付

**Files:**
- Modify: `moneyToTipApp/src/api/schema.d.ts`（由服务端重新生成）
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-26-bank-transfer-design.md`
- Modify: `docs/superpowers/plans/2026-11-26-bank-transfer.md`

- [x] **Step 1: 重新生成学习端 OpenAPI 类型并确认无漂移**
- [x] **Step 2: 全量回归（后端、管理端、学习端、E2E）与两个前端的构建**
- [x] **Step 3: 重启本地实例并在真实浏览器里核对题库页**
- [x] **Step 4: 更新 README 与文档状态**

真实浏览器验收记录：在隔离实例登录管理端，按题库下载 JSON / CSV；导入包含新增、重复和不合格行的 CSV，页面显示「新增 2 道，跳过重复 1 道」及待确认原因；随后重新导出包含导入题目的 CSV。重启本地实例后，对真实 Python 题库只读导出 14 道题，未写入数据。
