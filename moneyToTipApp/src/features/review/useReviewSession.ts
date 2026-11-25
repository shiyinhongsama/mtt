import { useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DueQuestion, Plan, Rating, UserInfo } from "../../api/types";
type Identity = Pick<UserInfo, "id" | "username" | "role">;
import { getActivePlanIds } from "../../pages/PlansPage";
import { submitReview } from "./api";
import { initialReviewSession, reviewReducer } from "./session";
import { loadReviewSnapshot, saveReviewSnapshot } from "./snapshot";

export default function useReviewSession(categoryId: number | null, bankId: number | null) {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewSession);
  const [restoredUser, setRestoredUser] = useState<number | null>(null);
  const restoredSnapshot = useRef(false);
  const activeSubmission = useRef<string | null>(null);
  const identity = useQuery({ queryKey: ["identity", "me"], queryFn: () => api<Identity>("/identity/me"), retry: false });
  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: () => api<Plan[]>("/plans"),
    enabled: Boolean(identity.data),
    retry: false,
  });
  const userId = identity.data?.id;
  const selectedPlan = plans.data?.find((plan) => getActivePlanIds().includes(plan.id)) ?? null;
  const effectiveBankId = selectedPlan?.bank_id ?? bankId;

  useEffect(() => {
    if (userId === undefined || restoredUser === userId) return;
    const saved = loadReviewSnapshot(userId);
    restoredSnapshot.current = saved !== null;
    if (saved) dispatch({ type: "RESTORE", state: saved });
    else dispatch({ type: "RESET" });
    setRestoredUser(userId);
  }, [restoredUser, userId]);

  const due = useQuery({
    queryKey: ["reviews", "due", categoryId, effectiveBankId, selectedPlan?.id ?? null],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(selectedPlan ? Math.max(1, selectedPlan.daily_goal - selectedPlan.today_done) : 20),
      });
      if (categoryId) params.set("category_id", String(categoryId));
      if (effectiveBankId) params.set("bank_id", String(effectiveBankId));
      return api<DueQuestion[]>(`/reviews/due?${params}`);
    },
    enabled: userId !== undefined && restoredUser === userId && !restoredSnapshot.current && plans.isSuccess,
    retry: false,
  });

  useEffect(() => {
    if (due.data) {
      dispatch({ type: "QUEUE_LOADED", queue: due.data, planId: selectedPlan?.id ?? null, now: Date.now() });
    }
  }, [due.data, selectedPlan?.id]);

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
    answer: (answer: string) => dispatch({ type: "ANSWER_REVEALED", answer }),
    rate: (rating: Rating) => dispatch({ type: "RATE", rating, clientId: crypto.randomUUID(), now: Date.now() }),
    retry: () => dispatch({ type: "RETRY" }),
    next: () => dispatch({ type: "NEXT", now: Date.now() }),
    reload: () => due.refetch(),
    activePlan: selectedPlan,
  };
}
