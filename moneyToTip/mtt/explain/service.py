"""explain — AI 求助：手动触发的讲题与追问（需求 §5.6）。

- 只在用户点击「问 AI」后发生模型调用（R-explain-01，S-15）
- 预置上下文：题干、我的作答、正确答案、出处、标签（R-explain-02）
- 三类追问：为什么 / 再出同类题 / 结合项目举例（R-explain-03）
- 求助不算复习、不改排期，但记入日志（R-explain-07）
- 模型 BYOK：MTT_MODEL_API_KEY / MTT_MODEL_BASE_URL / MTT_MODEL_NAME（R-data-04）
"""

import json
import re
import uuid

import httpx
from sqlmodel import Session

from mtt.config import settings
from mtt.corpus.models import Question
from mtt.schedule.models import ReviewLog
from mtt.timeutil import utcnow

SYSTEM_PROMPT = """你是「忙里偷题」的讲题老师，用中文、老师对学生的口吻。

原则：
1. 先一句话点出作答错在哪或关键点是什么；
2. 讲清正确逻辑，必要时用类比或最小例子；
3. 只根据给出的题目与出处信息讲解，不编造原文没有的内容；
4. 默认 150 字以内，用户追问时再展开；
5. 禁止使用 deck、interval、FSRS、retention 等系统术语。

如果用户要求"结合我的项目举例"，可以用软件工程里的常见场景举例并说明是示例。"""

VARIANT_PROMPT = """请基于原题出一个**同类变式题**（考点相同、问法或场景不同），只输出 JSON，不要输出其他内容：
{"stem": "题面", "options": ["选项1","选项2","选项3","选项4"] 或 null, "answer": "正确答案", "explanation": "一句话讲解"}
要求：客观可判定；答案必须唯一确定；难度与原题相当。"""


def build_context(q: Question, given: str) -> str:
    import json as _json
    ctx = [
        f"题面：{q.stem}",
        f"正确答案：{q.answer}",
    ]
    if q.explanation:
        ctx.append(f"题目自带讲解：{q.explanation}")
    if q.source:
        ctx.append(f"出处：{q.source}")
    if q.tags:
        ctx.append(f"标签：{', '.join(_json.loads(q.tags))}")
    if given.strip():
        ctx.append(f"学生的作答：{given.strip()}")
    else:
        ctx.append("学生尚未作答（主动提问）。")
    return "\n".join(ctx)


def call_llm(messages: list[dict]) -> str:
    """OpenAI 兼容的 chat completions（BYOK）。未配置时抛 ValueError。"""
    if not settings.model_api_key:
        raise ValueError("模型未配置：请设置 MTT_MODEL_API_KEY（管理端全局 BYOK 配置）")
    base = (settings.model_base_url or "https://api.openai.com/v1").rstrip("/")
    model = settings.model_name or "gpt-4o-mini"
    r = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {settings.model_api_key}"},
        json={"model": model, "messages": messages, "temperature": 0.3},
        timeout=60.0,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def ask(q: Question, given: str, history: list[dict], mode: str) -> dict:
    """mode=chat → {reply, history}; mode=variant → {variant, history}。"""
    context = build_context(q, given)
    turns = [m for m in history if m.get("role") in ("user", "assistant")][-10:]

    if mode == "variant":
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + VARIANT_PROMPT},
            {"role": "user", "content": context},
        ]
        raw = call_llm(messages)
        variant = _parse_variant(raw)
        return {"variant": variant}

    if not turns:
        user_msg = f"请讲解这道题（先点评我的作答，再讲清正确逻辑）：\n{context}"
    else:
        user_msg = turns[-1]["content"]
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context}]
    messages += turns[:-1] if turns else []
    if turns:
        messages.append({"role": "user", "content": user_msg})
    reply = call_llm(messages)
    new_history = turns + [{"role": "user", "content": user_msg}, {"role": "assistant", "content": reply}]
    return {"reply": reply, "history": new_history[-10:]}


def _parse_variant(raw: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        raise ValueError("模型未返回有效的变式题 JSON")
    data = json.loads(m.group(0))
    if not data.get("stem") or not data.get("answer"):
        raise ValueError("变式题缺少题面或答案")
    return {
        "stem": str(data["stem"]),
        "options": data.get("options") or None,
        "answer": str(data["answer"]),
        "explanation": str(data.get("explanation", "")),
    }


def log_help_request(session: Session, user_id: int, question_id: int) -> None:
    """求助记日志（R-explain-07）：不改排期，只留痕。"""
    session.add(ReviewLog(
        user_id=user_id, question_id=question_id,
        client_id=f"explain-{uuid.uuid4()}",
        correct=True, rating="good", is_help_request=True,
        reviewed_at=utcnow()))
    session.commit()
