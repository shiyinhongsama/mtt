"""数据主权接口：导出、再导入、备份与清空个人数据。"""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from mtt.data.service import create_backup, export_data, import_data, wipe_data
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User

router = APIRouter(prefix="/data", tags=["data"])


class ExportPayload(BaseModel):
    format: Literal["moneytotip-export"]
    version: int = 1
    banks: list[dict] = Field(default_factory=list)
    categories: list[dict] = Field(default_factory=list)
    questions: list[dict] = Field(default_factory=list)
    states: list[dict] = Field(default_factory=list)
    review_logs: list[dict] = Field(default_factory=list)
    plans: list[dict] = Field(default_factory=list)


class WipePayload(BaseModel):
    confirm: str


@router.get("/export")
def export(user: User = Depends(get_current_user),
           session: Session = Depends(get_session)) -> JSONResponse:
    filename = f"moneytotip-export-{date.today().isoformat()}.json"
    return JSONResponse(
        export_data(session, user.id),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
def import_bundle(payload: ExportPayload,
                  user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> dict:
    try:
        return import_data(session, user.id, payload.model_dump(mode="json"))
    except ValueError as exc:
        session.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/backup")
def backup(user: User = Depends(get_current_user)) -> dict:
    try:
        return {"backup": create_backup()}
    except (OSError, ValueError) as exc:
        raise HTTPException(500, f"备份失败：{exc}") from exc


@router.delete("/wipe")
def wipe(payload: WipePayload,
         user: User = Depends(get_current_user),
         session: Session = Depends(get_session)) -> dict:
    if payload.confirm != "清空":
        raise HTTPException(422, '请输入"清空"以确认')
    wipe_data(session, user.id)
    return {"wiped": True}
