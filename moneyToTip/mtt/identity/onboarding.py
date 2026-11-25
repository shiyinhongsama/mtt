"""首次使用引导：为当前用户创建可明确识别的示例内容。"""

import json

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from mtt.corpus.models import Question, QuestionBank
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User

router = APIRouter(prefix="/identity/onboarding", tags=["identity"])

SAMPLE_BANK_NAME = "忙里偷题示例"
SAMPLE_SOURCE = "忙里偷题示例"
SAMPLES = (
    {
        "qtype": "choice",
        "stem": "根据艾宾浩斯遗忘规律，哪种复习方式更合理？",
        "options": ["只在考前集中突击", "按逐渐拉长的间隔回顾", "每天随机重复同一批题"],
        "answer": "按逐渐拉长的间隔回顾",
        "explanation": "间隔复习在记忆开始衰减时安排回顾，并根据回忆表现调整下一次间隔。",
    },
    {
        "qtype": "blank",
        "stem": "HTTP 协议默认使用哪个端口？",
        "options": [],
        "answer": "80",
        "explanation": "HTTP 默认端口是 80，HTTPS 默认端口是 443。",
    },
    {
        "qtype": "judge",
        "stem": "复习提交失败时，应保留当前题面，并使用同一请求标识重试。",
        "options": [],
        "answer": "正确",
        "explanation": "复用请求标识可以让服务端识别重复提交，避免一次回答被记录两次。",
    },
)


@router.post("/sample")
def create_sample(user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> dict:
    """创建或补齐当前用户的示例题库；重复调用返回同一组题目 ID。"""
    try:
        bank = session.exec(select(QuestionBank).where(
            QuestionBank.owner_id == user.id,
            QuestionBank.name == SAMPLE_BANK_NAME,
        )).first()
        if bank is None:
            bank = QuestionBank(
                owner_id=user.id,
                name=SAMPLE_BANK_NAME,
                description="用于首次体验间隔复习，可随时暂停或编辑。",
            )
            session.add(bank)
            session.flush()

        existing = session.exec(select(Question).where(
            Question.owner_id == user.id,
            Question.bank_id == bank.id,
            Question.source == SAMPLE_SOURCE,
        )).all()
        by_stem = {question.stem: question for question in existing}
        questions = []
        for sample in SAMPLES:
            question = by_stem.get(sample["stem"])
            if question is None:
                question = Question(
                    owner_id=user.id,
                    bank_id=bank.id,
                    qtype=sample["qtype"],
                    stem=sample["stem"],
                    options=json.dumps(sample["options"], ensure_ascii=False),
                    answer=sample["answer"],
                    explanation=sample["explanation"],
                    source=SAMPLE_SOURCE,
                    tags=json.dumps(["示例"], ensure_ascii=False),
                    difficulty=1,
                    status="active",
                )
                session.add(question)
            questions.append(question)
        session.flush()
        result = {"bank_id": bank.id, "question_ids": [question.id for question in questions]}
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
