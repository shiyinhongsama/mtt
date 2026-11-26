import { afterEach, describe, expect, it } from "vitest";
import { dueQuestion } from "../../test/factories";
import { clearReviewSnapshot, loadReviewSnapshot, saveReviewSnapshot } from "./snapshot";
import { initialReviewSession, reviewReducer } from "./session";

afterEach(() => localStorage.clear());

describe("review snapshots", () => {
  it("restores the current session for the same user", () => {
    const state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [dueQuestion(4)], planId: 2,
    });

    saveReviewSnapshot(4, state);

    expect(loadReviewSnapshot(4)).toEqual(state);
  });

  it("isolates users and clears both review and authentication state", () => {
    const state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [dueQuestion(4)], planId: null,
    });
    saveReviewSnapshot(4, state);
    localStorage.setItem("mtt_token", "secret");

    expect(loadReviewSnapshot(5)).toBeNull();
    clearReviewSnapshot();
    localStorage.removeItem("mtt_token");

    expect(loadReviewSnapshot(4)).toBeNull();
    expect(localStorage.getItem("mtt_token")).toBeNull();
  });

  it("drops a finished session instead of restoring it", () => {
    let finished = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [dueQuestion(4)], planId: null,
    });
    finished = reviewReducer(finished, { type: "ANSWER_REVEALED", answer: "答案" });
    finished = reviewReducer(finished, { type: "RATE", rating: "good", clientId: "same-key", now: 200 });
    finished = reviewReducer(finished, {
      type: "SUBMIT_SUCCEEDED",
      result: {
        log_id: 9, idempotent: false, state: finished.current!.state,
        decision: { interval_minutes: 480, due_at: "2026-11-25T08:00:00Z", algorithm_version: "ebbinghaus-v1" },
      },
    });
    finished = reviewReducer(finished, { type: "NEXT", now: 300 });
    expect(finished.phase).toBe("complete");

    saveReviewSnapshot(4, finished);
    expect(loadReviewSnapshot(4)).toBeNull();

    // 旧版本留下的完成快照
    localStorage.setItem("mtt_review_snapshot_v2", JSON.stringify({ version: 2, userId: 4, state: finished }));
    expect(loadReviewSnapshot(4)).toBeNull();
    expect(localStorage.getItem("mtt_review_snapshot_v2")).toBeNull();
  });

  it("never persists a session that has not loaded", () => {
    saveReviewSnapshot(4, initialReviewSession);

    expect(localStorage.getItem("mtt_review_snapshot_v2")).toBeNull();
  });

  it("drops a leftover loading snapshot", () => {
    localStorage.setItem("mtt_review_snapshot_v2", JSON.stringify({ version: 2, userId: 4, state: initialReviewSession }));

    expect(loadReviewSnapshot(4)).toBeNull();
    expect(localStorage.getItem("mtt_review_snapshot_v2")).toBeNull();
  });

  it("rejects malformed or structurally invalid snapshots", () => {
    localStorage.setItem("mtt_review_snapshot_v2", "not-json");
    expect(loadReviewSnapshot(4)).toBeNull();

    localStorage.setItem("mtt_review_snapshot_v2", JSON.stringify({
      version: 2,
      userId: 4,
      state: { ...initialReviewSession, current: dueQuestion(99), queue: [] },
    }));
    expect(loadReviewSnapshot(4)).toBeNull();
  });
});
