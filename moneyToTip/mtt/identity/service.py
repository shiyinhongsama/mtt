"""账户与令牌的领域逻辑。"""

import hashlib
import secrets
from datetime import UTC, datetime

from sqlmodel import Session, select

from mtt.identity.models import ApiToken, User

_PBKDF2_ROUNDS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ROUNDS)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, _, hexhash = stored.partition("$")
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ROUNDS)
    return secrets.compare_digest(dk.hex(), hexhash)


def create_user(session: Session, username: str, password: str | None = None,
                role: str = "user") -> tuple[User, str]:
    """创建账户并发放初始凭证（R-identity-01）。password 为空则随机生成。"""
    password = password or secrets.token_urlsafe(9)
    user = User(username=username, hashed_password=hash_password(password), role=role)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user, create_token(session, user)


def create_token(session: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    session.add(ApiToken(token=token, user_id=user.id))
    session.commit()
    return token


def authenticate(session: Session, token: str) -> User | None:
    """按令牌取用户；会话吊销与禁用立即生效（R-identity-07/08）。
    同时刷新 last_used_at（超过一分钟才写库，避免每请求都写）。"""
    stmt = select(ApiToken).where(ApiToken.token == token, ApiToken.revoked == False)  # noqa: E712
    api_token = session.exec(stmt).first()
    if api_token is None:
        return None
    user = session.get(User, api_token.user_id)
    if user is None or not user.is_active:
        return None
    now = datetime.now(UTC)
    if api_token.last_used_at is None or (now - api_token.last_used_at).total_seconds() > 60:
        api_token.last_used_at = now
        session.add(api_token)
        session.commit()
    return user
