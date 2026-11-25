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
