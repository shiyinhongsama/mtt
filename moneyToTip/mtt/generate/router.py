"""generate 接口：触发 + 状态查询（R-api-03）。骨架阶段返回 501。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.generate.models import GenerationTask
from mtt.identity.models import User

router = APIRouter(prefix="/generate", tags=["generate"])


@router.post("/tasks")
def create_task(user: User = Depends(get_current_user)) -> dict:
    """从材料单元出题。TODO(generate)：知识点切分 → 出题 → 独立校验 → 预览区。"""
    raise HTTPException(501, "question generation not implemented yet (see mtt/generate)")


@router.get("/tasks/{task_id}")
def get_task(task_id: int, user: User = Depends(get_current_user),
             session: Session = Depends(get_session)) -> dict:
    task = session.get(GenerationTask, task_id)
    if task is None or task.owner_id != user.id:
        raise HTTPException(404, "task not found")
    return {"id": task.id, "status": task.status, "report": task.report, "error": task.error}
