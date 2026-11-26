# Memory Experience Redesign Implementation Plan

> **状态：** 已于 2026-11-26 完成全部 10 项任务与发布验收。本文保留为实施和验收记录，不再作为待执行计划。

**Goal:** 在已完成的可靠复习 API 与 `ebbinghaus-v1` 记忆引擎之上，交付移动端优先、失败可恢复、排期可解释的完整学习体验。

**Architecture:** 保留 React PWA、FastAPI、SQLModel 和 SQLite。App 端以 TanStack Query 管理服务端状态，以纯 `useReducer` 状态机管理复习会话；设计令牌与 CSS Modules 构成复习端组件体系。后端只补充今日聚合、计划偏好、记忆洞察、安全删除和普通用户登录，不重写已验证的排期算法。

**Tech Stack:** React 18、TypeScript 5、Vite 5、TanStack Query、Vitest、Testing Library、Playwright、FastAPI、SQLModel、Alembic、pytest。

## Global Constraints

- 所有路径相对仓库根目录；后端命令在 `moneyToTip/`，App 命令在 `moneyToTipApp/`，管理端命令在 `moneyToTipConsole/` 执行。
- 已完成的 `mtt/schedule/memory.py` 是排期计算唯一入口；默认目标保持率 `0.85`，最短间隔 10 分钟，最长 365 天，算法版本 `ebbinghaus-v1`。
- 服务端是学习记录唯一事实源；只有 `POST /api/v1/reviews` 成功返回后才能展示“已保存”或进入下一题。
- 重试必须复用原 `client_id`；队列请求失败不得把旧队列替换为空队列。
- 复习快照只保存当前会话所需数据，退出登录必须清除；PWA API 缓存继续保持 `NetworkOnly`。
- 移动端优先支持 360px，触控目标至少 44×44px；动画 150–250ms，并尊重 `prefers-reduced-motion`。
- App 端使用设计令牌 + CSS Modules，不引入 Ant Design；管理端继续使用 Ant Design 5。
- 真实保持率必须来自有效复习日志并展示样本量；模型预测不得冒充真实学习结果。
- 新数据库结构必须通过 Alembic 迁移；不得扩张启动时字段补丁，不得提交数据库、`.env`、令牌或密码。
- 每个任务按 RED → GREEN → 回归验证执行；任务提交前不得勾选未完成步骤。
- 本计划不包含 FSRS、离线作答、多格式材料导入、Anki 导出、MCP、原生 App 或公开注册。

---

## File Structure

- `moneyToTipApp/src/api/`：统一请求错误、OpenAPI 类型和查询客户端。
- `moneyToTipApp/src/features/review/`：纯复习状态机、快照、会话 API 与复习组件。
- `moneyToTipApp/src/components/ui/`：可复用基础组件及 CSS Modules。
- `moneyToTipApp/src/pages/`：今日、专注复习、题库、导入、我的、记忆洞察与登录页面。
- `moneyToTipApp/e2e/`：核心学习链路和多视口视觉回归。
- `moneyToTip/mtt/growth/`：今日聚合、真实保持率、未来负荷与薄弱内容。
- `moneyToTip/mtt/schedule/`：服务端当前计划偏好；复用现有记忆引擎。
- `moneyToTip/mtt/corpus/`：有学习记录题目的安全暂停与删除约束。
- `moneyToTip/mtt/identity/`：普通用户密码登录和首次示例题引导。
- `moneyToTipConsole/src/`：真实路由和按需加载，不重做管理端视觉。

### Task 1: 前端测试、查询与 API 契约基座

**Files:**
- Modify: `moneyToTipApp/package.json`
- Modify: `moneyToTipApp/package-lock.json`
- Create: `moneyToTipApp/vitest.config.ts`
- Create: `moneyToTipApp/src/test/setup.ts`
- Create: `moneyToTipApp/src/test/render.tsx`
- Create: `moneyToTipApp/src/test/factories.ts`
- Create: `moneyToTipApp/src/api/schema.d.ts`
- Modify: `moneyToTipApp/src/api/client.ts`
- Modify: `moneyToTipApp/src/api/types.ts`
- Modify: `moneyToTipApp/src/main.tsx`
- Test: `moneyToTipApp/src/api/client.test.ts`

**Interfaces:**
- Produces: `ApiError` with `kind: "network" | "auth" | "validation" | "conflict" | "server"` and `status: number | null`.
- Produces: `api<T>(path: string, options?: ApiOptions) => Promise<T>`；401 先派发 `mtt:reauth`，再抛 `ApiError`。
- Produces: `queryClient: QueryClient`；查询默认不缓存写操作结果，失败请求不自动连续重试。
- Produces: `renderAt(route: string)`、`dueQuestion(id: number)` 测试工具。
- Produces: `npm run test`、`npm run test:coverage`、`npm run api:generate`。

- [x] **Step 1: 安装依赖并建立测试脚本**

