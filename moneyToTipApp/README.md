# 忙里偷题 · App（复习端）

> Small tips, big steps.

React 18 + TypeScript + Vite + PWA。消费 moneyToTip 服务端（FastAPI）的 `/api/v1`，
可独立开发、构建与部署。

## 开发

```bash
npm install
npm run dev      # http://localhost:5173/app/（/api 代理到 127.0.0.1:8000）
```

前提：服务端已启动（`mtt serve`，见 moneyToTip 工程）。

## 生产

```bash
npm run build    # 产物 dist/，由服务端挂在 /app/，或任意静态托管
```

## 结构

- `src/api/` — API 客户端 + 契约类型（与 moneyToTip 服务端对齐）
- `src/features/` — 复习会话状态机与快照、今日计划、未来负荷、题库批量确认、记忆洞察组件
- `src/pages/` — 今日 / 专注复习 / 学习计划 / 题库 / 导入 / 记忆洞察 / 我的 / 登录 / 首次引导
- `src/components/` — QuestionCard / AnswerArea / FeedbackPanel / CategorySelect 等

管理端是独立工程 [moneyToTipConsole](../moneyToTipConsole)（`/console/`，账号密码登录）。

设计约束：5 层视觉层级、术语黑名单（新学/巩固中/已掌握）、打开即一道题、
判定零模型成本。
