import type { DueQuestion } from "../api/types";
import Md from "./Md";

interface Props {
  question: DueQuestion;
  correct: boolean;
  given: string;
  onAsk: () => void;
  /** 已提交（客观题答错立即提交 again；其余等自评/评分后提交） */
  submitted: boolean;
  /** 主观题：先出答案，四档自评（含"没答上来"） */
  subjective: boolean;
  onRate: (rating: "again" | "hard" | "good" | "easy") => void;
  onNext: () => void;
}

/** 视觉第 3 层：答后反馈——对错 + 标准答案 + 讲解 + 出处（R-session-04）。
 *  客观题自动判定；主观题（问答/场景设计）对照答案后四档自评（A2）。 */
export default function FeedbackPanel({ question, correct, given, submitted, subjective, onRate, onNext, onAsk }: Props) {
  return (
    <div className="feedback">
      {!subjective && (
        <div className={`fb-verdict ${correct ? "right" : "wrong"}`}>
          {correct ? "答对了" : "没答上来"}
        </div>
      )}
      <div className="fb-answer">
        <span className="fb-label">答案：</span>
        <Md>{question.answer}</Md>
        {!correct && !subjective && question.qtype === "blank" && given.trim() && (
          <span className="fb-label">（你写的：{given}）</span>
        )}
      </div>
      {question.explanation && (
        <div className="fb-explain"><Md>{question.explanation}</Md></div>
      )}
      {question.source && <div className="fb-source">出处 · {question.source}</div>}

      {!submitted && (
        <div className="rate-row">
          <span className="rate-label">{subjective ? "对照一下，答得怎么样？" : "掌握得怎么样？"}</span>
          <div className="rate-btns">
            <button className="btn ghost" onClick={() => onRate("again")}>没答上来</button>
            <button className="btn ghost" onClick={() => onRate("hard")}>有点模糊</button>
            <button className="btn accent" onClick={() => onRate("good")}>记住了</button>
            <button className="btn ghost" onClick={() => onRate("easy")}>很轻松</button>
          </div>
        </div>
      )}
      {submitted && (
        <div className="next-row">
          <div className="next-btns">
            <button className="btn ghost" onClick={onAsk}>
              问 AI
            </button>
            <button className="btn accent grow" onClick={onNext} autoFocus>
              下一题
            </button>
          </div>
          {!correct && <div className="ask-hint">没答上来？可以问 AI 讲清这题</div>}
        </div>
      )}
    </div>
  );
}
