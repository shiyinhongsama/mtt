"""identity 接口：账户管理（R-identity）、会话查看与吊销（R-identity-08）。

创建账户走管理员（R-identity-01），不做自助注册。
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from mtt.corpus.models import Category, Question
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import ApiToken, User
from mtt.identity.service import create_token, create_user, verify_password
from mtt.schedule.models import QuestionState, ReviewLog

router = APIRouter(prefix="/identity", tags=["identity"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admin only")
    return user


class UserCreate(BaseModel):
    username: str
    password: str | None = None  # 省略则随机生成
    role: str = "user"           # admin | user（R-identity-02）


class LoginRequest(BaseModel):
    username: str
    password: str


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {"id": user.id, "username": user.username, "role": user.role}


@router.post("/login")
def login(payload: LoginRequest,
          session: Session = Depends(get_session)) -> dict:
    """账号密码登录：为普通用户和管理员签发 API token。

    管理端必须在自己的登录流程中额外校验 admin 角色。
    TODO(identity): 登录限流与失败锁定（v1 自用阶段先不做）。
    """
    user = session.exec(select(User).where(User.username == payload.username)).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(401, "用户名或密码不正确")
    if not user.is_active:
        raise HTTPException(403, "账户已被禁用")
    token = create_token(session, user)
    return {"token": token, "username": user.username, "role": user.role}


@router.get("/tokens")
def list_tokens(user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> list[dict]:
    stmt = select(ApiToken).where(ApiToken.user_id == user.id).order_by(ApiToken.id.desc())
    return [{"id": t.id, "created_at": t.created_at, "last_used_at": t.last_used_at,
             "revoked": t.revoked, "masked": f"{t.token[:4]}…{t.token[-4:]}"}
            for t in session.exec(stmt).all()]


@router.post("/tokens/{token_id}/revoke")
def revoke_token(token_id: int, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    token = session.get(ApiToken, token_id)
    if token is None or (token.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "token not found")
    token.revoked = True
    session.add(token)
    session.commit()
    return {"revoked": True}


# ---------- 账户管理（仅管理员，R-identity-01/02/07） ----------

@router.get("/users")
def list_users(admin: User = Depends(require_admin),
               session: Session = Depends(get_session)) -> list[dict]:
    users = session.exec(select(User).order_by(User.id)).all()
    return [{"id": u.id, "username": u.username, "role": u.role,
             "is_active": u.is_active, "created_at": u.created_at} for u in users]


@router.post("/users", status_code=201)
def admin_create_user(payload: UserCreate, admin: User = Depends(require_admin),
                      session: Session = Depends(get_session)) -> dict:
    """管理员创建账户并发放初始凭证（R-identity-01）。"""
    if payload.role not in ("admin", "user"):
        raise HTTPException(422, "role must be admin or user")
    exists = session.exec(select(User).where(User.username == payload.username)).first()
    if exists:
        raise HTTPException(409, "username already exists")
    user, token = create_user(session, payload.username, password=payload.password,
                              role=payload.role)
    return {"id": user.id, "username": user.username, "role": user.role,
            "token": token}


@router.post("/users/{user_id}/disable")
def disable_user(user_id: int, admin: User = Depends(require_admin),
                 session: Session = Depends(get_session)) -> dict:
    """禁用账户：立即无法登录（R-identity-07）。"""
    if user_id == admin.id:
        raise HTTPException(409, "cannot disable yourself")
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    user.is_active = False
    session.add(user)
    session.commit()
    return {"id": user.id, "is_active": False}


@router.post("/users/{user_id}/enable")
def enable_user(user_id: int, admin: User = Depends(require_admin),
                session: Session = Depends(get_session)) -> dict:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    user.is_active = True
    session.add(user)
    session.commit()
    return {"id": user.id, "is_active": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require_admin),
                session: Session = Depends(get_session)) -> dict:
    """删除账户并清除其个人数据，不可恢复（R-identity-07/13）。"""
    if user_id == admin.id:
        raise HTTPException(409, "cannot delete yourself")
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    for model, col in ((Question, Question.owner_id), (Category, Category.owner_id),
                       (QuestionState, QuestionState.user_id),
                       (ReviewLog, ReviewLog.user_id), (ApiToken, ApiToken.user_id)):
        for row in session.exec(select(model).where(col == user_id)).all():
            session.delete(row)
    session.delete(user)
    session.commit()
    return {"deleted": user_id}


# ---------- 账户令牌管理（管理员，R-identity-08） ----------

def _token_info(t: ApiToken) -> dict:
    return {"id": t.id, "created_at": t.created_at,
            "last_used_at": t.last_used_at, "revoked": t.revoked,
            "token": t.token,  # 管理端接口（仅管理员可见）：供复制使用
            "masked": f"{t.token[:4]}…{t.token[-4:]}"}


@router.get("/users/{user_id}/tokens")
def list_user_tokens(user_id: int, admin: User = Depends(require_admin),
                     session: Session = Depends(get_session)) -> list[dict]:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    stmt = select(ApiToken).where(ApiToken.user_id == user_id).order_by(ApiToken.id.desc())
    return [_token_info(t) for t in session.exec(stmt).all()]


@router.post("/users/{user_id}/tokens", status_code=201)
def create_user_token(user_id: int, admin: User = Depends(require_admin),
                      session: Session = Depends(get_session)) -> dict:
    """为账户签发新 token（旧 token 仍然有效，可单独吊销）。"""
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "user not found")
    token = create_token(session, user)
    return {"user_id": user_id, "token": token}
