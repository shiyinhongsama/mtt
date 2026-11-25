import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import type { Question } from "../api/types";
import LibraryPage from "./LibraryPage";

function question(id: number, stem: string): Question {
  return { id, stem, answer: "标准答案", qtype: "blank", options: [], explanation: "讲解",
    source: "test.md", tags: ["测试"], difficulty: 3, status: "pending", category_id: null, bank_id: 1 };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><LibraryPage /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("searches, selects, and reports partial bulk confirmation failures", async () => {
  setToken("valid");
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/v1/questions?")) {
      return Response.json({ total: 2, items: [question(1, "事务与隔离"), question(2, "缺失答案的题")] });
    }
    if (url === "/api/v1/questions/bulk-confirm" && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ ids: [1] });
      return Response.json({ confirmed_ids: [1], failures: [{ id: 2, reason: "答案不能为空" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  renderPage();

  await user.type(await screen.findByRole("searchbox", { name: "搜索题目" }), "事务");
  expect(await screen.findByRole("heading", { name: "事务与隔离" })).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "选择事务与隔离" }));
  expect(screen.getByText("已选 1 项")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "批量确认" }));
  expect(await screen.findByText("1 道已确认，1 道需要修正")).toBeVisible();
});

it("asks before closing a dirty editor without using native confirmation", async () => {
  setToken("valid");
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ total: 1, items: [question(1, "事务与隔离")] })));
  renderPage();

  await user.click(await screen.findByRole("button", { name: "编辑事务与隔离" }));
  const editor = screen.getByRole("dialog", { name: "编辑题目" });
  await user.type(screen.getByLabelText("题面"), "（已修改）");
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("题面")).toHaveValue("事务与隔离（已修改）");
  expect(editor).toBeVisible();
});
