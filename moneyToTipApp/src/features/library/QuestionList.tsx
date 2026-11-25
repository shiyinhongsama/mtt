import type { Question } from "../../api/types";
import Button from "../../components/ui/Button";
import styles from "./QuestionList.module.css";

const statusLabels = { pending: "待确认", active: "复习中", flagged: "需修正", suspended: "已暂停" };

export default function QuestionList({ items, selected, onSelect, onEdit }: {
  items: Question[];
  selected: Set<number>;
  onSelect: (id: number) => void;
  onEdit: (question: Question) => void;
}) {
  return <div className={styles.list}>{items.map((question) => (
    <article className={styles.item} key={question.id}>
      <div className={styles.select}>
        <input type="checkbox" aria-label={`选择${question.stem}`} checked={selected.has(question.id)} disabled={question.status !== "pending"} onChange={() => onSelect(question.id)} />
      </div>
      <div className={styles.content}>
        <div className={styles.meta}><span>{statusLabels[question.status]}</span><span>{question.qtype}</span><span>难度 {question.difficulty}</span></div>
        <h3>{question.stem}</h3>
        <p>{question.source || "未填写出处"}</p>
      </div>
      <Button variant="ghost" aria-label={`编辑${question.stem}`} onClick={() => onEdit(question)}>编辑</Button>
    </article>
  ))}</div>;
}
