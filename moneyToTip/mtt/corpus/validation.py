"""进入复习队列前的题目完整性校验。"""

import json

from mtt.corpus.models import Question


def validate_question(question: Question) -> list[str]:
    errors: list[str] = []
    if not question.stem.strip():
        errors.append("题面不能为空")
    if not question.answer.strip():
        errors.append("答案不能为空")
    if not question.source.strip():
        errors.append("来源说明不能为空")
    if question.qtype == "choice":
        try:
            options = json.loads(question.options)
        except (TypeError, json.JSONDecodeError):
            options = []
        valid_options = [item.strip() for item in options if isinstance(item, str) and item.strip()]
        if len(valid_options) < 2:
            errors.append("选择题至少需要两个有效选项")
        if question.answer.strip() not in valid_options:
            errors.append("选择题答案必须是有效选项之一")
    return errors
