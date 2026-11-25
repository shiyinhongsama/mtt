import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import { dueQuestion } from "../test/factories";
import ReviewPage from "./ReviewPage";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("keeps the question on failure, retries the same key, then advances", async () => {
  setToken("valid");
  const user = userEvent.setup();
  const first = dueQuestion(1);
  const second = dueQuestion(2);
  const reviewBodies: Record<string, unknown>[] = [];
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") {
      return new Response(JSON.stringify({ id: 4, username: "tester", role: "user" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/v1/plans") {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("/api/v1/reviews/due")) {
      return new Response(JSON.stringify([first, second]),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/v1/reviews" && init?.method === "POST") {
      attempts += 1;
      reviewBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (attempts === 1) throw new TypeError("offline");
      return new Response(JSON.stringify({
        log_id: 9,
        idempotent: false,
        state: first.state,
        decision: { interval_minutes: 480, due_at: "2026-11-25T08:00:00Z", algorithm_version: "ebbinghaus-v1" },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  renderPage();

  expect(await screen.findByText("测试题目 1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "心里想好答案了，对照标准答案" }));
  const good = screen.getByRole("button", { name: /记得/ });
  expect(good).toHaveTextContent("8 小时");
  await user.click(good);
  expect(good).toBeDisabled();

  expect(await screen.findByText("结果尚未保存")).toBeVisible();
  expect(screen.getByText("测试题目 1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("button", { name: "下一题" })).toBeVisible();
  expect(reviewBodies).toHaveLength(2);
  expect(reviewBodies[1].client_id).toBe(reviewBodies[0].client_id);

  await user.click(screen.getByRole("button", { name: "下一题" }));
  expect(screen.getByText("测试题目 2")).toBeVisible();
});


it("keeps the current question when a later queue refresh fails", async () => {
  setToken("valid");
  const first = dueQuestion(1);
  let dueRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") {
      return new Response(JSON.stringify({ id: 4, username: "tester", role: "user" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/v1/plans") {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("/api/v1/reviews/due")) {
      dueRequests += 1;
      return dueRequests === 1
        ? new Response(JSON.stringify([first]), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ detail: "服务暂不可用" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><ReviewPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("测试题目 1")).toBeVisible();

  const { act } = await import("@testing-library/react");
  await act(() => client.invalidateQueries({ queryKey: ["reviews", "due"] }));

  expect(await screen.findByText(/队列刷新失败/)).toBeVisible();
  expect(screen.getByText("测试题目 1")).toBeVisible();
  expect(screen.queryByText("这轮复习完成了")).not.toBeInTheDocument();
});

it("restores the saved question after an authentication retry", async () => {
  setToken("expired");
  const { initialReviewSession, reviewReducer } = await import("../features/review/session");
  const { saveReviewSnapshot } = await import("../features/review/snapshot");
  let state = reviewReducer(initialReviewSession, {
    type: "QUEUE_LOADED", queue: [dueQuestion(7)], planId: null, now: 100,
  });
  state = reviewReducer(state, { type: "ANSWER_REVEALED", answer: " remembered " });
  saveReviewSnapshot(4, state);
  let identityRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") {
      identityRequests += 1;
      return identityRequests === 1
        ? new Response(JSON.stringify({ detail: "expired" }), { status: 401, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ id: 4, username: "tester", role: "user" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "/api/v1/plans") {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  renderPage();
  expect(await screen.findByText("登录已失效")).toBeVisible();

  setToken("valid");
  await userEvent.click(screen.getByRole("button", { name: "重试" }));

  expect(await screen.findByText("测试题目 7")).toBeVisible();
  expect(screen.getByRole("button", { name: /记得/ })).toBeVisible();
});
