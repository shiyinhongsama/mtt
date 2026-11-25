import type { ReactNode } from "react";
import Button from "./Button";
import styles from "./Feedback.module.css";

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.skeleton} aria-label="载入中" role="status">
      {Array.from({ length: lines }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function EmptyState({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className={styles.state}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}

export function ErrorState({ message, onRetry, title = "暂时无法加载" }: {
  message: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <section className={styles.state} role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      <div className={styles.action}><Button onClick={onRetry}>重试</Button></div>
    </section>
  );
}
