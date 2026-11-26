import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Bank, Plan, TodayStats } from "../api/types";
import Button from "../components/ui/Button";
import { ErrorState, Skeleton } from "../components/ui/Feedback";
import LoadForecast from "../features/today/LoadForecast";
import TodayPlans from "../features/today/TodayPlans";
import styles from "./TodayPage.module.css";

/** 今日：总览 + 今日计划；有计划时每个计划是独立入口 */
export default function TodayPage() {
  const query = useQuery({ queryKey: ["stats", "today"], queryFn: () => api<TodayStats>("/stats/today"), retry: false });
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<Plan[]>("/plans"), retry: false });
  const active = useQuery({
    queryKey: ["plans", "active"],
    queryFn: () => api<{ plan_ids: number[] }>("/plans/active"),
    retry: false,
  });
  // 计划接口失败不能显示成「没有计划」
  const plansFailed = plans.isError || active.isError;
  const plansSettled = (plans.isSuccess || plans.isError) && (active.isSuccess || active.isError);
  const activeIds = new Set(active.data?.plan_ids ?? []);
  const todayPlans = plansFailed ? [] : (plans.data ?? []).filter((plan) => activeIds.has(plan.id));
  const banksNeeded = todayPlans.some((plan) => plan.bank_id !== null);
  const banks = useQuery({
    queryKey: ["banks"],
    queryFn: () => api<Bank[]>("/questions/banks"),
    enabled: banksNeeded,
    retry: false,
  });
  // 等题库名字就绪再出卡片，避免先闪一下「题库 #3」
  const todayPlansReady = plansSettled && (!banksNeeded || !banks.isLoading);
  if (query.isLoading) return <main className={styles.page}><Skeleton lines={5} /></main>;
  if (query.isError) return <main className={styles.page}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></main>;
  if (!query.data) return null;
  const stats = query.data;
  const remaining = Math.max(0, stats.goal_count - stats.completed_count);
  const progress = stats.goal_count > 0 ? Math.min(100, stats.completed_count / stats.goal_count * 100) : 100;
  const freeMode = plansFailed || todayPlans.length === 0;
  const showFreeAction = plansSettled && freeMode;
  const plansError = (plans.error ?? active.error)?.message;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>忙里偷题 · 今日</p>
        <h1>{stats.goal_met ? "今日目标已完成" : "把零碎时间，变成长期记忆"}</h1>
        <p>根据你的评分安排下一次复习，不必每天从头再来。</p>
      </header>

      <section className={styles.progressCard} aria-label="今日学习进度">
        <div className={styles.progressHead}>
          <span>今日完成</span>
          <strong>{stats.completed_count} / {stats.goal_count || stats.completed_count}</strong>
        </div>
        <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={stats.goal_count || stats.completed_count} aria-valuenow={stats.completed_count}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.metrics}>
          <span><b>{stats.due_count}</b> 当前到期</span>
          <span><b>{stats.new_count}</b> 新题</span>
          <span><b>{stats.relearning_count}</b> 重学中</span>
        </div>
        {stats.shortage_reason === "not_enough_due_questions" && (
          <p className={styles.shortage}><strong>到期题不足</strong>，还差 {remaining} 题才达成目标。可导入更多题目，或明天继续。</p>
        )}
        {stats.estimated_minutes !== null && <p className={styles.estimate}>根据近期作答，预计还需 {Math.max(1, Math.ceil(stats.estimated_minutes * stats.due_count))} 分钟</p>}
        {plansSettled && !stats.goal_met && !freeMode ? null : (
          <div className={styles.actions}>
            {!plansSettled ? <span className={styles.actionPlaceholder} aria-hidden="true" /> : !stats.goal_met ? (
              showFreeAction && <Link to="/review" className={styles.primaryLink}><Button block>继续今日复习</Button></Link>
            ) : (
              <>
                <Link to="/review?extra=1"><Button variant="secondary">加练</Button></Link>
                <Link to="/add"><Button variant="ghost">导入题目</Button></Link>
              </>
            )}
          </div>
        )}
      </section>

      {plansFailed ? (
        <div className={styles.planError} role="alert">
          <p><strong>学习计划加载失败</strong>{plansError ? `：${plansError}` : ""}</p>
          <Button variant="secondary" onClick={() => { plans.refetch(); active.refetch(); }}>重试</Button>
        </div>
      ) : todayPlansReady && todayPlans.length > 0 && <TodayPlans plans={todayPlans} banks={banks.data ?? []} />}
      {showFreeAction && (
        <Link className={styles.planLink} to="/plans">
          {(plans.data?.length ?? 0) > 0 ? "管理学习计划" : "制定学习计划 · 设定每日目标"}
        </Link>
      )}

      <LoadForecast forecast={stats.forecast} />
      <Link to="/insights" className={styles.insightLink}>
        <span><small>用真实记录理解记忆</small><strong>记忆洞察</strong></span><span aria-hidden="true">→</span>
      </Link>
    </main>
  );
}