```bash
cd moneyToTipApp
npm install @tanstack/react-query
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom openapi-typescript
```

`package.json` 增加：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "api:generate": "openapi-typescript http://127.0.0.1:8000/openapi.json -o src/api/schema.d.ts",
    "api:check": "npm run api:generate && git diff --exit-code -- src/api/schema.d.ts"
  }
}
```

`vitest.config.ts`：

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
```

`src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

- [x] **Step 2: 为错误分类与 401 行为写失败测试**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setToken } from "./client";

afterEach(() => localStorage.clear());

describe("api", () => {
  it("classifies network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const error = await api("/reviews/due").catch((value: unknown) => value);
    expect(error).toMatchObject({ kind: "network", status: null });
  });

  it("keeps the current question recoverable on authentication expiry", async () => {
    setToken("expired");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const reauth = vi.fn();
    window.addEventListener("mtt:reauth", reauth, { once: true });
    const error = await api("/reviews").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "auth", status: 401 });
    expect(reauth).toHaveBeenCalledOnce();
  });
});
```

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL，因为 `ApiError` 和错误分类尚未实现。

- [x] **Step 3: 实现统一错误并接入 QueryClient**

`src/api/client.ts` 保留现有 token 键 `mtt_token`，实现以下公开类型；网络异常不得伪装成空数组：

```ts
export type ApiErrorKind = "network" | "auth" | "validation" | "conflict" | "server";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorKind(status: number): ApiErrorKind {
  if (status === 401) return "auth";
  if (status === 409) return "conflict";
  if (status === 422 || status === 400) return "validation";
  return "server";
}
```

在 `src/main.tsx` 用 `QueryClientProvider` 包住 `<App />`，并设置：

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
```

- [x] **Step 4: 生成契约并运行基座回归**

启动后端后执行：

```bash
npm run api:generate
npm test
npm run build
```

Expected: 两项 API 测试通过，TypeScript 与生产构建通过；`StudyStatus` 改为 `"new" | "learning" | "review" | "relearning"`，`DueQuestion` 包含服务端 `rating_previews`，`ReviewResult` 包含 `decision`。

- [x] **Step 5: 提交基座**

```bash
git add moneyToTipApp
git commit -m "test: add app API and query foundation"
```

### Task 2: 可恢复的复习会话状态机

**Files:**
- Create: `moneyToTipApp/src/features/review/session.ts`
- Create: `moneyToTipApp/src/features/review/snapshot.ts`
- Create: `moneyToTipApp/src/features/review/api.ts`
- Test: `moneyToTipApp/src/features/review/session.test.ts`
- Test: `moneyToTipApp/src/features/review/snapshot.test.ts`

**Interfaces:**
- Produces: `ReviewSessionState`、`ReviewEvent`、`initialReviewSession`、`reviewReducer`。
- Produces: `loadReviewSnapshot(userId: number)`、`saveReviewSnapshot(userId: number, state: ReviewSessionState)`、`clearReviewSnapshot()`。
- Produces: `submitReview(payload: ReviewSubmit) => Promise<ReviewResult>`，不改变 `client_id`。
- `ReviewPhase` 仅允许 `loading | answering | rating | submitting | submitted | failed | complete`。

- [x] **Step 1: 写提交、失败、重试和重学队列测试**

```ts
import { describe, expect, it } from "vitest";
import { initialReviewSession, reviewReducer } from "./session";
import { dueQuestion } from "../../test/factories";

describe("reviewReducer", () => {
  it("does not advance when submission fails and retries the same client id", () => {
    const question = dueQuestion(7);
    const answering = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [question], planId: 3,
    });
    const rating = reviewReducer(answering, { type: "ANSWER_REVEALED", answer: "my answer" });
    const submitting = reviewReducer(rating, {
      type: "RATE", rating: "good", clientId: "stable-key", now: 1000,
    });
    const failed = reviewReducer(submitting, { type: "SUBMIT_FAILED", message: "offline" });
    expect(failed.current?.id).toBe(7);
    expect(failed.pendingSubmission?.client_id).toBe("stable-key");
    const retrying = reviewReducer(failed, { type: "RETRY" });
    expect(retrying.pendingSubmission?.client_id).toBe("stable-key");
    expect(retrying.phase).toBe("submitting");
  });

  it("moves an again rating to the session relearning queue", () => {
    const first = dueQuestion(1);
    const second = dueQuestion(2);
    let state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [first, second], planId: null,
    });
    state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: "" });
    state = reviewReducer(state, { type: "RATE", rating: "again", clientId: "again-1", now: 1000 });
    state = reviewReducer(state, { type: "SUBMIT_SUCCEEDED", result: {
      log_id: 9, idempotent: false, state: first.state,
      decision: { interval_minutes: 10, due_at: "2026-11-25T00:10:00Z", algorithm_version: "ebbinghaus-v1" },
    } });
    state = reviewReducer(state, { type: "NEXT" });
    expect(state.current?.id).toBe(2);
    expect(state.relearningQueue.map((question) => question.id)).toEqual([1]);
  });
});
```

Run: `npm test -- src/features/review/session.test.ts`
Expected: FAIL，因为状态机文件不存在。

- [x] **Step 2: 实现纯 reducer 与幂等提交载荷**

状态必须显式保存以下数据，禁止再用互相独立的 ref 推导提交状态：

```ts
export interface PendingSubmission extends ReviewSubmit {
  client_id: string;
}

