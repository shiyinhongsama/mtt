"""anki 接口：导入（R-api-04 任务机制 v1 用同步执行，量级自用足够）。"""

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session

from mtt.anki.service import import_notes, parse_apkg, parse_tsv
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User

router = APIRouter(prefix="/anki", tags=["anki"])

MAX_UPLOAD = 64 * 1024 * 1024  # 64MB


@router.post("/import")
def import_anki(file: UploadFile = File(...), bank: str = "",
                user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    """上传 .apkg / .tsv / .txt / .csv，服务端解析入库并返回导入报告（R-anki-09）。"""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".apkg", ".tsv", ".txt", ".csv"):
        raise HTTPException(422, "只支持 .apkg / .tsv / .csv / .txt")

    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "文件超过 64MB 限制")

    bank_name = bank.strip() or f"Anki：{Path(file.filename or '导入').stem}"

    try:
        if suffix == ".apkg":
            with tempfile.NamedTemporaryFile(suffix=".apkg", delete=False) as tmp:
                tmp.write(data)
                tmp_path = Path(tmp.name)
            try:
                notes = parse_apkg(tmp_path)
            finally:
                tmp_path.unlink(missing_ok=True)
            # .apkg 的临时 collection 文件清理
            for leftover in tmp_path.parent.glob(tmp_path.stem + ".collection.tmp"):
                leftover.unlink(missing_ok=True)
        else:
            notes = parse_tsv(data.decode("utf-8-sig"))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "文件解析失败：不是有效的 Anki 导出格式")

    report = import_notes(session, user.id, notes, bank_name)
    return report.to_dict()


@router.post("/export")
def export_anki(user: User = Depends(get_current_user)) -> dict:
    """导出回 .apkg / TSV（R-anki-07）。TODO(anki)：先占位。"""
    raise HTTPException(501, "anki export not implemented yet (see mtt/anki)")
