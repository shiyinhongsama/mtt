"""explain 接口：手动「问 AI」（R-explain-01：未点击前零模型调用）。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from mtt.corpus.models import Question
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.explain import service
from mtt.identity.models import User

router = APIRouter(prefix="/explain", tags=["explain"])


class AskRequest(BaseModel):
    question_id: int
    given: str = ""                 # 我的作答（预置上下文，R-explain-02）
    mode: str = "chat"              # chat | variant（再出同类题，R-explain-03）
    history: list[dict] = []        # 对话历史（客户端回传，无服务端会话状态）


@router.post("/ask")
def ask(payload: AskRequest, user: User = Depends(get_current_user),
        session: Session = Depends(get_session)) -> dict:
    q = session.get(Question, payload.question_id)
    if q is None or q.owner_id != user.id:
        raise HTTPException(404, "question not found")
    if payload.mode not in ("chat", "variant"):
        raise HTTPException(422, "mode must be chat or variant")

    try:
        result = service.ask(q, payload.given, payload.history, payload.mode)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(502, "模型调用失败，请检查 API Key 与网络")

    # 求助记日志、不改排期（R-explain-07）
    service.log_help_request(session, user.id, q.id)
    return result
