import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AnswerArea from "../components/AnswerArea";
import ExplainPanel from "../components/ExplainPanel";
import FeedbackPanel from "../components/FeedbackPanel";
import QuestionCard from "../components/QuestionCard";
import Button from "../components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/Feedback";
import useReviewSession from "../features/review/useReviewSession";
import styles from "./ReviewPage.module.css";

export default function ReviewPage() {
  const [params] = useSearchParams();
  const planId = Number(params.get("plan")) || null;
  const { state, identity, due, plans, active, plan, answer, rate, retry, next, reload } = useReviewSession(null, null, planId);
  const [askOpen, setAskOpen] = useState(false);
  const current = state.current;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      const shortcuts = ["again", "hard", "good", "easy"] as const;
      const index = Number(event.key) - 1;
      if (state.phase === "rating" && index >= 0 && index < shortcuts.length) rate(shortcuts[index]);
      if (state.phase === "submitted" && event.key === "Enter") next();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, rate, state.phase]);

  if (identity.isError) return <ErrorState message={identity.error.message} onRetry={() => identity.refetch()} />;
  if ((plans.isError || active.isError) && !current) {
    return <main className={styles.page}><ErrorState message={(plans.error ?? active.error)?.message ?? "暂时无法加载"} onRetry={() => { plans.refetch(); active.refetch(); }} /></main>;
  }
  if ((identity.isLoading || plans.isLoading || active.isLoading || (state.phase === "loading" && due.isLoading)) && !current) {
    return <main className={styles.page}><Skeleton lines={5} /></main>;
  }
  if (due.isError && !current) {
    return <main className={styles.page}><ErrorState message={due.error.message} onRetry={reload} /></main>;
  }
  if (!current || state.phase === "complete") {
    return (
      <main className={styles.page}>
        <EmptyState
          title={plan ? `「${plan.name}」这一轮完成了` : "这轮复习完成了"}
          description={plan ? "回到今日查看这个计划的进度，再开始下一个计划。" : "没有更多到期题。新的复习会按你的真实评分在合适的时间出现。"}
          action={<Link to="/today"><Button variant="secondary">返回今日</Button></Link>}
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link to="/today" className={styles.exit} aria-label="退出本轮复习">←</Link>
        <div>
          <strong>专注复习</strong>
          <span>{plan ? plan.name : "按记忆状态，逐题巩固"}</span>
        </div>
        <span className={styles.count}>{state.queue.length} 题</span>
      </header>
      {due.isError && (
        <div className={styles.queueError} role="alert">
          队列刷新失败，当前题目仍保留。<button onClick={reload}>重试</button>
        </div>
      )}
      <QuestionCard question={current} />
      {state.phase === "answering" ? (
        <AnswerArea
          key={current.id}
          question={current}
          disabled={false}
          onAnswer={(_correct, given) => answer(given || current.answer)}
          onReveal={() => answer(current.answer)}
        />
      ) : (
        <FeedbackPanel
          question={current}
          given={state.answer}
          phase={state.phase}
          error={state.error}
          onRate={rate}
          onRetry={retry}
          onNext={() => { setAskOpen(false); next(); }}
          onAsk={() => setAskOpen(true)}
        />
      )}
      {askOpen && state.phase === "submitted" && (
        <ExplainPanel
          question={current}
          given={state.answer}
          onClose={() => setAskOpen(false)}
          onNext={() => { setAskOpen(false); next(); }}
        />
      )}
    </main>
  );
}
