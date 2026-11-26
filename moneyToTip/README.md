# 忙里偷题 · Money to Tip

> Small tips, big steps.

碎片时间刷题应用：任意材料 → 可溯源的题 → 科学复习排期 → 答错就地讲明白。
需求与决策见知识库 `知识库/想法/刷题APP/`（想法.md / 头脑风暴.md / 需求.md）。

## 快速开始

```bash
uv sync                      # 安装依赖
mtt init-db                  # 初始化或迁移数据库（SQLite，默认 ./mtt.db）
mtt user-create admin --admin  # 创建管理员，输出口令与 API token
mtt serve                    # 启动服务端 → http://127.0.0.1:8000/app/（复习端）
uv run pytest                # 跑测试
```

数据库使用 Alembic 版本化迁移。全新安装直接创建当前结构；旧库在启动或执行 `mtt init-db` 时自动升级，随后执行每日自动备份。

## 架构

服务端 Python + FastAPI + SQLModel（SQLite），通过 `/api/v1` 向两个**独立前端工程**供数：

| 工程 | 形态 | 入口 | 登录 |
|---|---|---|---|
| [`moneyToTipApp`](../moneyToTipApp) | 复习端（React 18 + TS + Vite + PWA） | `/app/` | 账号密码 |
| [`moneyToTipConsole`](../moneyToTipConsole) | 管理端（React 18 + TS + Vite） | `/console/` | 账号密码（仅管理员） |

另有本仓库的 Typer CLI（`mtt`），与 Web 管理端能力互补，只限本机使用。

### 独立前端工程

- 复习端 `moneyToTipApp`：`npm run dev` → http://localhost:5173/app/（代理到 8000）
- 管理端 `moneyToTipConsole`：`npm run dev` → http://localhost:5174/console/（代理到 8000）

### 复习端 moneyToTipApp

```bash
cd ../moneyToTipApp
npm install
npm run dev     # 开发：http://localhost:5173/app/（/api 代理到 127.0.0.1:8000）
npm run build   # 生产：构建到 dist/，由本服务挂在 /app/（自动探测，或用 MTT_WEBAPP_DIST 指定）
```

- HashRouter 静态托管免服务端路由配置；`base: /app/`
- PWA（vite-plugin-pwa）：可安装、App Shell 预缓存、API 永远走网络（服务端是唯一事实源）
- `src/api/`：API 客户端 + 契约类型，与服务端对齐
- `src/pages/`：刷题 / 加题 / 预览区 / 统计 / 管理 / 登录

代码模块与需求 §4 能力地图一一对应，构建顺序即依赖顺序（单向无环）：

```
mtt/
├── config.py        # 全局配置（BYOK 模型 Key、排期算法开关）
├── db.py / deps.py  # 版本化数据库 / 鉴权依赖
├── alembic/         # 数据库版本与旧库升级
├── main.py          # FastAPI 入口
├── api/             # 接口聚合层（客户端只消费这里）
├── identity/        # [已实现] 账户、角色、令牌（R-identity）
├── capture/         # [模型+占位] 材料入库：Markdown 导入包（R-capture）
├── corpus/          # [已实现] 题库、树形分类、题目状态（R-corpus）
├── generate/        # [模型+占位] AI 出题与质控（R-generate）
├── schedule/        # [已实现] 记忆排期引擎 + 全量 review log（R-schedule）
├── explain/         # [已实现] 手动「问 AI」对话框（R-explain）
├── data/            # [已实现] 备份 / 导出 / 导入 / 销毁（R-data）
├── growth/          # [已实现] 成熟知识量等统计（R-growth）
├── anki/            # [已实现] Anki 导入与进度迁移（R-anki）
└── mcp/             # [占位] 智能体接入（R-mcp，v1 仅占位）
```

设计要点：
- **服务端是唯一事实源**；复习端（PWA）与管理端（CLI/Web）都走 `/api/v1`
- **术语黑名单**：内部状态码 new/learning/review/relearning 映射为 新学/学习中/稳定复习/重学中；“已掌握”只是稳定复习且间隔达到 21 天的展示标签
- **幂等回写**：`client_id` 去重，并发重发也只产生一条日志、推进一次排期（R-api-10）
- **零模型成本复习**：判定与标准答案不走模型；AI 只在用户主动「问 AI」时调用

### 记忆排期

当前使用可解释的指数遗忘近似 `R(t)=exp(-t/S)`，根据每题的回忆记录更新稳定性 `S`。
默认目标保持率为 `0.85`；答错进入 10 分钟重学，复习间隔最短 10 分钟、最长 365 天。
该模型是个性化排期的初始近似，不承诺保证记忆。算法版本记录在每题状态和每次决策快照中，后续可迁移到 FSRS。

`GET /api/v1/reviews/due` 使用分钟级 `due_at` 排序并返回四个评分的预览；`POST /api/v1/reviews` 返回保存后的排期决策，重放同一 `client_id` 会返回首次决策快照。

## 路线图（对应需求构建顺序）

- [x] 骨架：模块边界、账户、题库模型、复习引擎、统计、CLI、测试
- [x] corpus 功能：题目增删改查、预览区确认、分类树、JSON 批量导入（R-corpus-05）
- [x] session：React PWA 复习端（打开即答、自评四档、计时、5 层视觉、离线 App Shell、按分类刷题）
- [x] data：每日自动备份 + 一键导出/再导入（可重放去重）+ 数据清空（R-data-01~05）
- [x] growth：热力图 + 分类掌握度 + 薄弱分类一键去刷（R-growth-01~04）
- [ ] capture：Markdown 目录 → 标准导入包（等项目完整后再做）
- [ ] generate：材料 → 客观题 → 校验 → 预览区（依赖 capture）
- [ ] 离线题包：未来 N 日题目预下载、离线回写（R-api-06、R-session-08）
- [x] anki：`.apkg` 与 TSV 导入、牌组层级映射和学习进度迁移
- [ ] mcp：智能体接入，排在核心内容闭环之后
