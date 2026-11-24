"""FastAPI 应用入口：uvicorn mtt.main:app。"""

from pathlib import Path

from fastapi import FastAPI
from starlette.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from mtt import __version__
from mtt.api.router import api_router
from mtt.config import settings
from mtt.db import init_db

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def _find_webapp_dist() -> Path | None:
    """App 端（复习端）构建产物：独立工程 moneyToTipApp，可用 MTT_WEBAPP_DIST 指定。"""
    return _find_dist(settings.webapp_dist, "moneyToTipApp", "webapp")


def _find_console_dist() -> Path | None:
    """管理端构建产物：独立工程 moneyToTipConsole，可用 MTT_CONSOLE_DIST 指定。"""
    return _find_dist(settings.console_dist, "moneyToTipConsole")


def _find_dist(env_value: str, *sibling_names: str) -> Path | None:
    repo_root = Path(__file__).resolve().parent.parent
    candidates: list[Path] = []
    if env_value:
        candidates.append(Path(env_value))
    for name in sibling_names:
        candidates.append(repo_root.parent / name / "dist")  # 独立工程
    candidates.append(repo_root / "webapp" / "dist")        # 兼容旧布局
    for c in candidates:
        if c.exists():
            return c
    return None


def create_app() -> FastAPI:
    app = FastAPI(
        title="忙里偷题 · Money to Tip",
        description="Small tips, big steps.",
        version=__version__,
    )
    # 骨架阶段放开，PWA 接入时收紧到实际源（§7 隐私：HTTPS + 凭证）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "name": "money-to-tip", "version": __version__}

    app.include_router(api_router, prefix="/api/v1")

    webapp_dist = _find_webapp_dist()
    if webapp_dist is not None:
        # App 端（PWA）：独立工程 moneyToTipApp，开发用 `npm run dev`（代理到 8000）
        app.mount("/app", StaticFiles(directory=webapp_dist, html=True), name="webapp")

        # /app（无尾斜杠）显式重定向，StaticFiles 挂载本身不做目录跳转
        @app.get("/app", include_in_schema=False)
        def app_redirect():
            return RedirectResponse("/app/", status_code=307)

    console_dist = _find_console_dist()
    if console_dist is not None:
        # 管理端：独立工程 moneyToTipConsole，开发用 `npm run dev`（5174，代理到 8000）
        app.mount("/console", StaticFiles(directory=console_dist, html=True), name="console")

        @app.get("/console", include_in_schema=False)
        def console_redirect():
            return RedirectResponse("/console/", status_code=307)

    if WEB_DIR.exists():
        # 产品主页 /（落地页原型）
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    elif webapp_dist is not None:
        app.mount("/", StaticFiles(directory=webapp_dist, html=True), name="webapp-root")

    @app.on_event("startup")
    def on_startup() -> None:
        init_db()
        # 每日自动备份（R-data-01）：当天未备份则立即备份，之后每 12h 检查
        from mtt.data.service import auto_backup
        auto_backup()

    return app


app = create_app()
