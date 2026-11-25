import type { DueQuestion, RatingPreview } from "../api/types";

const preview = (interval_minutes: number): RatingPreview => ({
  interval_minutes,
  due_at: new Date(Date.UTC(2026, 10, 25, 0, 0) + interval_minutes * 60_000).toISOString(),
  status: interval_minutes === 10 ? "relearning" : "review",
});

export function dueQuestion(id: number): DueQuestion {
  return {
    id,
    qtype: "qa",
    stem: `测试题目 ${id}`,
    options: [],
    answer: `标准答案 ${id}`,
    explanation: "测试讲解",
    source: "test.md",
    tags: ["测试"],
    difficulty: 3,
    status: "active",
    category_id: 1,
    bank_id: 1,
    state: { status: "review", label: "稳定复习", due_at: "2026-11-25T00:00:00Z" },
    rating_previews: {
      again: preview(10),
      hard: preview(240),
      good: preview(480),
      easy: preview(1440),
    },
  };
}
