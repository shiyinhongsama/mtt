import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

const planRows = [
  { id: 1, name: "学习科学", bank_id: 3, daily_goal: 10, today_done: 2, goal_met: false, created_at: "2026-11-25" },
  { id: 2, name: "Python", bank_id: 4, daily_goal: 5, today_done: 5, goal_met: true, created_at: "2026-11-25" },
  { id: 3, name: "未加入的计划", bank_id: null, daily_goal: 8, today_done: 0, goal_met: false, created_at: "2026-11-25" },
];

const bankRows = [
  { id: 3, name: "学习科学题库", is_default: false },
  { id: 4, name: "Python 题库", is_default: false },
];

/** 今日页依赖的接口桩；failing 指定哪个地址先失败几次 */
function stubApi({
  stats = today, plans = planRows, active = [1, 2], banks = bankRows, failing,
}: {
  stats?: unknown;
  plans?: unknown[];
  active?: number[];
  banks?: unknown[];
  failing?: { path: string; times?: number };
} = {}) {
  let failures = failing?.times ?? Infinity;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing?.path === url && failures > 0) {
      failures -= 1;
      return new Response(JSON.stringify({ detail: "服务暂不可用" }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/v1/stats/today") return Response.json(stats);
    if (url === "/api/v1/plans") return Response.json(plans);
    if (url === "/api/v1/plans/active") return Response.json({ plan_ids: active });
    if (url === "/api/v1/questions/banks") return Response.json(banks);
    throw new Error(`Unexpected request: ${url}`);
  }));
}

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
  stubApi({ active: [] });
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
  stubApi({
    active: [],
    stats: { ...today, due_count: 0, new_count: 0, relearning_count: 0, completed_count: 20, goal_met: true, shortage_reason: null },
  });
  renderPage();

  expect(await screen.findByText("今日目标已完成")).toBeVisible();
  expect(screen.getByRole("link", { name: "加练" })).toBeVisible();
  expect(screen.getByRole("link", { name: "导入题目" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "继续今日复习" })).not.toBeInTheDocument();
});

it("provides a retry when the dashboard cannot load", async () => {
  setToken("valid");
  const user = userEvent.setup();
  stubApi({ failing: { path: "/api/v1/stats/today", times: 1 } });
  renderPage();

  expect(await screen.findByText("服务暂不可用")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("12 / 20")).toBeVisible();
});

it("lists each plan in today with its own progress and entry", async () => {
  setToken("valid");
  stubApi();
  renderPage();

  const section = await screen.findByRole("region", { name: "今日计划" });

  expect(within(section).getByRole("heading", { name: "学习科学" })).toBeVisible();
  expect(await within(section).findByText("学习科学题库 · 每天 10 题")).toBeVisible();
  expect(within(section).getByText("今日 2 / 10 题")).toBeVisible();
  expect(within(section).getByRole("link", { name: /继续/ })).toHaveAttribute("href", "/review?plan=1");

  expect(within(section).getByRole("heading", { name: "Python" })).toBeVisible();
  expect(within(section).getByText("今日 5 / 5 题")).toBeVisible();
  expect(within(section).getByText("已达成")).toBeVisible();
  expect(within(section).getByRole("link", { name: /加练/ })).toHaveAttribute("href", "/review?plan=2");

  expect(within(section).queryByText("未加入的计划")).not.toBeInTheDocument();
  expect(within(section).getByRole("link", { name: "管理计划" })).toHaveAttribute("href", "/plans");
  expect(within(section).getByRole("link", { name: /自由刷题/ })).toHaveAttribute("href", "/review");

  // 总览保留，主按钮让位给每个计划自己的入口
  expect(screen.getByText("12 / 20")).toBeVisible();
  expect(screen.queryByRole("link", { name: "继续今日复习" })).not.toBeInTheDocument();
});

it("offers a first plan when there is none", async () => {
  setToken("valid");
  stubApi({ plans: [], active: [] });
  renderPage();

  expect(await screen.findByRole("link", { name: "继续今日复习" })).toHaveAttribute("href", "/review");
  expect(screen.getByRole("link", { name: "制定学习计划 · 设定每日目标" })).toHaveAttribute("href", "/plans");
});

it("links to plan management when no plan is in today", async () => {
  setToken("valid");
  stubApi({ active: [] });
  renderPage();

  expect(await screen.findByRole("link", { name: "管理学习计划" })).toHaveAttribute("href", "/plans");
  expect(screen.queryByRole("region", { name: "今日计划" })).not.toBeInTheDocument();
});

it("shows the failure and a retry when today's plans cannot load", async () => {
  setToken("valid");
  const user = userEvent.setup();
  stubApi({ failing: { path: "/api/v1/plans" } });
  renderPage();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("学习计划加载失败");
  expect(alert).toHaveTextContent("服务暂不可用");
  expect(screen.getByRole("link", { name: "继续今日复习" })).toBeVisible();

  stubApi();
  await user.click(within(alert).getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("region", { name: "今日计划" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
