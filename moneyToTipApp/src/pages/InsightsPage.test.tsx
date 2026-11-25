import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import InsightsPage from "./InsightsPage";

const insight = {
  retention: { recalled: 15, total: 19, rate: null },
  learning_count: 3,
  review_count: 7,
  recovered_count: 2,
  forecast: Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-${26 + index}`, count: index })),
  weak_categories: [{ category_id: 3, name: "网络", recalled: 15, total: 19, rate: 15 / 19, due_count: 4 }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><InsightsPage /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("shows counts without an unstable small-sample percentage and explains the model", async () => {
  setToken("valid");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(insight)));
  renderPage();

  expect(await screen.findByText("15 / 19 次回忆成功")).toBeVisible();
  expect(screen.getByText("再完成 1 次有效复习后显示保持率")).toBeVisible();
  expect(screen.queryByText("78.9%")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /网络/ })).toHaveAttribute("href", "/library?category_id=3");
  expect(screen.getByText(/19 次样本/)).toBeVisible();
  expect(screen.getByText(/R\(t\) = exp\(-t\/S\)/)).toBeInTheDocument();
  expect(screen.getByText(/不承诺记忆效果/)).toBeInTheDocument();
});

it("shows an honest empty state when there are no valid reviews", async () => {
  setToken("valid");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...insight,
    retention: { recalled: 0, total: 0, rate: null }, learning_count: 0,
    review_count: 0, recovered_count: 0, weak_categories: [] })));
  renderPage();

  expect(await screen.findByText("还没有足够的复习记录")).toBeVisible();
  expect(screen.getByText("0 / 0 次回忆成功")).toBeVisible();
  expect(screen.queryByText("0%")).not.toBeInTheDocument();
});
