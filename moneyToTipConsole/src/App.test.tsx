import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import App from "./App";
import { setToken } from "./api";

vi.mock("./pages/UsersPage", () => ({ default: () => <h1>账户管理</h1> }));
vi.mock("@uiw/react-md-editor", () => ({ default: () => <div data-testid="markdown-editor" /> }));

const stats = {
  mature_count: 0,
  due_today: 0,
  reviewed_today: 0,
  active_questions: 0,
  status_counts: { pending: 2 },
  by_bank: [],
  heatmap: [],
  by_category: [],
};

const banks = [{
  id: 2,
  name: "工作",
  description: "",
  is_default: false,
  question_count: 0,
  created_at: "2026-11-26T00:00:00Z",
}];

function mockApi() {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/v1/questions?")) return Response.json({ total: 0, items: [] });
    if (url === "/api/v1/questions/banks") return Response.json(banks);
    if (url === "/api/v1/questions/categories/tree") return Response.json([]);
    if (url === "/api/v1/stats") return Response.json(stats);
    throw new Error(`Unexpected request: ${url}`);
  }));
  return urls;
}

function renderApp(hash: string) {
  window.history.replaceState(null, "", hash);
  return render(
    <AntdApp>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </AntdApp>,
  );
}

it("restores question filters from the hash after a refresh", async () => {
  setToken("admin-token");
  const urls = mockApi();
  renderApp("#/questions?status=pending&bank=2");

  expect(await screen.findByRole("heading", { name: "题目" })).toBeVisible();
  expect(await screen.findByText("预览区")).toBeVisible();
  expect(await screen.findByText("工作")).toBeVisible();
  await waitFor(() => expect(urls.some((url) =>
    url.startsWith("/api/v1/questions?") && url.includes("status=pending") && url.includes("bank_id=2"),
  )).toBe(true));
  expect(window.location.hash).toBe("#/questions?status=pending&bank=2");
});

it("navigates to accounts and keeps that location across remounts", async () => {
  const user = userEvent.setup();
  setToken("admin-token");
  mockApi();
  renderApp("#/dashboard");

  await user.click(await screen.findByRole("menuitem", { name: /账户/ }));
  expect(await screen.findByRole("heading", { name: "账户管理" })).toBeVisible();
  expect(window.location.hash).toBe("#/users");

  cleanup();
  renderApp(window.location.hash);
  expect(await screen.findByRole("heading", { name: "账户管理" })).toBeVisible();
});

it("puts dashboard question filters into search params", async () => {
  const user = userEvent.setup();
  setToken("admin-token");
  const urls = mockApi();
  renderApp("#/dashboard");

  await user.click(await screen.findByRole("link", { name: /预览区待确认/ }));
  expect(await screen.findByRole("heading", { name: "题目" })).toBeVisible();
  await waitFor(() => expect(window.location.hash).toBe("#/questions?status=pending"));
  expect(urls.some((url) => url.includes("status=pending"))).toBe(true);
});
