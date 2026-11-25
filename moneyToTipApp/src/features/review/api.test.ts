import { afterEach, expect, it, vi } from "vitest";
import { dueQuestion } from "../../test/factories";
import { submitReview } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("posts the same review payload without rewriting its idempotency key", async () => {
  const question = dueQuestion(1);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    log_id: 8,
    idempotent: false,
    state: question.state,
    decision: { interval_minutes: 480, due_at: "2026-11-25T08:00:00Z", algorithm_version: "ebbinghaus-v1" },
  }), { status: 201, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const payload = {
    question_id: 1,
    client_id: "original-key",
    correct: true,
    rating: "good" as const,
    duration_ms: 100,
  };

  await submitReview(payload);

  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(payload);
});
