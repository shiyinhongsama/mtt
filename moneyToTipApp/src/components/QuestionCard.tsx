import type { DueQuestion } from "../api/types";
import Md from "./Md";

/** 视觉第 1 层：题干最大、自足、扫一眼即可作答（R-session-02） */
export default function QuestionCard({ question }: { question: DueQuestion }) {
  return (
    <div className="q-card">
      <div className="q-meta">
        <span className="tag">{question.state.label}</span>
        {question.tags.map((t) => (
          <span key={t} className="tag">{t}</span>
        ))}
        <span className="tag">难度 {question.difficulty}</span>
      </div>
      <div className="q-stem"><Md>{question.stem}</Md></div>
    </div>
  );
}
