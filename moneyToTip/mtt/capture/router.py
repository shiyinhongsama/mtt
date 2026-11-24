"""capture 接口：导入包上传（R-api-13）。骨架阶段返回 501，数据模型已就位。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from mtt.capture.models import ImportTask
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User

router = APIRouter(prefix="/materials", tags=["capture"])


@router.post("/packages")
def upload_package(user: User = Depends(get_current_user)) -> dict:
    """上传结构化导入包，触发入库任务。TODO(capture)：版本校验、增量、续跑。"""
    raise HTTPException(501, "import package pipeline not implemented yet (see mtt/capture)")


@router.get("/tasks/{task_id}")
def get_task(task_id: int, user: User = Depends(get_current_user),
             session: Session = Depends(get_session)) -> dict:
    task = session.get(ImportTask, task_id)
    if task is None or task.owner_id != user.id:
        raise HTTPException(404, "task not found")
    return {"id": task.id, "kind": task.kind, "status": task.status,
            "report": task.report, "error": task.error}
