"""FastAPI 共享依赖：鉴权（R-api-05）。无凭证请求被拒。"""

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from mtt.db import get_session
from mtt.identity.models import User
from mtt.identity.service import authenticate


def get_current_user(authorization: str = Header(default=""),
                     session: Session = Depends(get_session)) -> User:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "missing bearer token")
    user = authenticate(session, token)
    if user is None:
        raise HTTPException(401, "invalid or revoked token")
    return user
