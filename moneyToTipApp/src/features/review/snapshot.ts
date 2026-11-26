import type { ReviewSessionState } from "./session";

const SNAPSHOT_KEY = "mtt_review_snapshot_v2";
const phases = new Set(["loading", "answering", "rating", "submitting", "submitted", "failed", "complete"]);

interface ReviewSnapshot {
  version: 2;
  userId: number;
  state: ReviewSessionState;
}

function isSession(value: unknown): value is ReviewSessionState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReviewSessionState>;
  if (!Array.isArray(state.queue) || !Array.isArray(state.relearningQueue)) return false;
  if (typeof state.phase !== "string" || !phases.has(state.phase)) return false;
  if (state.current === null) return state.phase === "complete" || state.phase === "loading";
  if (!state.current || typeof state.current.id !== "number") return false;
  return state.queue.some((question) => question.id === state.current?.id);
}

export function loadReviewSnapshot(userId: number): ReviewSessionState | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<ReviewSnapshot>;
    if (snapshot.version !== 2 || snapshot.userId !== userId || !isSession(snapshot.state)) {
      localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    // 已完成或还没建立的会话没有可恢复的内容，留着只会挡住下一轮
    if (snapshot.state.phase === "complete" || snapshot.state.phase === "loading") {
      localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    return snapshot.state;
  } catch {
    localStorage.removeItem(SNAPSHOT_KEY);
    return null;
  }
}

export function saveReviewSnapshot(userId: number, state: ReviewSessionState): void {
  // 只有进行中的会话值得恢复；完成时顺手清掉旧的
  if (state.phase === "complete") {
    clearReviewSnapshot();
    return;
  }
  if (state.phase === "loading") return;
  const snapshot: ReviewSnapshot = { version: 2, userId, state };
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearReviewSnapshot(): void {
  localStorage.removeItem(SNAPSHOT_KEY);
}
