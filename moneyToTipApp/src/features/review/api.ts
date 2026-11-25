import { api } from "../../api/client";
import type { ReviewResult, ReviewSubmit } from "../../api/types";

export function submitReview(payload: ReviewSubmit): Promise<ReviewResult> {
  return api<ReviewResult>("/reviews", { method: "POST", body: payload });
}
