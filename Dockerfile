# 忙里偷题 · All-in-One 镜像
# 多阶段：前端（App 端 + 管理端）构建 → Python 服务端运行时
# 单容器提供全部入口：:8000  / 产品主页 · /app/ 复习端 · /console/ 管理端 · /api/ · /docs

# ---------- 阶段 1：App 端（复习端 PWA） ----------
FROM node:20-alpine AS webapp
WORKDIR /build
COPY moneyToTipApp/package.json moneyToTipApp/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY moneyToTipApp/ ./
RUN npm run build

# ---------- 阶段 2：管理端（Console） ----------
FROM node:20-alpine AS console
WORKDIR /build
COPY moneyToTipConsole/package.json moneyToTipConsole/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY moneyToTipConsole/ ./
RUN npm run build

# ---------- 阶段 3：服务端运行时 ----------
FROM python:3.12-slim

# tzdata：'今日'按本地时区统计（zoneinfo 需要时区数据库）
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

ENV TZ=Asia/Shanghai \
    PYTHONUNBUFFERED=1 \
    MTT_DATABASE_URL=sqlite:////app/data/mtt.db \
    MTT_DATA_DIR=/app/data

WORKDIR /app/moneyToTip

# 服务端（含依赖锁定）
COPY moneyToTip/pyproject.toml moneyToTip/uv.lock moneyToTip/README.md ./
COPY moneyToTip/mtt ./mtt
RUN uv sync --no-dev --frozen

# 前端构建产物（服务端自动探测 ../moneyToTipApp/dist 与 ../moneyToTipConsole/dist）
COPY --from=webapp /build/dist /app/moneyToTipApp/dist
COPY --from=console /build/dist /app/moneyToTipConsole/dist

# 非 root 运行；数据目录（sqlite + 每日备份）挂卷持久化
RUN useradd --system --uid 10001 --create-home app \
    && mkdir -p /app/data \
    && chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

# 启动即建表/迁移/自动备份（mtt.main startup）
CMD ["uv", "run", "uvicorn", "mtt.main:app", "--host", "0.0.0.0", "--port", "8000"]