export interface ReviewSessionState {
  phase: "loading" | "answering" | "rating" | "submitting" | "submitted" | "failed" | "complete";
  queue: DueQuestion[];
  current: DueQuestion | null;
  relearningQueue: DueQuestion[];
  answer: string;
  planId: number | null;
  pendingSubmission: PendingSubmission | null;
  error: string;
  shownAt: number;
}

export const initialReviewSession: ReviewSessionState = {
  phase: "loading", queue: [], current: null, relearningQueue: [], answer: "",
  planId: null, pendingSubmission: null, error: "", shownAt: 0,
};
```

`RATE` 一次性生成并保存载荷；`SUBMIT_FAILED` 只改变 `phase/error`；`RETRY` 不触碰载荷；只有 `SUBMIT_SUCCEEDED` 允许进入 `submitted`；`NEXT` 优先消费原队列，再消费 `relearningQueue`，最后进入 `complete`。

- [x] **Step 3: 实现版本化快照并验证退出清除**

快照键固定为 `mtt_review_snapshot_v2`，内容包含 `userId` 和 `state`。解析时验证 `version === 2`、用户一致、当前题属于队列；损坏 JSON 返回 `null`。测试必须覆盖刷新恢复、不同用户隔离和退出清除：

```ts
expect(loadReviewSnapshot(4)).toEqual(savedState);
saveReviewSnapshot(4, savedState);
clearReviewSnapshot();
expect(loadReviewSnapshot(4)).toBeNull();
expect(localStorage.getItem("mtt_token")).toBeNull();
```

- [x] **Step 4: 运行状态机与既有后端幂等回归**

```bash
cd moneyToTipApp && npm test -- src/features/review
cd ../moneyToTip && uv run --frozen pytest tests/test_schedule.py -q
```

Expected: 前端状态机测试通过；后端既有幂等与排期测试保持通过。

- [x] **Step 5: 提交会话单元**

```bash
git add moneyToTipApp/src/features/review moneyToTipApp/src/test
git commit -m "feat: add recoverable review session state"
```

### Task 3: 设计令牌、基础组件与四栏导航

**Files:**
- Create: `moneyToTipApp/src/styles/tokens.css`
- Modify: `moneyToTipApp/src/styles/global.css`
- Create: `moneyToTipApp/src/components/ui/Button.tsx`
- Create: `moneyToTipApp/src/components/ui/Button.module.css`
- Create: `moneyToTipApp/src/components/ui/Card.tsx`
- Create: `moneyToTipApp/src/components/ui/Feedback.tsx`
- Create: `moneyToTipApp/src/components/ui/Sheet.tsx`
- Create: `moneyToTipApp/src/components/ui/Toast.tsx`
- Create: `moneyToTipApp/src/components/AppShell.tsx`
- Modify: `moneyToTipApp/src/components/TabBar.tsx`
- Modify: `moneyToTipApp/src/App.tsx`
- Test: `moneyToTipApp/src/components/ui/Button.test.tsx`
- Test: `moneyToTipApp/src/components/AppShell.test.tsx`

**Interfaces:**
- Produces: `Button` variants `primary | secondary | danger | ghost`，支持 `loading` 和 `disabled`。
- Produces: `Skeleton`、`EmptyState`、`ErrorState`、`Sheet`、`Toast`。
- Produces: 主导航 `/today`、`/library`、`/add`、`/me`；`/review` 和 `/insights` 不显示底部导航。

- [x] **Step 1: 写可访问性与导航测试**

```tsx
it("blocks duplicate activation while loading", async () => {
  const onClick = vi.fn();
  render(<Button loading onClick={onClick}>保存</Button>);
  expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "保存中" }));
  expect(onClick).not.toHaveBeenCalled();
});

