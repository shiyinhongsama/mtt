import { useState } from "react";
import type { DueQuestion } from "../api/types";
import { SUBJECTIVE_TYPES } from "../api/types";

interface Props {
  question: DueQuestion;
  disabled: boolean;
  onAnswer: (correct: boolean, given: string) => void;
  /** 主观题：用户思考后主动查看答案，再自评 */
  onReveal: () => void;
}

/** 视觉第 2 层：作答区，单手可达；客观题本地判定零模型成本 */
export default function AnswerArea({ question, disabled, onAnswer, onReveal }: Props) {
  const [blank, setBlank] = useState("");

  if (SUBJECTIVE_TYPES.includes(question.qtype)) {
    return (
      <div className="answers">
        <button className="opt" disabled={disabled} onClick={onReveal}>
          心里想好答案了，对照标准答案
        </button>
      </div>
    );
  }

  if (question.qtype === "choice" || question.qtype === "judge") {
    const options =
      question.qtype === "judge" && question.options.length === 0
        ? ["对", "错"]
        : question.options;
    return (
      <div className="answers">
        {options.map((opt) => (
          <button
            key={opt}
            className="opt"
            disabled={disabled}
            onClick={() => onAnswer(opt === question.answer, opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  const submit = () => onAnswer(blank.trim() === question.answer.trim(), blank);
  return (
    <div className="blank-row">
      <input
        value={blank}
        placeholder="写下你的答案"
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => setBlank(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn" disabled={disabled} onClick={submit}>
        提交
      </button>
    </div>
  );
}
