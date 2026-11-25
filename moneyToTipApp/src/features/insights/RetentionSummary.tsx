import { Link } from "react-router-dom";
import type { MemoryInsights } from "../../api/types";
import styles from "./RetentionSummary.module.css";

export default function RetentionSummary({ data }: { data: MemoryInsights }) {
  const { recalled, total, rate } = data.retention;
  return <section className={styles.summary} aria-label="真实记忆保持情况">
    <p className={styles.eyebrow}>近 30 天有效复习</p>
    {rate !== null ? <strong className={styles.rate}>{(rate * 100).toFixed(1)}%</strong> : <strong className={styles.pending}>样本积累中</strong>}
    <Link to="/library?status=active" className={styles.count}>{recalled} / {total} 次回忆成功</Link>
    <p className={styles.hint}>{total < 20 ? `再完成 ${20 - total} 次有效复习后显示保持率` : "保持率 = 非“忘记”的有效复习 ÷ 全部有效复习"}</p>
    <div className={styles.metrics}>
      <Link to="/library?status=active"><b>{data.learning_count}</b><span>学习中</span></Link>
      <Link to="/library?status=active"><b>{data.review_count}</b><span>稳定复习</span></Link>
      <Link to="/library?status=active"><b>{data.recovered_count}</b><span>遗忘后恢复</span></Link>
    </div>
  </section>;
}
