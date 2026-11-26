import { useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DueQuestion, Plan, Rating, UserInfo } from "../../api/types";
import { submitReview } from "./api";
import { initialReviewSession, reviewReducer } from "./session";
import { clearReviewSnapshot, loadReviewSnapshot, saveReviewSnapshot } from "./snapshot";

type Identity = Pick<UserInfo, "id" | "username" | "role">;

const FREE_SESSION_SIZE = 20;
const MAX_DUE_LIMIT = 100;

/** planId 指向今日计划中的计划时，本轮只服务这个计划；否则是自由模式 */
export default function useReviewSession(categoryId: number | null, bankId: number | null, planId: number | null = null) {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewSession);
  const [restoredUser, setRestoredUser] = useState<number | null>(null);
  const restoredSnapshot = useRef(false);
  const queueLoaded = useRef(false);
  const activeSubmission = useRef<string | null>(null);
  const identity = useQuery({ queryKey: ["identity", "me"], queryFn: () => api<Identity>("/identity/me"), retry: false });
  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<Plan[]>("/plans"),
    enabled: Boolean(identity.data),
    retry: false,
  });
  const active = useQuery({
    queryKey: ["plans", "active"],
    queryFn: () => api<{ plan_ids: number[] }>("/plans/active"),
    enabled: Boolean(identity.data),
    retry: false,
  });
  const userId = identity.data?.id;
  const activeIds = active.data?.plan_ids ?? [];
  const requestedPlan = planId !== null && activeIds.includes(planId)
    ? plans.data?.find((item) => item.id === planId) ?? null
    : null;
  // 目标是完成今日目标，不是清空到期题；接口单次最多 100 题
  const limit = requestedPlan && !requestedPlan.goal_met
    ? Math.min(MAX_DUE_LIMIT, Math.max(1, requestedPlan.daily_goal - requestedPlan.today_done))
    : FREE_SESSION_SIZE;
  const effectiveBankId = requestedPlan?.bank_id ?? bankId;

  useEffect(() => {
    if (userId === undefined) return;
    // 换了入口（比如从今日页点了另一个计划）就是新一轮，同一入口才续上之前的会话；
    // 没保存成功的作答例外，不能让它悄悄丢掉
    const saved = loadReviewSnapshot(userId);
    const unsaved = saved !== null && (saved.phase === "submitting" || saved.phase === "failed");
    restoredSnapshot.current = saved !== null && (unsaved || saved.planId === planId);
    queueLoaded.current = false;
    if (restoredSnapshot.current && saved) {
      dispatch({ type: "RESTORE", state: saved });
    } else {
      if (saved) clearReviewSnapshot();
      dispatch({ type: "RESET" });
    }
    setRestoredUser(userId);
  }, [userId, planId]);

  const due = useQuery({
    queryKey: ["reviews", "due", categoryId, effectiveBankId, requestedPlan?.id ?? null, limit],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (categoryId) params.set("category_id", String(categoryId));
      if (effectiveBankId) params.set("bank_id", String(effectiveBankId));
      return api<DueQuestion[]>(`/reviews/due?${params}`);
    },
    enabled: userId !== undefined && restoredUser === userId && !restoredSnapshot.current && plans.isSuccess && active.isSuccess,
    retry: false,
  });

  useEffect(() => {
    // 只认挂载后新拉取且已稳定的结果：缓存里的旧队列不能重建一次已完成的复习，
    // 后台刷新也不能重置进行中的会话
    if (restoredSnapshot.current || queueLoaded.current) return;
    if (!due.data || due.isError || due.isFetching || !due.isFetchedAfterMount) return;
    queueLoaded.current = true;
    dispatch({ type: "QUEUE_LOADED", queue: due.data, planId: requestedPlan?.id ?? null, now: Date.now() });
  }, [due.data, due.isError, due.isFetching, due.isFetchedAfterMount, requestedPlan?.id]);

  useEffect(() => {
    if (userId !== undefined && restoredUser === userId) saveReviewSnapshot(userId, state);
  }, [restoredUser, state, userId]);

  const mutation = useMutation({ mutationFn: submitReview, retry: false });
  useEffect(() => {
    if (state.phase !== "submitting" || !state.pendingSubmission) return;
    const payload = state.pendingSubmission;
    if (activeSubmission.current === payload.client_id) return;
    activeSubmission.current = payload.client_id;
    mutation.mutate(payload, {
      onSuccess: (result) => {
        activeSubmission.current = null;
        window.dispatchEvent(new Event("mtt:review-submitted"));
        dispatch({ type: "SUBMIT_SUCCEEDED", result });
      },
      onError: (error) => {
        activeSubmission.current = null;
        dispatch({ type: "SUBMIT_FAILED", message: error instanceof Error ? error.message : "网络不通，稍后再试" });
      },
    });
  }, [mutation, state.pendingSubmission, state.phase]);

  return {
    state,
    identity,
    due,
    plans,
    active,
    // 标题栏跟的是会话自己的计划：续上的可能是另一个入口没存完的那一轮
    plan: state.planId === null ? null : plans.data?.find((item) => item.id === state.planId) ?? null,
    answer: (answer: string) => dispatch({ type: "ANSWER_REVEALED", answer }),
    rate: (rating: Rating) => dispatch({ type: "RATE", rating, clientId: crypto.randomUUID(), now: Date.now() }),
    retry: () => dispatch({ type: "RETRY" }),
    next: () => dispatch({ type: "NEXT", now: Date.now() }),
    reload: () => due.refetch(),
  };
}
