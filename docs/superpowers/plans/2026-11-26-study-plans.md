# Study Plans Implementation Plan

> **状态：** 待执行。任务与步骤只有完成测试和验收后才能勾选。

**Goal:** 让每个学习计划在今日页可见、可进入、独立计进度，并修复「完成的复习会话被重放」的缺陷。

**Architecture:** 后端接口不变。App 端的复习会话 hook 接受显式的计划 ID，按计划的剩余目标和题库范围拉题；今日页用 TanStack Query 读取 `plans`、`plans/active`、`banks`，以独立组件渲染今日计划卡片。队列加载只认本次挂载后新拉取且已稳定的结果，完成的会话不再写入快照。

**Tech Stack:** React 18、TypeScript 5、Vite 5、TanStack Query 5、Vitest、Testing Library、Playwright。

## Global Constraints

- 设计与决策以 `docs/superpowers/specs/2026-11-26-study-plans-design.md` 为准。
- 所有路径相对仓库根目录；App 命令在 `moneyToTipApp/` 执行，后端命令在 `moneyToTip/` 执行。
- 服务端是学习记录唯一事实源；前端缓存不得重建一次已完成的复习。
- 失败必须可见：计划加载失败要显示原因和重试，不得显示成「没有计划」。
- 移动端优先支持 360px，触控目标至少 44×44px；新组件使用设计令牌 + CSS Modules。
- 每个任务按 RED → GREEN → 回归验证执行。
- 现有视觉基线为 win32 平台生成，本次不更新基线，也不作为验收门禁。

## File Structure

- `moneyToTipApp/src/features/review/`：复习会话 hook、快照。
- `moneyToTipApp/src/features/today/`：今日页的今日计划卡片组件。
- `moneyToTipApp/src/pages/`：今日、复习、学习计划、我的页面。
- `moneyToTipApp/e2e/`：学习计划端到端测试。

---

### Task 1: 设计说明与实施计划

**Files:**
- Create: `docs/superpowers/specs/2026-11-26-study-plans-design.md`
- Create: `docs/superpowers/plans/2026-11-26-study-plans.md`

- [x] **Step 1: 记录实测结论、已确认决策、交互与技术设计**

---

### Task 2: 修复复习队列重放

**Files:**
- Modify: `moneyToTipApp/src/features/review/snapshot.ts`
- Modify: `moneyToTipApp/src/features/review/useReviewSession.ts`
- Test: `moneyToTipApp/src/features/review/snapshot.test.ts`
- Test: `moneyToTipApp/src/pages/ReviewPage.test.tsx`

**Interfaces:**
- `loadReviewSnapshot(userId)`：遇到「已完成」的快照时清除并返回 `null`。
- `useReviewSession`：只在本次挂载后拉取成功、没有更新的请求在途、且尚未建立会话时派发 `QUEUE_LOADED`；会话完成后清除快照。

- [ ] **Step 1: 写复现测试**

快照测试：完成的会话保存后读取为 `null`。

复习页测试：查询缓存里预置上一轮的旧队列和「已完成」快照，重新进入复习页。期望向服务器重新拉取队列并展示新题目，而不是旧题目。

```tsx
client.setQueryData(["reviews", "due", null, null, null, 20], [first]);
expect(await screen.findByText("测试题目 2")).toBeVisible();
expect(dueRequests).toBe(1);
```

- [ ] **Step 2: 实现修复**

- [ ] **Step 3: 回归**

```bash
cd moneyToTipApp && npm test
```

---

### Task 3: 复习会话绑定学习计划

**Files:**
- Modify: `moneyToTipApp/src/features/review/useReviewSession.ts`
- Modify: `moneyToTipApp/src/pages/ReviewPage.tsx`
- Test: `moneyToTipApp/src/pages/ReviewPage.test.tsx`

**Interfaces:**
- `useReviewSession(categoryId, bankId, planId)`：`planId` 指向今日计划中的计划时，`limit = max(1, daily_goal - today_done)`，已达成时为 20，上限 100；`bank_id` 取计划题库；提交带 `plan_id`。没有 `planId` 或计划不在今日计划中时为自由模式。
- 返回值 `plan`：本轮绑定的计划，自由模式为 `null`。
- 路由：`/review?plan=<id>`。

