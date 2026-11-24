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
