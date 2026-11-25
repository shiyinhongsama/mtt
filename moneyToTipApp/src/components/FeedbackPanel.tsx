import type { DueQuestion, Rating } from "../api/types";
import ReviewRatingBar from "../features/review/ReviewRatingBar";
import type { ReviewPhase } from "../features/review/session";
import Md from "./Md";
import Button from "./ui/Button";
import styles from "./FeedbackPanel.module.css";

interface Props {
  question: DueQuestion;
  given: string;
  phase: ReviewPhase;
  error: string;
  onRate: (rating: Rating) => void;
  onRetry: () => void;
  onNext: () => void;
  onAsk: () => void;
}

export default function FeedbackPanel({
  question, given, phase, error, onRate, onRetry, onNext, onAsk,
}: Props) {
  const submitted = phase === "submitted";
  return (
    <section className={styles.feedback} aria-label="答案与反馈">
      <div className={styles.answer}>
        <span className={styles.label}>标准答案</span>
        <Md>{question.answer}</Md>
        {given.trim() && <p className={styles.given}>你的作答：{given}</p>}
      </div>
      {question.explanation && <div className={styles.explanation}><Md>{question.explanation}</Md></div>}
      {question.source && <p className={styles.source}>出处 · {question.source}</p>}

      {["rating", "submitting", "failed"].includes(phase) && (
        <div className={styles.ratingArea}>
          <p className={styles.prompt}>这次记忆怎么样？下次复习时间由你的选择决定。</p>
          <ReviewRatingBar question={question} disabled={phase !== "rating"} onRate={onRate} />
          {phase === "submitting" && <p className={styles.status} role="status">正在保存结果…</p>}
        </div>
      )}

      {phase === "failed" && (
        <div className={styles.failure} role="alert">
          <strong>结果尚未保存</strong>
          <span>{error || "请检查网络后重试，本题仍保留在这里。"}</span>
          <Button variant="secondary" onClick={onRetry}>重试</Button>
        </div>
      )}

      {submitted && (
        <div className={styles.nextRow}>
          <p className={styles.saved}>已保存，这次评分已用于调整下次复习。</p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={onAsk}>问 AI</Button>
            <Button onClick={onNext} autoFocus>下一题</Button>
          </div>
        </div>
      )}
    </section>
  );
}
