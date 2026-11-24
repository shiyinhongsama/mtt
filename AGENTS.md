# AGENTS.md

本文件约束仓库根目录及全部子目录。先读本文件，再改代码；让可验证结果代替推测。

## 1. 仓库地图

这是**单一 Git 仓库、三应用 monorepo**，子目录不是独立仓库。

| 路径 | 职责 | 技术栈 |
|---|---|---|
| `moneyToTip/` | API、CLI、迁移、产品主页 | Python ≥3.12 · FastAPI · SQLModel · SQLite · Alembic · Typer |
| `moneyToTipApp/` | 移动端优先的学习 PWA | React 18 · TypeScript · Vite · vite-plugin-pwa |
| `moneyToTipConsole/` | 管理后台 | React 18 · TypeScript · Ant Design 5 |
| `docs/superpowers/specs/` | 已确认的产品与技术设计 | Markdown |
| `docs/superpowers/plans/` | 可执行实施计划 | Markdown |

后端按能力拆分：`identity` 账户、`corpus` 题库、`schedule` 排期、`growth` 统计、`data` 备份、`anki` 导入、`capture/generate/explain` 内容与 AI。路由统一经 `mtt/api/router.py` 挂到 `/api/v1`。

## 2. 常用命令

命令分别在对应目录执行；不要把一个应用的依赖或脚本装进另一个应用。

```bash
# 后端
cd moneyToTip
uv sync --frozen
uv run mtt init-db
uv run mtt user-create admin --admin --password '<local-only-password>'
uv run mtt serve                         # http://127.0.0.1:8000
uv run --frozen pytest -q

# 学习 PWA；开发端口 5173，/api 代理到 8000
cd moneyToTipApp
npm ci
npm run dev
npm run build

# 管理后台；开发端口 5174
cd moneyToTipConsole
npm ci
npm run dev
npm run build

# 单容器联调；数据在 Docker 卷 mt-data
docker compose up -d --build
docker compose logs -f
```

当前 App 与 Console 尚无前端测试脚本；实施体验重设计计划后再加入并运行 `npm test`、E2E 和视觉回归。不要声称未执行的检查已经通过。

## 3. 不可破坏的学习语义

- **服务端是唯一事实源**：只有复习 API 成功返回，才能展示“已保存”、增加进度或进入下一题。
- **幂等重试**：同一回答重试复用原 `client_id`；重复请求不得新增日志或推进两次排期。
- **失败必须可见**：网络失败保留题面、答案和评分；队列失败不得用空数组伪装“今日完成”。
- **每日进度去重**：按计划范围内当日首次完成的不同题目数计算；重学和 AI 求助不重复计数。
- **会话内重学**：`again` 安排 10 分钟后到期，同时进入当前会话末尾；无其他到期题时允许立即重学。
- **快照最小化**：只存当前复习所需状态；按用户隔离；退出登录清除 token 与快照。
- **AI 不阻塞学习**：讲题失败不影响复习提交；AI 求助记日志但不改排期。
- **历史不可孤立**：已有学习记录的题只能暂停，不能物理删除；导入、导出和迁移必须事务化。

## 4. 记忆引擎约束

排期唯一入口是 `moneyToTip/mtt/schedule/memory.py`，算法版本为 `ebbinghaus-v1`。

```text
R(t) = exp(-t / S)
interval = -S × ln(target_retention)
```

- 默认目标保持率 `0.85`；评分仅 `again | hard | good | easy`。
- 最短间隔 10 分钟，最长 365 天；`due_at` 使用带时区 UTC 时间。
- 每用户每题状态由 `(user_id, question_id)` 唯一约束保护。
- 新算法参数必须增加版本；不得改写历史日志中的决策快照。
- “保持率”来自真实复习日志；模型预测只用于排期，不得冒充实际效果或承诺记忆结果。
- 修改排期时至少运行 `tests/test_memory.py`、`test_schedule.py`、`test_plans.py`、`test_migrations.py`。

## 5. 后端约定

- 使用 SQLModel 模型与 Pydantic 请求/响应类型；所有查询必须校验资源归属当前用户。
- 写操作明确提交或回滚；并发冲突返回可处理的 HTTP 状态，不静默吞错。
- 新表、字段和索引使用 `mtt/alembic/versions/` 的 Alembic 迁移；不要扩张 `db.py::_migrate` 的启动补丁。
- 新库、旧库升级、导出往返都要测试；迁移不得依赖开发机数据库。
- 新测试放入 `moneyToTip/tests/`，优先确定性时间与纯函数测试，再覆盖 API 和事务边界。

## 6. 前端约定

- 学习端移动端优先：360px 无横向溢出，触控目标 ≥44px，适配安全区，支持弱网与刷新恢复。
- 新组件采用设计令牌 + CSS Modules；学习端不引入 Ant Design，管理端继续使用 Ant Design。
- 新服务端状态按计划迁移到 TanStack Query；复习会话用纯 reducer 状态机，避免多个 ref 相互失配。
- 所有异步页面覆盖加载、空态、错误和重试；表单有校验与未保存提醒，不用原生 `alert/confirm` 承载核心流程。
- API 类型从 FastAPI OpenAPI 生成并检查漂移；PWA 的 `/api/` 保持 `NetworkOnly`。
- 动画 150–250ms，尊重 `prefers-reduced-motion`；科学能力通过真实时间、评分预览和样本量呈现，不靠装饰性图表。

## 7. 安全与交付

- 不提交 `.env`、数据库、备份、token、密码、模型 Key、`node_modules/`、`dist/` 或 `.venv/`。
- 不读取或输出用户真实凭证；文档示例只使用本地假数据。
- 不擅自清空数据、弹出 stash、强推、改 ACL 或删除用户文件；破坏性操作先确认。
- 小步提交，提交信息使用 `feat:`、`fix:`、`test:`、`docs:`、`refactor:` 等明确前缀。
- 完成功能后更新 README 与设计状态；计划任务只有完成测试和验收后才能勾选。
- 当前后续工作以 `docs/superpowers/plans/2026-11-25-memory-experience-redesign.md` 为准，不重复实现已完成的记忆引擎。

## 8. 完成定义

交付前确认：相关测试实际通过；两个受影响前端均完成生产构建；旧数据兼容未回归；文档与真实行为一致；`git status` 无意外产物；最终只汇报实际验证和实际推送结果。
