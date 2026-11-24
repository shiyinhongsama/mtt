# 忙里偷题 · Money to Tip

> Small tips, big steps.

碎片时间刷题应用：任意材料 → 可溯源的题 → 科学复习排期 → 答错就地讲明白。
需求与设计决策见知识库 `知识库/想法/刷题APP/`（想法.md / 头脑风暴.md / 需求.md）。

## 目录结构

| 子目录 | 说明 | 技术栈 |
|---|---|---|
| `moneyToTip/` | 服务端 + 管理 CLI + 产品主页 | Python · FastAPI · SQLModel (SQLite) · Typer |
| `moneyToTipApp/` | App 端（复习端，PWA） | React 18 · TypeScript · Vite · vite-plugin-pwa |
| `moneyToTipConsole/` | 管理端（后台） | React 18 · TypeScript · Vite · Ant Design 5 |

三个子目录各自是独立 git 仓库；本目录只做组织，不是仓库。

## 快速开始

```bash
# 1. 服务端（API + 产品主页，端口 8000）
cd moneyToTip
uv sync
mtt init-db
mtt user-create shiyinhong --admin --password <密码>   # 输出口令与 API token
mtt serve                    # → http://localhost:8000

# 2. App 端（复习端，端口 8001）
cd ../moneyToTipApp
npm install
npm run build
npx vite preview --host      # → http://localhost:8001/app/
# 开发热更新：npm run dev（5173）

# 3. 管理端（后台，端口 8002）
cd ../moneyToTipConsole
npm install
npm run build
npx vite preview --host      # → http://localhost:8002/console/
# 开发热更新：npm run dev（5174）
```

服务端会自动探测兄弟目录的 `dist/` 并托管：`/app/`（App 端）与 `/console/`（管理端），
所以 8000 一个端口也能用；`MTT_WEBAPP_DIST` / `MTT_CONSOLE_DIST` 可显式指定。

## 模型配置（BYOK）

App 端「问 AI」与 AI 变式题需要模型 Key，写入 `moneyToTip/.env`（已 gitignore）：

```bash
MTT_MODEL_API_KEY=sk-...
MTT_MODEL_BASE_URL=https://api.minimaxi.com/v1   # OpenAI 兼容接口
MTT_MODEL_NAME=MiniMax-M3.1-Flash
```

## 功能地图

- **题库**：题库（名称+备注）→ 分类树（`::` 层级）→ 题目（选择/填空/判断/问答/场景设计，Markdown）
- **刷题**：打开即答、四档自评、答题计时、按题库/分类/训练计划筛选、每日目标 + 加练
- **问 AI**：答错手动拉起讲题对话框，三类追问 + 同类变式题（可一键入库），求助记日志不改排期
- **复习引擎**：基于指数遗忘近似的个性化排期（目标保持率 0.85）、10 分钟重学、分钟级评分预览、全量 review log、并发幂等回写
- **数据主权**：每日自动备份、全量导出/再导入（可重放）、数据清空
- **账户**：管理员/普通用户、多令牌（掩码+复制+吊销）、数据隔离
- **Anki**：.apkg（anki21/anki21b）与 TSV 导入、牌组层级转分类、进度粗略迁移、导入报告
- **管理端**：仪表盘、题库/分类/账户/数据/Anki 五页，响应式布局

## 测试

```bash
cd moneyToTip && uv run pytest    # 服务端接口与领域逻辑
```

## Docker（推荐部署方式）

All-in-One 镜像：多阶段构建（前端 ×2 + Python 运行时），单容器提供全部入口。

```bash
cd mtt/                          # 本目录
cp moneyToTip/.env .env          # 模型 BYOK（可选，不配则「问 AI」不可用）
docker compose up -d --build     # 构建并启动
docker compose logs -f           # 看日志
```

| 入口 | 地址 |
|---|---|
| 产品主页 | http://localhost:8000/ |
| App 端（复习端 PWA） | http://localhost:8000/app/ |
| 管理端（后台） | http://localhost:8000/console/ |

```bash
# 常用维护（在容器里执行 mtt 命令）
docker compose exec moneytotip uv run mtt user-create shiyinhong --admin   # 建管理员
docker compose exec moneytotip uv run mtt question-import /app/data/x.json # 批量导题
docker compose down              # 停止（数据保留在卷 mt-data 里）
```

说明：
- 数据持久化在卷 `mt-data`（sqlite 库 + 每日自动备份），删容器不丢数据
- 时区固定 `Asia/Shanghai`（"今日"口径）；以非 root 用户运行；带健康检查
- 模型 Key 通过 compose 的 `.env`（`MTT_MODEL_API_KEY` 等）注入，不进镜像
