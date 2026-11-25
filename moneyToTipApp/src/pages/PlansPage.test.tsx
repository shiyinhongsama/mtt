import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import PlansPage from "./PlansPage";

const plans = [
  { id: 1, name: "服务端计划", bank_id: null, daily_goal: 10, today_done: 2, goal_met: false, created_at: "2026-11-25" },
  { id: 2, name: "待加入计划", bank_id: null, daily_goal: 5, today_done: 0, goal_met: false, created_at: "2026-11-25" },
];

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("uses server preferences instead of a different local selection", async () => {
  setToken("valid");
  localStorage.setItem("mtt_active_plans", "[2]");
  const writes: number[][] = [];
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/plans") return Response.json(plans);
    if (url === "/api/v1/questions/banks") return Response.json([]);
    if (url === "/api/v1/plans/active" && init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)).plan_ids);
      return Response.json({ plan_ids: writes.at(-1) });
    }
    if (url === "/api/v1/plans/active") return Response.json({ plan_ids: [1] });
    throw new Error(`Unexpected request: ${url}`);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><PlansPage /></QueryClientProvider>);

  expect(await screen.findByText("服务端计划")).toBeVisible();
  expect(await screen.findByText("当前")).toBeVisible();
  expect(screen.getByText("待加入计划").closest(".plan-item")).not.toHaveClass("current");
  const joinButtons = screen.getAllByRole("button", { name: "加入今日" });
  await user.click(joinButtons[0]);
  expect(writes).toEqual([[1, 2]]);
  expect(localStorage.getItem("mtt_active_plans")).toBe("[2]");
});
