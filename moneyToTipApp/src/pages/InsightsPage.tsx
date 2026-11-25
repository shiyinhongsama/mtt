import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { MemoryInsights } from "../api/types";
import { ErrorState, Skeleton } from "../components/ui/Feedback";
import RetentionSummary from "../features/insights/RetentionSummary";
import WeakTopics from "../features/insights/WeakTopics";
import LoadForecast from "../features/today/LoadForecast";
import styles from "./InsightsPage.module.css";

export default function InsightsPage() {
  const [days, setDays] = useState(30);
  const query = useQuery({ queryKey: ["stats", "insights", days], queryFn: () => api<MemoryInsights>(`/stats/insights?days=${days}`), retry: false });
  return <main className={styles.page}>
    <header className={styles.header}><div><p>MEMORY, EXPLAINED</p><h1>记忆洞察</h1></div><label>统计范围<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label></header>
    {query.isError ? <ErrorState message={query.error.message} onRetry={() => query.refetch()} /> : query.isLoading || !query.data ? <Skeleton lines={6} /> : <>
      {query.data.retention.total === 0 && <h2 className={styles.empty}>还没有足够的复习记录</h2>}
      <RetentionSummary data={query.data} />
      <LoadForecast forecast={query.data.forecast} />
      <WeakTopics items={query.data.weak_categories} />
    </>}
    <details className={styles.method}><summary>数据口径与排期说明</summary><p>保持率只统计你的真实复习记录，AI 求助不计入；少于 20 次时不显示百分比，避免小样本误导。</p><p><code>R(t) = exp(-t/S)</code> 是用于估算复习间隔的排期近似，不是对你记忆能力的测量，也不承诺记忆效果。</p></details>
  </main>;
}
