import { expect, it } from "vitest";
import { dueQuestion } from "../../test/factories";
import { initialReviewSession, reviewReducer } from "./session";

it("restores a snapshot and makes an interrupted submission explicitly retryable", () => {
  const question = dueQuestion(1);
  let state = reviewReducer(initialReviewSession, {
    type: "QUEUE_LOADED", queue: [question], planId: null, now: 100,
  });
  state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: "answer" });
  state = reviewReducer(state, { type: "RATE", rating: "good", clientId: "same-key", now: 200 });

  const restored = reviewReducer(initialReviewSession, { type: "RESTORE", state });

  expect(restored.phase).toBe("failed");
  expect(restored.error).toBe("连接中断，结果尚未保存");
  expect(restored.pendingSubmission?.client_id).toBe("same-key");
  expect(restored.current?.id).toBe(1);
});