- [ ] **Step 1: 写会话绑定测试**

路由为 `/review?plan=7`，计划每日目标 5、今日已完成 1、绑定题库 3。期望拉题请求为 `limit=4&bank_id=3`，副标题显示计划名，提交体含 `plan_id: 7`。另加一例：已达成计划的会话拉 20 题。

- [ ] **Step 2: 实现计划绑定，移除「第一个今日计划」的隐式选择**

- [ ] **Step 3: 回归**

```bash
cd moneyToTipApp && npm test
```

---

### Task 4: 今日页的学习计划

**Files:**
- Create: `moneyToTipApp/src/features/today/TodayPlans.tsx`
- Create: `moneyToTipApp/src/features/today/TodayPlans.module.css`
- Modify: `moneyToTipApp/src/pages/TodayPage.tsx`
- Modify: `moneyToTipApp/src/pages/TodayPage.module.css`
- Test: `moneyToTipApp/src/pages/TodayPage.test.tsx`

**Interfaces:**
- `TodayPlans({ plans, banks, failed, onRetry })`：渲染「今日计划」区；未达成计划有「开始 / 继续」，已达成计划有「已达成」标记和「加练」。
- 今日页：有今日计划时总览卡不放主按钮；没有时保留「继续今日复习」并提供学习计划入口。

- [ ] **Step 1: 写今日页测试**

- 两个今日计划（一个未达成、一个已达成）：各有一张卡片和自己的进度，链接为 `/review?plan=<id>`；页面上没有「继续今日复习」。
- 没有今日计划：有「继续今日复习」和学习计划入口。
- 计划接口失败：显示失败原因，重试后恢复。

- [ ] **Step 2: 实现今日计划卡片与入口**

- [ ] **Step 3: 三视口检查**

在临时实例上用真实浏览器检查 360 / 768 / 1440px：无横向溢出，按钮不小于 44×44px，加载、空态、错误态齐全。

- [ ] **Step 4: 回归**

```bash
cd moneyToTipApp && npm test
```

---

### Task 5: 入口与命名

**Files:**
- Modify: `moneyToTipApp/src/pages/MePage.tsx`
- Modify: `moneyToTipApp/src/pages/MePage.test.tsx`
- Modify: `moneyToTipApp/src/pages/PlansPage.tsx`
- Modify: `moneyToTipApp/src/pages/PlansPage.test.tsx`

- [ ] **Step 1: 写「我的」空态入口测试与计划页标题测试**
- [ ] **Step 2: 空态提供「新建学习计划」链接；「训练计划」统一改为「学习计划」**
- [ ] **Step 3: 回归**

```bash
cd moneyToTipApp && npm test
```

---

### Task 6: 端到端测试

**Files:**
- Create: `moneyToTipApp/e2e/study-plans.spec.ts`
- Modify: `moneyToTipApp/package.json`

- [ ] **Step 1: 写「两个计划各完成一轮」**

两个题库各建一个每天 2 题的计划并加入今日。从今日页依次完成两个计划：

- 第二个计划的会话必须请求服务器，而不是重放第一个计划的题。
- 每个计划的进度独立，全部完成后今日目标达成。
- 复习日志没有重复题目的多余记录。

- [ ] **Step 2: 把新用例加入 `npm run test:e2e` 并执行**

```bash
cd moneyToTipApp && npm run test:e2e
```

---

### Task 7: 回归、构建与交付

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-26-study-plans-design.md`
- Modify: `docs/superpowers/plans/2026-11-26-study-plans.md`

- [ ] **Step 1: 全量回归**

```bash
cd moneyToTip && uv run --frozen pytest -q
cd ../moneyToTipApp && npm test && npm run build
```

- [ ] **Step 2: 更新 README 与文档状态，勾选已完成步骤**
- [ ] **Step 3: 重新构建 App，供本地运行实例直接使用**
