"""骨架验收：健康检查、鉴权、未实现模块返回 501。"""


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_required(client):
    """无凭证请求被拒（R-api-05）。"""
    assert client.get("/api/v1/reviews/due").status_code == 401
    assert client.get("/api/v1/stats").status_code == 401
    assert client.get("/api/v1/questions").status_code == 401


def test_me(client, auth):
    r = client.get("/api/v1/identity/me", headers=auth)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_placeholder_modules_return_501(client, auth):
    """未实现模块明确返回 501，而不是 404 或假数据。"""
    assert client.post("/api/v1/materials/packages", headers=auth).status_code == 501
    assert client.post("/api/v1/generate/tasks", headers=auth).status_code == 501


def test_data_module_implemented(client, auth):
    """data 已不再是占位：导出需要鉴权。"""
    assert client.get("/api/v1/data/export").status_code == 401
    assert client.get("/api/v1/data/export", headers=auth).status_code == 200


def test_startup_initializes_memory_schema_and_backup(client):
    from datetime import datetime
    from pathlib import Path

    from sqlalchemy import inspect, text

    from mtt.config import settings
    from mtt.db import engine

    with client:
        response = client.get("/health")
        assert response.status_code == 200
    columns = {c["name"] for c in inspect(engine).get_columns("questionstate")}
    assert {"due_at", "stability_days", "interval_minutes", "algorithm_version"} <= columns
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == "0003_user_preferences"
    stamp = datetime.now().strftime("%Y%m%d")
    backups = list((Path(settings.data_dir) / "backups").glob(f"mtt-{stamp}-*.db"))
    assert backups and all(path.stat().st_size > 0 for path in backups)
