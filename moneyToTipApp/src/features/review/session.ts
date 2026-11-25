import type { DueQuestion, Rating, ReviewResult, ReviewSubmit } from "../../api/types";

export type ReviewPhase = "loading" | "answering" | "rating" | "submitting" | "submitted" | "failed" | "complete";

export interface PendingSubmission extends ReviewSubmit {
  client_id: string;
}

export interface ReviewSessionState {
  phase: ReviewPhase;
  queue: DueQuestion[];
  current: DueQuestion | null;
  relearningQueue: DueQuestion[];
  answer: string;
  planId: number | null;
  pendingSubmission: PendingSubmission | null;
  lastResult: ReviewResult | null;
  error: string;
  shownAt: number;
}

export type ReviewEvent =
  | { type: "RESTORE"; state: ReviewSessionState }
  | { type: "QUEUE_LOADED"; queue: DueQuestion[]; planId: number | null; now?: number }
  | { type: "ANSWER_REVEALED"; answer: string }
  | { type: "RATE"; rating: Rating; clientId: string; now: number }
  | { type: "SUBMIT_SUCCEEDED"; result: ReviewResult }
  | { type: "SUBMIT_FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "NEXT"; now?: number }
  | { type: "RESET" };

export const initialReviewSession: ReviewSessionState = {
  phase: "loading",
  queue: [],
  current: null,
  relearningQueue: [],
  answer: "",
  planId: null,
  pendingSubmission: null,
  lastResult: null,
  error: "",
  shownAt: 0,
};

export function reviewReducer(
  state: ReviewSessionState,
  event: ReviewEvent,
): ReviewSessionState {
  switch (event.type) {
    case "RESTORE":
      if (event.state.phase === "submitting") {
        return {
          ...event.state,
          phase: "failed",
          error: "连接中断，结果尚未保存",
        };
      }
      return event.state;
    case "RESET":
      return initialReviewSession;
    case "QUEUE_LOADED":
      return {
        ...initialReviewSession,
        phase: event.queue.length > 0 ? "answering" : "complete",
        queue: event.queue,
        current: event.queue[0] ?? null,
        planId: event.planId,
        shownAt: event.now ?? 0,
      };
    case "ANSWER_REVEALED":
      if (state.phase !== "answering" || !state.current) return state;
      return { ...state, phase: "rating", answer: event.answer, error: "" };
    case "RATE": {
      if (state.phase !== "rating" || !state.current) return state;
      return {
        ...state,
        phase: "submitting",
        error: "",
        pendingSubmission: {
          question_id: state.current.id,
          client_id: event.clientId,
          correct: event.rating !== "again",
          rating: event.rating,
          duration_ms: state.shownAt > 0 ? Math.max(0, event.now - state.shownAt) : 0,
          plan_id: state.planId,
        },
      };
    }
    case "SUBMIT_SUCCEEDED": {
      if (state.phase !== "submitting" || !state.pendingSubmission) return state;
      const shouldRelearn = state.pendingSubmission.rating === "again" && state.current !== null;
      const relearningQueue = shouldRelearn && state.current &&
          !state.relearningQueue.some((question) => question.id === state.current?.id)
        ? [...state.relearningQueue, state.current]
        : state.relearningQueue;
      return { ...state, phase: "submitted", lastResult: event.result, relearningQueue };
    }
    case "SUBMIT_FAILED":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "failed", error: event.message };
    case "RETRY":
      if (state.phase !== "failed" || !state.pendingSubmission) return state;
      return { ...state, phase: "submitting", error: "" };
    case "NEXT": {
      if (state.phase !== "submitted") return state;
      const remaining = state.queue.slice(1);
      const nextQueue = remaining.length > 0 ? remaining : state.relearningQueue.slice(0, 1);
      const relearningQueue = remaining.length > 0 ? state.relearningQueue : state.relearningQueue.slice(1);
      const current = nextQueue[0] ?? null;
      return {
        ...state,
        phase: current ? "answering" : "complete",
        queue: nextQueue,
        current,
        relearningQueue,
        answer: "",
        pendingSubmission: null,
        lastResult: null,
        error: "",
        shownAt: event.now ?? 0,
      };
    }
  }
}
