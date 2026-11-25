import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import TodayPage from "./TodayPage";

const today = {
  due_count: 5,
  new_count: 2,
  relearning_count: 1,
  completed_count: 12,
  goal_count: 20,
  goal_met: false,
  shortage_reason: "not_enough_due_questions",
  estimated_minutes: null,
  forecast: Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-${25 + index}`, count: index + 5 })),
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><TodayPage /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("shows truthful progress, shortage, and a single primary action", async () => {
  setToken("valid");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(today),
    { status: 200, headers: { "Content-Type": "application/json" } })));
  renderPage();

  expect(await screen.findByRole("link", { name: "继续今日复习" })).toBeVisible();
  expect(screen.getByText("12 / 20")).toBeVisible();
  expect(screen.getByText("到期题不足")).toBeVisible();
  expect(screen.queryByText(/预计 .* 分钟/)).not.toBeInTheDocument();
  expect(screen.getByText("未来 7 天")).toBeVisible();
  expect(screen.getByRole("link", { name: /记忆洞察/ })).toBeVisible();
  expect(screen.getAllByRole("link", { name: "继续今日复习" })).toHaveLength(1);
});

it("offers only secondary actions after the goal is complete", async () => {
  setToken("valid");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ...today, due_count: 0, new_count: 0, relearning_count: 0,
    completed_count: 20, goal_met: true, shortage_reason: null,
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  renderPage();

  expect(await screen.findByText("今日目标已完成")).toBeVisible();
  expect(screen.getByRole("link", { name: "加练" })).toBeVisible();
  expect(screen.getByRole("link", { name: "导入题目" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "继续今日复习" })).not.toBeInTheDocument();
});

it("provides a retry when the dashboard cannot load", async () => {
  setToken("valid");
  const user = userEvent.setup();
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    requests += 1;
    return requests === 1
      ? new Response(JSON.stringify({ detail: "服务暂不可用" }), { status: 500, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify(today), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  renderPage();

  expect(await screen.findByText("服务暂不可用")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("12 / 20")).toBeVisible();
});
