import type { DueQuestion, Rating } from "../../api/types";
import { formatInterval } from "./format";
import styles from "./ReviewRatingBar.module.css";

const ratings: { value: Rating; label: string; key: string }[] = [
  { value: "again", label: "忘记", key: "1" },
  { value: "hard", label: "困难", key: "2" },
  { value: "good", label: "记得", key: "3" },
  { value: "easy", label: "轻松", key: "4" },
];

export default function ReviewRatingBar({ question, disabled, onRate }: {
  question: DueQuestion;
  disabled: boolean;
  onRate: (rating: Rating) => void;
}) {
  return (
    <div className={styles.ratings} aria-label="记忆自评">
      {ratings.map((rating) => (
        <button
          type="button"
          key={rating.value}
          className={`${styles.rating} ${styles[rating.value]}`}
          disabled={disabled}
          onClick={() => onRate(rating.value)}
          aria-keyshortcuts={rating.key}
        >
          <span>{rating.label}</span>
          <small>{formatInterval(question.rating_previews[rating.value].interval_minutes)}</small>
        </button>
      ))}
    </div>
  );
}
