import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import type { DueQuestion } from "../api/types";
import { dueQuestion } from "../test/factories";
import { initialReviewSession, reviewReducer } from "../features/review/session";
import { saveReviewSnapshot } from "../features/review/snapshot";
import ReviewPage from "./ReviewPage";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPage(route = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const planRows = [
  { id: 7, name: "第一个计划", bank_id: 3, daily_goal: 5, today_done: 1, goal_met: false, created_at: "2026-11-25" },
  { id: 8, name: "第二个计划", bank_id: null, daily_goal: 10, today_done: 0, goal_met: false, created_at: "2026-11-25" },
  { id: 9, name: "已达成的计划", bank_id: 3, daily_goal: 5, today_done: 5, goal_met: true, created_at: "2026-11-25" },
];

/** 复习页依赖的接口桩：记录拉题地址和提交体 */
function stubReviewApi({
  plans = planRows, active = [7, 8, 9], question = dueQuestion(3), failPlansOnce = false,
}: { plans?: unknown[]; active?: number[]; question?: DueQuestion; failPlansOnce?: boolean } = {}) {
  const calls = { dueUrls: [] as string[], bodies: [] as Record<string, unknown>[] };
  let planRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") return Response.json({ id: 4, username: "tester", role: "user" });
    if (url === "/api/v1/plans") {
      planRequests += 1;
      return failPlansOnce && planRequests === 1
        ? new Response(JSON.stringify({ detail: "服务暂不可用" }), { status: 500, headers: { "Content-Type": "application/json" } })
        : Response.json(plans);
    }
    if (url === "/api/v1/plans/active") return Response.json({ plan_ids: active });
    if (url.startsWith("/api/v1/reviews/due")) {
      calls.dueUrls.push(url);
      return Response.json([question]);
    }
    if (url === "/api/v1/reviews" && init?.method === "POST") {
      calls.bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        log_id: 9,
        idempotent: false,
        state: question.state,
        decision: { interval_minutes: 480, due_at: "2026-11-25T08:00:00Z", algorithm_version: "ebbinghaus-v1" },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  return calls;
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
    if (url === "/api/v1/plans/active") {
      return new Response(JSON.stringify({ plan_ids: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
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

it("fetches a new queue instead of replaying the finished session", async () => {
  setToken("valid");
  const user = userEvent.setup();
  const first = dueQuestion(1);
  const second = dueQuestion(2);
  let dueRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") {
      return Response.json({ id: 4, username: "tester", role: "user" });
    }
    if (url === "/api/v1/plans") return Response.json([]);
    if (url === "/api/v1/plans/active") return Response.json({ plan_ids: [] });
    if (url.startsWith("/api/v1/reviews/due")) {
      dueRequests += 1;
      return Response.json(dueRequests === 1 ? [first] : [second]);
    }
    if (url === "/api/v1/reviews" && init?.method === "POST") {
      return new Response(JSON.stringify({
        log_id: 9,
        idempotent: false,
        state: first.state,
        decision: { interval_minutes: 480, due_at: "2026-11-25T08:00:00Z", algorithm_version: "ebbinghaus-v1" },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/review"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/today" element={<Link to="/review">再去复习</Link>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("测试题目 1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "心里想好答案了，对照标准答案" }));
  await user.click(screen.getByRole("button", { name: /记得/ }));
  expect(await screen.findByRole("button", { name: "下一题" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一题" }));
  expect(await screen.findByText("这轮复习完成了")).toBeVisible();

  // 和真实操作一致：返回今日，再从今日重新进入复习
  await user.click(screen.getByRole("link", { name: "返回今日" }));
  await user.click(screen.getByRole("link", { name: "再去复习" }));

  expect(await screen.findByText("测试题目 2")).toBeVisible();
  expect(screen.queryByText("测试题目 1")).not.toBeInTheDocument();
  expect(dueRequests).toBe(2);
});

it("binds the session to the plan named in the URL, not the first active plan", async () => {
  setToken("valid");
  const user = userEvent.setup();
  const calls = stubReviewApi();
  renderPage("/review?plan=8");

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(screen.getByText("第二个计划")).toBeVisible();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=10"]);

  await user.click(screen.getByRole("button", { name: "心里想好答案了，对照标准答案" }));
  await user.click(screen.getByRole("button", { name: /记得/ }));
  expect(await screen.findByRole("button", { name: "下一题" })).toBeVisible();
  expect(calls.bodies[0].plan_id).toBe(8);
});

it("reviews beyond the goal inside the plan bank when the plan is already met", async () => {
  setToken("valid");
  const calls = stubReviewApi();
  renderPage("/review?plan=9");

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=20&bank_id=3"]);
});

it("starts a free session when the URL names no plan", async () => {
  setToken("valid");
  const calls = stubReviewApi();
  renderPage("/review");

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(screen.getByText("按记忆状态，逐题巩固")).toBeVisible();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=20"]);
});

it("treats a plan outside today's list as a free session", async () => {
  setToken("valid");
  const calls = stubReviewApi();
  renderPage("/review?plan=99");

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=20"]);
});

it("offers a retry when today's plans cannot load", async () => {
  setToken("valid");
  const user = userEvent.setup();
  const calls = stubReviewApi({ failPlansOnce: true });
  renderPage("/review?plan=8");

  expect(await screen.findByText("服务暂不可用")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试" }));

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=10"]);
});

it("keeps loading instead of calling an unusable queue a finished session", async () => {
  setToken("valid");
  const question = dueQuestion(3);
  const calls = stubReviewApi({ question });
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/v1/reviews/due")) {
      calls.dueUrls.push(url);
      return Response.json(null);
    }    return base(input, init);
  });
  renderPage("/review");

  await waitFor(() => expect(calls.dueUrls).toHaveLength(1));
  expect(screen.getByRole("status", { name: "载入中" })).toBeVisible();
  expect(screen.queryByText("这轮复习完成了")).not.toBeInTheDocument();
});

it("starts the requested plan instead of resuming a session from another entry", async () => {
  setToken("valid");
  // 上一次没做完的自由复习还留在本地
  const leftover = reviewReducer(initialReviewSession, {
    type: "QUEUE_LOADED", queue: [dueQuestion(1)], planId: null, now: 100,
  });
  saveReviewSnapshot(4, leftover);
  const calls = stubReviewApi();
  renderPage("/review?plan=8");

  expect(await screen.findByText("测试题目 3")).toBeVisible();
  expect(screen.queryByText("测试题目 1")).not.toBeInTheDocument();
  expect(calls.dueUrls).toEqual(["/api/v1/reviews/due?limit=10"]);
});

it("resumes the same plan's unfinished session without fetching again", async () => {
  setToken("valid");
  const unfinished = reviewReducer(initialReviewSession, {
    type: "QUEUE_LOADED", queue: [dueQuestion(1), dueQuestion(2)], planId: 8, now: 100,
  });
  saveReviewSnapshot(4, unfinished);
  const calls = stubReviewApi();
  renderPage("/review?plan=8");

  expect(await screen.findByText("测试题目 1")).toBeVisible();
  expect(screen.getByText("第二个计划")).toBeVisible();
  expect(calls.dueUrls).toHaveLength(0);
});

it("brings back an unsaved result before starting the requested plan", async () => {
  setToken("valid");
  let interrupted = reviewReducer(initialReviewSession, {
    type: "QUEUE_LOADED", queue: [dueQuestion(1)], planId: null, now: 100,
  });
  interrupted = reviewReducer(interrupted, { type: "ANSWER_REVEALED", answer: "我的答案" });
  interrupted = reviewReducer(interrupted, { type: "RATE", rating: "good", clientId: "unsaved-key", now: 200 });
  saveReviewSnapshot(4, interrupted);
  const calls = stubReviewApi();
  renderPage("/review?plan=8");

  expect(await screen.findByText("结果尚未保存")).toBeVisible();
  expect(screen.getByText("测试题目 1")).toBeVisible();
  expect(calls.dueUrls).toHaveLength(0);
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
    if (url === "/api/v1/plans/active") {
      return new Response(JSON.stringify({ plan_ids: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    if (url === "/api/v1/plans/active") {
      return new Response(JSON.stringify({ plan_ids: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
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
