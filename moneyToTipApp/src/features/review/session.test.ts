import { describe, expect, it } from "vitest";
import { dueQuestion } from "../../test/factories";
import { initialReviewSession, reviewReducer } from "./session";

describe("reviewReducer", () => {
  it("does not advance on failure and retries the same client id", () => {
    const question = dueQuestion(7);
    const answering = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [question], planId: 3, now: 900,
    });
    const rating = reviewReducer(answering, { type: "ANSWER_REVEALED", answer: "my answer" });
    const submitting = reviewReducer(rating, {
      type: "RATE", rating: "good", clientId: "stable-key", now: 1000,
    });

    expect(submitting.pendingSubmission).toEqual({
      question_id: 7,
      client_id: "stable-key",
      correct: true,
      rating: "good",
      duration_ms: 100,
      plan_id: 3,
    });

    const failed = reviewReducer(submitting, { type: "SUBMIT_FAILED", message: "offline" });
    expect(failed.current?.id).toBe(7);
    expect(failed.answer).toBe("my answer");
    expect(failed.phase).toBe("failed");
    expect(failed.pendingSubmission?.client_id).toBe("stable-key");

    const retrying = reviewReducer(failed, { type: "RETRY" });
    expect(retrying.pendingSubmission?.client_id).toBe("stable-key");
    expect(retrying.phase).toBe("submitting");
  });

  it("moves an again rating to the session relearning queue", () => {
    const first = dueQuestion(1);
    const second = dueQuestion(2);
    let state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [first, second], planId: null, now: 900,
    });
    state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: "" });
    state = reviewReducer(state, { type: "RATE", rating: "again", clientId: "again-1", now: 1000 });
    state = reviewReducer(state, { type: "SUBMIT_SUCCEEDED", result: {
      log_id: 9,
      idempotent: false,
      state: first.state,
      decision: {
        interval_minutes: 10,
        due_at: "2026-11-25T00:10:00Z",
        algorithm_version: "ebbinghaus-v1",
      },
    } });
    state = reviewReducer(state, { type: "NEXT", now: 1100 });

    expect(state.current?.id).toBe(2);
    expect(state.relearningQueue.map((question) => question.id)).toEqual([1]);
  });

  it("offers the relearning question after the original queue is exhausted", () => {
    const question = dueQuestion(1);
    let state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [question], planId: null, now: 100,
    });
    state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: "" });
    state = reviewReducer(state, { type: "RATE", rating: "again", clientId: "again-1", now: 200 });
    state = reviewReducer(state, { type: "SUBMIT_SUCCEEDED", result: {
      log_id: 9,
      idempotent: false,
      state: { ...question.state, status: "relearning", label: "重学中" },
      decision: { interval_minutes: 10, due_at: "2026-11-25T00:10:00Z", algorithm_version: "ebbinghaus-v1" },
    } });
    state = reviewReducer(state, { type: "NEXT", now: 300 });

    expect(state.current?.id).toBe(1);
    expect(state.phase).toBe("answering");
    expect(state.relearningQueue).toEqual([]);
    expect(state.pendingSubmission).toBeNull();
  });

  it("never advances before the server acknowledges a submission", () => {
    let state = reviewReducer(initialReviewSession, {
      type: "QUEUE_LOADED", queue: [dueQuestion(1), dueQuestion(2)], planId: null,
    });
    state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: "answer" });
    state = reviewReducer(state, { type: "RATE", rating: "good", clientId: "key", now: 100 });
    const next = reviewReducer(state, { type: "NEXT" });

    expect(next).toBe(state);
    expect(next.current?.id).toBe(1);
  });
});
