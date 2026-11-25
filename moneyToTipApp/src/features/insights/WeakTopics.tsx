import { Link } from "react-router-dom";
import type { MemoryInsights } from "../../api/types";
import styles from "./WeakTopics.module.css";

export default function WeakTopics({ items }: { items: MemoryInsights["weak_categories"] }) {
  return <section className={styles.section}><div className={styles.head}><h2>需要多留意的分类</h2><span>按真实保持率排序</span></div>
    {items.length === 0 ? <p className={styles.empty}>暂无可分析的薄弱分类。</p> : <div>{items.map((item) => <Link key={item.category_id ?? "none"} to={item.category_id === null ? "/library" : `/library?category_id=${item.category_id}`} className={styles.topic}>
      <span><strong>{item.name}</strong><small>{item.total} 次样本 · {item.due_count} 题到期</small></span><span className={styles.rate}>{(item.rate * 100).toFixed(1)}% →</span>
    </Link>)}</div>}
  </section>;
}