it("uses four primary destinations and hides chrome in focus mode", () => {
  renderAt("/today");
  expect(screen.getAllByRole("link")).toHaveLength(4);
  renderAt("/review");
  expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
});
```

Run: `npm test -- src/components`
Expected: FAIL，因为新组件和路由尚不存在。

- [x] **Step 2: 建立纸张、墨色、暖色品牌令牌**

`tokens.css` 至少定义下列稳定变量，页面不得再各自硬编码同类值：

```css
:root {
  --color-canvas: #f4f1ea;
  --color-surface: #fbf9f4;
  --color-ink: #292721;
  --color-muted: #777268;
  --color-line: #cfc9ba;
  --color-accent: #a34d2d;
  --color-success: #426b4b;
  --color-danger: #a43f3f;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-card: 18px;
  --duration-fast: 150ms;
  --duration-normal: 220ms;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

- [x] **Step 3: 实现组件和路由壳**

`Button` 在 `loading` 时同时设置 `disabled`、`aria-busy="true"` 和可读文本“保存中”；`ErrorState` 必须提供显式重试按钮；`Sheet` 在移动端全屏并支持 Escape 关闭。`AppShell` 根据路由隐藏专注模式导航，登录页不渲染应用壳。

- [x] **Step 4: 验证 360px 与生产构建**

```bash
npm test -- src/components
npm run build
```

Expected: 组件测试通过；构建通过；后续 Playwright 中 360px 页面无横向溢出。

- [x] **Step 5: 提交视觉基座**

```bash
git add moneyToTipApp/src moneyToTipApp/package.json moneyToTipApp/package-lock.json
git commit -m "feat: add mobile app design system"
```

### Task 4: 专注复习页与真实评分预览

**Files:**
- Modify: `moneyToTipApp/src/pages/ReviewPage.tsx`
- Create: `moneyToTipApp/src/features/review/ReviewRatingBar.tsx`
- Create: `moneyToTipApp/src/features/review/useReviewSession.ts`
- Modify: `moneyToTipApp/src/components/FeedbackPanel.tsx`
- Modify: `moneyToTipApp/src/components/ExplainPanel.tsx`
- Test: `moneyToTipApp/src/pages/ReviewPage.test.tsx`

**Interfaces:**
- Consumes: `reviewReducer`、`submitReview`、`DueQuestion.rating_previews`、`ReviewResult.decision`。
- Produces: `formatInterval(minutes: number) => string`，分钟/小时/天展示来自真实 API。
- Produces: 网络失败内联文案“结果尚未保存”及“重试”；提交中评分和下一题全部禁用。

- [x] **Step 1: 写页面级失败与恢复测试**

使用 MSW 或可控 fetch mock 返回两道到期题；第一题 `rating_previews.good.interval_minutes = 234`。测试：

```tsx
expect(screen.getByRole("button", { name: /记得/ })).toHaveTextContent("4 小时");
await user.click(screen.getByRole("button", { name: /记得/ }));
expect(screen.getByRole("button", { name: /记得/ })).toBeDisabled();
await screen.findByText("结果尚未保存");
expect(screen.getByRole("heading", { name: firstQuestion.stem })).toBeVisible();
await user.click(screen.getByRole("button", { name: "重试" }));
expect(requests[1].client_id).toBe(requests[0].client_id);
await user.click(screen.getByRole("button", { name: "下一题" }));
expect(screen.getByRole("heading", { name: secondQuestion.stem })).toBeVisible();
```

另写 401 用例：保存快照后进入登录页，重新登录恢复同一题；队列失败用例必须保留旧题而不是展示“今日完成”。

- [x] **Step 2: 运行并确认 RED**

Run: `npm test -- src/pages/ReviewPage.test.tsx`
Expected: 旧页面静默吞掉提交失败，测试在“结果尚未保存”断言失败。

- [x] **Step 3: 接入 reducer、快照与评分组件**

`useReviewSession` 负责 Query 拉取和 Mutation 提交，reducer 只处理状态。评分条固定使用以下顺序和文案：

```tsx
const ratings = [
  { value: "again", label: "忘记", key: "1" },
  { value: "hard", label: "困难", key: "2" },
  { value: "good", label: "记得", key: "3" },
  { value: "easy", label: "轻松", key: "4" },
] as const;
```

每个按钮展示 `question.rating_previews[value]` 的间隔。数字键 1–4 仅在 `rating` 阶段生效，Enter 只在可进入下一题时生效；输入框内不得触发全局快捷键。AI 面板失败只更新面板自身，不改变复习状态机。

- [x] **Step 4: 运行复习全链路组件测试**

```bash
npm test -- src/features/review src/pages/ReviewPage.test.tsx
npm run build
```

Expected: 成功、失败、重试、刷新恢复、401 恢复、重复点击和重学队列测试全部通过。

- [x] **Step 5: 提交专注复习体验**

```bash
git add moneyToTipApp/src
git commit -m "feat: redesign reliable focus review"
```

### Task 5: 今日首页、未来负荷与服务端计划偏好

**Files:**
- Create: `moneyToTip/mtt/alembic/versions/0003_user_preferences.py`
- Modify: `moneyToTip/mtt/identity/models.py`
- Modify: `moneyToTip/mtt/schedule/plans.py`
- Modify: `moneyToTip/mtt/growth/router.py`
- Create: `moneyToTipApp/src/pages/TodayPage.tsx`
- Create: `moneyToTipApp/src/features/today/LoadForecast.tsx`
- Modify: `moneyToTipApp/src/pages/PlansPage.tsx`
- Test: `moneyToTip/tests/test_plans.py`
- Test: `moneyToTip/tests/test_growth.py`
- Test: `moneyToTipApp/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Produces: `GET /api/v1/plans/active -> { plan_ids: number[] }`。
- Produces: `PUT /api/v1/plans/active`，请求 `{ plan_ids: number[] }`，过滤不属于当前用户的 ID 时返回 404，成功原子替换偏好。
- Produces: `GET /api/v1/stats/today`，返回 `due_count`、`new_count`、`relearning_count`、`completed_count`、`goal_count`、`goal_met`、`estimated_minutes: number | null` 和 7 天 `forecast`。
- 预计耗时仅在至少有 5 条带非零 `duration_ms` 的历史记录时返回中位数估算，否则为 `null`。

- [x] **Step 1: 写跨设备偏好和今日口径测试**

后端测试创建两个用户、两个计划和跨日复习日志，验证：

```python
response = client.put("/api/v1/plans/active", json={"plan_ids": [plan.id]}, headers=auth)
assert response.status_code == 200
assert client.get("/api/v1/plans/active", headers=auth).json() == {"plan_ids": [plan.id]}
assert client.get("/api/v1/plans/active", headers=other_auth).json() == {"plan_ids": []}
```

今日接口必须按不同题目计数，重学不重复增加 `completed_count`；到期题不足时 `goal_met` 为 `false`，并返回明确的 `shortage_reason: "not_enough_due_questions" | null`。

- [x] **Step 2: 添加 Alembic 偏好表与聚合接口**

新增 `UserPreference`：`(user_id, key)` 唯一，`value` 存 JSON 字符串。迁移只负责新表；在 `plans.py` 实现事务替换，在 `growth/router.py` 用现有 `QuestionState`、`ReviewLog` 和 `Plan` 聚合今日数据。禁止复制 `memory.py` 的排期公式。

- [x] **Step 3: 写今日页面加载、空态和真实不足状态**

```tsx
expect(screen.getByRole("button", { name: "继续今日复习" })).toBeVisible();
expect(screen.getByText("12 / 20")).toBeVisible();
expect(screen.getByText("到期题不足")).toBeVisible();
expect(screen.queryByText(/预计 .* 分钟/)).not.toBeInTheDocument();
```

页面首屏只允许“继续今日复习”一个主按钮；今日完成时提供“加练”和“导入题目”次操作；未来 7 天负荷与“记忆洞察”使用真实接口数据并可点击进入对应列表。

- [x] **Step 4: 迁移计划页并执行全量回归**

移除 `mtt_active_plans` 的事实源地位，以 `/plans/active` Query 和 Mutation 替代。运行：

```bash
cd moneyToTip && uv run --frozen pytest tests/test_plans.py tests/test_growth.py tests/test_migrations.py -q
cd ../moneyToTipApp && npm test -- src/pages/TodayPage.test.tsx src/pages/PlansPage.test.tsx
```

Expected: 跨设备偏好、唯一题目进度、加载/空态/错误态和到期不足测试通过。

- [x] **Step 5: 提交今日体验**

```bash
git add moneyToTip moneyToTipApp
git commit -m "feat: add truthful today dashboard"
```

### Task 6: 题库、待确认与安全题目操作

**Files:**
- Create: `moneyToTipApp/src/pages/LibraryPage.tsx`
- Create: `moneyToTipApp/src/features/library/QuestionList.tsx`
- Create: `moneyToTipApp/src/features/library/QuestionEditorSheet.tsx`
- Create: `moneyToTipApp/src/features/library/BulkConfirmBar.tsx`
- Modify: `moneyToTipApp/src/pages/PendingPage.tsx`
- Modify: `moneyToTipApp/src/components/QuestionForm.tsx`
- Modify: `moneyToTip/mtt/corpus/router.py`
- Create: `moneyToTip/mtt/corpus/validation.py`
- Test: `moneyToTip/tests/test_questions.py`
- Test: `moneyToTipApp/src/pages/LibraryPage.test.tsx`

**Interfaces:**
- Consumes: 现有 `/questions` 搜索、分页、状态筛选和 `/questions/{id}` 编辑接口。
- Produces: `POST /api/v1/questions/bulk-confirm`，请求 `{ ids: number[] }`，响应 `{ confirmed_ids: number[], failures: { id: number, reason: string }[] }`。
- 有复习日志的题执行 DELETE 返回 409，并提示改用 `/suspend`；无复习日志的题允许删除。
- Produces: 题库统一状态筛选 `pending | active | flagged | suspended`，待确认不再是孤立主导航。

- [x] **Step 1: 写批量确认和安全删除后端测试**

```python
def test_delete_question_with_history_requires_suspend(client, auth, reviewed_question):
    response = client.delete(f"/api/v1/questions/{reviewed_question.id}", headers=auth)
    assert response.status_code == 409
    assert "suspend" in response.json()["detail"]


def test_bulk_confirm_keeps_invalid_items_pending(client, auth, valid_pending, missing_answer_pending):
    response = client.post("/api/v1/questions/bulk-confirm",
                           json={"ids": [valid_pending.id, missing_answer_pending.id]}, headers=auth)
    assert response.json()["confirmed_ids"] == [valid_pending.id]
    assert response.json()["failures"] == [{"id": missing_answer_pending.id, "reason": "答案不能为空"}]
```

- [x] **Step 2: 实现事务明确的批量校验与删除保护**

`validation.py` 提供 `validate_question(question: Question) -> list[str]`，至少校验题面、答案、选择题有效选项和来源说明。批量确认逐题返回失败原因，单题失败不得把其他成功项回滚；删除检查当前用户该题的 `ReviewLog`，有历史时返回 409。

- [x] **Step 3: 写题库搜索、选择和未保存提醒测试**

```tsx
await user.type(screen.getByRole("searchbox", { name: "搜索题目" }), "事务");
expect(await screen.findByRole("heading", { name: "事务与隔离" })).toBeVisible();
await user.click(screen.getByRole("checkbox", { name: /选择事务与隔离/ }));
expect(screen.getByText("已选 1 项")).toBeVisible();
await user.click(screen.getByRole("button", { name: "批量确认" }));
expect(screen.getByText("1 道已确认，1 道需要修正")).toBeVisible();
```

编辑器在移动端使用全屏 `Sheet`；脏表单关闭时弹出确认 Dialog，不使用原生 `alert` 或 `confirm`。

- [x] **Step 4: 运行题库和既有数据回归**

```bash
cd moneyToTip && uv run --frozen pytest tests/test_questions.py tests/test_data.py -q
cd ../moneyToTipApp && npm test -- src/pages/LibraryPage.test.tsx
```

Expected: 搜索、筛选、批量确认、部分失败、编辑校验、暂停和删除保护全部通过。

- [x] **Step 5: 提交题库体验**

```bash
git add moneyToTip/mtt/corpus moneyToTip/tests/test_questions.py moneyToTipApp/src
git commit -m "feat: unify library and pending review"
```

### Task 7: 可解释的记忆洞察

**Files:**
- Modify: `moneyToTip/mtt/growth/router.py`
- Create: `moneyToTip/mtt/growth/insights.py`
- Create: `moneyToTipApp/src/pages/InsightsPage.tsx`
- Create: `moneyToTipApp/src/features/insights/RetentionSummary.tsx`
- Create: `moneyToTipApp/src/features/insights/WeakTopics.tsx`
- Modify: `moneyToTipApp/src/App.tsx`
- Test: `moneyToTip/tests/test_growth.py`
- Test: `moneyToTipApp/src/pages/InsightsPage.test.tsx`

**Interfaces:**
- Produces: `GET /api/v1/stats/insights?days=30`。
- Response: `retention: { recalled: number, total: number, rate: number | null }`、`learning_count`、`review_count`、`recovered_count`、`forecast`、`weak_categories`。
- `recalled` 仅统计非 `again` 且非 AI 求助的有效日志；`total < 20` 时 `rate` 必须为 `null`。
- `recovered_count` 统计窗口内先 `again`、随后 `good/easy` 的不同题目数。

- [x] **Step 1: 写真实保持率和小样本测试**

```python
def test_retention_hides_percentage_below_twenty_reviews(client, auth, nineteen_logs):
    data = client.get("/api/v1/stats/insights?days=30", headers=auth).json()
    assert data["retention"] == {"recalled": 15, "total": 19, "rate": None}


def test_retention_excludes_help_and_counts_distinct_recovery(client, auth, twenty_logs):
    data = client.get("/api/v1/stats/insights?days=30", headers=auth).json()
    assert data["retention"] == {"recalled": 16, "total": 20, "rate": 0.8}
    assert data["recovered_count"] == 2
```

- [x] **Step 2: 实现独立聚合函数并验证**

`insights.py` 提供 `memory_insights(session: Session, user_id: int, days: int, now: datetime) -> dict`，所有时间边界复用 `mtt.timeutil`，不得在 SQL 之外改写评分语义。`weak_categories` 必须携带可跳转的 `category_id`、实际保持率、样本量和到期题数。

- [x] **Step 3: 实现页面口径与下钻**

小样本展示“15 / 19 次回忆成功”和“再完成 1 次有效复习后显示保持率”，不得显示 `78.9%`。每个数字可进入对应题目列表；页面提供“数据口径与排期说明”，展示 `R(t) = exp(-t/S)` 是排期近似，不承诺记忆效果。

- [x] **Step 4: 运行洞察与全量后端回归**

```bash
cd moneyToTip && uv run --frozen pytest -q
cd ../moneyToTipApp && npm test -- src/pages/InsightsPage.test.tsx
```

Expected: 后端全量测试通过；小样本、保持率、恢复、薄弱分类下钻和空态测试通过。

- [x] **Step 5: 提交记忆洞察**

```bash
git add moneyToTip/mtt/growth moneyToTip/tests/test_growth.py moneyToTipApp/src
git commit -m "feat: explain memory retention and workload"
```

### Task 8: 普通用户登录、首次引导与会话恢复

**Files:**
- Modify: `moneyToTip/mtt/identity/router.py`
- Create: `moneyToTip/mtt/identity/onboarding.py`
- Modify: `moneyToTipApp/src/pages/LoginPage.tsx`
- Create: `moneyToTipApp/src/pages/OnboardingPage.tsx`
- Modify: `moneyToTipApp/src/App.tsx`
- Modify: `moneyToTipApp/src/pages/MePage.tsx`
- Test: `moneyToTip/tests/test_identity.py`
- Test: `moneyToTipApp/src/pages/LoginPage.test.tsx`
- Test: `moneyToTipApp/src/pages/OnboardingPage.test.tsx`

**Interfaces:**
- `POST /api/v1/identity/login` 允许 active 的 `admin` 和 `user`，响应保持 `{ token, username, role }`；管理端仍在路由层拒绝非 admin。
- Produces: `POST /api/v1/identity/onboarding/sample`，为当前无题用户幂等创建示例题库和 3 道题，响应 `{ bank_id: number, question_ids: number[] }`。
- 登录前保留复习快照；新登录用户与快照用户不一致时不得恢复旧会话；退出登录同时清除 token 和快照。

- [x] **Step 1: 写普通用户登录和示例幂等测试**

```python
def test_user_can_login_to_app(client, ordinary_user):
    response = client.post("/api/v1/identity/login",
                           json={"username": ordinary_user.username, "password": "correct-password"})
    assert response.status_code == 200
    assert response.json()["role"] == "user"


def test_sample_onboarding_is_idempotent(client, auth):
    first = client.post("/api/v1/identity/onboarding/sample", headers=auth).json()
    second = client.post("/api/v1/identity/onboarding/sample", headers=auth).json()
    assert second == first
    assert len(first["question_ids"]) == 3
```

- [x] **Step 2: 实现登录和事务化示例数据**

登录失败继续使用统一 401 文案；禁用账户返回 403。示例创建先检查当前用户是否已有示例题库，重复请求返回原 ID，不重复插题。示例题必须标记明确来源“忙里偷题示例”，不得伪装成用户材料。

- [x] **Step 3: 重做登录和首次会话**

登录页使用用户名/密码，不要求粘贴 token；提交中禁用按钮并显示错误。无题用户登录后进入引导，可“一键体验 3 道示例题”或“先导入自己的题”；已有题用户直接进入 `/today`。登录后根据 `/identity/me` 的 `id` 恢复快照。

- [x] **Step 4: 验证账户与恢复回归**

```bash
cd moneyToTip && uv run --frozen pytest tests/test_identity.py tests/test_schedule.py -q
cd ../moneyToTipApp && npm test -- src/pages/LoginPage.test.tsx src/pages/OnboardingPage.test.tsx src/pages/ReviewPage.test.tsx
```

Expected: 普通用户登录、示例幂等、401 恢复、跨用户快照隔离和退出清理测试通过。

- [x] **Step 5: 提交首次使用体验**

```bash
git add moneyToTip/mtt/identity moneyToTip/tests/test_identity.py moneyToTipApp/src
git commit -m "feat: add password login and guided first review"
```

### Task 9: 管理端真实路由与按需加载

**Files:**
- Modify: `moneyToTipConsole/package.json`
- Modify: `moneyToTipConsole/package-lock.json`
- Modify: `moneyToTipConsole/src/main.tsx`
- Modify: `moneyToTipConsole/src/App.tsx`
- Create: `moneyToTipConsole/src/routes.tsx`
- Create: `moneyToTipConsole/vitest.config.ts`
- Create: `moneyToTipConsole/src/test/setup.ts`
- Test: `moneyToTipConsole/src/App.test.tsx`

**Interfaces:**
- Produces: `/dashboard`、`/banks`、`/questions`、`/categories`、`/users`、`/data`、`/anki` 的 HashRouter 路由。
- Produces: 刷新后保持当前页面；仪表盘跳题库的 `status` 和 `bank` 使用 search params。
- Produces: `React.lazy` 分割 Markdown 编辑器、账户、数据和 Anki 页面。

- [x] **Step 1: 安装路由并写刷新位置测试**

```bash
cd moneyToTipConsole
npm install react-router-dom
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

`package.json` 增加 `"test": "vitest run"`；`vitest.config.ts` 使用 React 插件、`jsdom` 环境和 `src/test/setup.ts`，setup 文件导入 `@testing-library/jest-dom/vitest`。测试在 `#/questions?status=pending&bank=2` 渲染后断言题目页和筛选值存在；点击账户后断言 URL 变为 `#/users`，重新渲染仍停留在账户页。

- [x] **Step 2: 将页面状态迁移到路由并懒加载**

`App.tsx` 不再用 `PageKey` 状态切换内容；`routes.tsx` 集中声明路由。懒加载统一形式：

```tsx
const UsersPage = lazy(() => import("./pages/UsersPage"));
const DataPage = lazy(() => import("./pages/DataPage"));
const AnkiPage = lazy(() => import("./pages/AnkiPage"));
```

使用 Ant Design `Spin` 作为 Suspense fallback，保持当前纸张/墨色样式，不扩展管理端重设计范围。

- [x] **Step 3: 验证路由与构建**

```bash
npm test
npm run build
```

Expected: 路由测试和生产构建通过，构建产物包含按需页面 chunk。

- [x] **Step 4: 提交管理端配套改造**

```bash
git add moneyToTipConsole
git commit -m "refactor: add persistent console routes"
```

### Task 10: 核心 E2E、视觉回归与发布验收

**Files:**
- Modify: `moneyToTipApp/package.json`
- Modify: `moneyToTipApp/package-lock.json`
- Create: `moneyToTipApp/playwright.config.ts`
- Create: `moneyToTipApp/e2e/review-recovery.spec.ts`
- Create: `moneyToTipApp/e2e/core-pages.spec.ts`
- Create: `moneyToTipApp/e2e/visual.spec.ts`
- Create: `moneyToTipApp/e2e/fixtures.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm run test:e2e`、`npm run test:visual`。
- Produces: 360px、768px、1440px 的今日、复习、题库和洞察截图基线。
- Produces: 登录 → 示例题 → 复习 → 网络失败 → 重试 → 下一题 → 刷新恢复的确定性 E2E。

- [x] **Step 1: 安装 Playwright 并建立隔离测试环境**

```bash
cd moneyToTipApp
npm install -D @playwright/test
npx playwright install chromium
```

由 `e2e/fixtures.ts` 为每个测试启动独立的 FastAPI 与 Vite 实例，使用动态端口和独立临时 SQLite，并在 `finally` 中清理进程；禁止连接开发数据库。脚本：

```json
{
  "scripts": {
    "test:e2e": "playwright test e2e/review-recovery.spec.ts e2e/core-pages.spec.ts",
    "test:visual": "playwright test e2e/visual.spec.ts"
  }
}
```

- [x] **Step 2: 写失败重试与刷新恢复 E2E**

测试通过 Playwright 的 `page.route` 拦截复习 POST：第一个处理函数调用 `route.abort("failed")`，第二个处理函数记录请求体并 `route.fulfill` 返回服务端结果；断言两次 `client_id` 相同、失败时题面不变、成功后才能下一题。刷新后从快照恢复第二题，并确认服务端只有一条第一题复习日志。

- [x] **Step 3: 写核心页面和视觉回归**

核心链路覆盖：普通用户登录、示例题、今日进度、题库搜索、批量确认、洞察小样本。视觉测试固定系统时间、时区 `Asia/Shanghai` 和动画禁用，分别使用：

```ts
const viewports = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
];
```

每个视口断言 `document.documentElement.scrollWidth <= window.innerWidth`，移动端主评分按钮触控区域至少 44px。

- [x] **Step 4: 执行完整发布验收**

```bash
cd moneyToTip && uv run --frozen pytest -q
cd ../moneyToTipApp && npm test && npm run build && npm run test:e2e && npm run test:visual
cd ../moneyToTipConsole && npm test && npm run build
```

Expected: 所有测试和构建通过；360px 无横向溢出；断网不丢答案、不重复写日志；普通用户无需 CLI 或 token 即可完成第一道复习；保持率均带样本量。

- [x] **Step 5: 更新文档并提交发布候选**

README 只写已落地能力，更新启动、测试与页面入口；将设计文档状态改为“已实现”前必须逐项核对验收标准。

```bash
git add README.md docs moneyToTipApp moneyToTipConsole
git commit -m "test: verify complete memory learning experience"
```

## Spec Coverage and Release Gates

- 复习提交、重试、刷新与 401 恢复：Task 1、2、4、10。
- 会话内重学、分钟级评分预览和排期解释：Task 2、4。
- 设计令牌、组件、四栏导航与移动端适配：Task 3、10。
- 今日、真实到期不足、未来负荷和服务端计划偏好：Task 5。
- 题库、待确认、批量校验、编辑与安全暂停：Task 6。
- 实际保持率、样本量、遗忘恢复和薄弱内容下钻：Task 7。
- 普通用户登录、首次示例和退出清理：Task 8。
- 管理端真实路由和按需加载：Task 9。
- 全量后端、组件、E2E、三视口视觉验收：Task 10。

## Completion Record

- 全部 10 项任务、49 个 Step 已完成。
- 2026-11-26 最终验收：后端 **83 项**、学习端组件 **40 项**、管理端路由 **3 项**、核心 E2E **3 项**、三视口视觉测试 **3 项**全部通过；两个前端生产构建成功。
- 发布候选提交：`91159b1 test: verify complete memory learning experience`。
- 后续内容供应链、离线作答或 FSRS 工作应另建计划，不重新打开本计划。