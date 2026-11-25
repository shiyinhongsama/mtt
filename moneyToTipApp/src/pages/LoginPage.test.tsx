import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import App from "../App";
import { getToken } from "../api/client";
import { renderAt } from "../test/render";
import LoginPage from "./LoginPage";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function mockLogin(total: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/v1/identity/login") {
      return json({ token: "user-token", username: "learner", role: "user" });
    }
    if (url === "/api/v1/identity/me") {
      return json({ id: 7, username: "learner", role: "user" });
    }
    if (url.startsWith("/api/v1/questions?")) return json({ total, items: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderLogin() {
  return renderAt("/login", <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/onboarding" element={<div>首次引导</div>} />
    <Route path="/today" element={<div>今日首页</div>} />
  </Routes>);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("logs in with a password, preserves the snapshot, and enters onboarding without a reload", async () => {
  const user = userEvent.setup();
  localStorage.setItem("mtt_review_snapshot_v2", "previous-user-snapshot");
  const fetchMock = mockLogin(0);
  vi.stubGlobal("fetch", fetchMock);
  renderAt("/login", <App />);

  await user.type(screen.getByLabelText("用户名"), "learner");
  await user.type(screen.getByLabelText("密码"), "correct-password");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByRole("heading", { name: "从 3 道示例题开始" })).toBeVisible();
  expect(getToken()).toBe("user-token");
  expect(localStorage.getItem("mtt_review_snapshot_v2")).toBe("previous-user-snapshot");
  // 第 4 次是 AppShell 顶栏读取今日统计，不属于登录提交。
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("sends users who already have questions to today", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", mockLogin(4));
  renderLogin();

  await user.type(screen.getByLabelText("用户名"), "learner");
  await user.type(screen.getByLabelText("密码"), "correct-password");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByText("今日首页")).toBeVisible();
});

it("disables duplicate submissions and displays credential errors", async () => {
  const user = userEvent.setup();
  let rejectLogin!: (reason?: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((_, reject) => { rejectLogin = reject; })));
  renderLogin();

  await user.type(screen.getByLabelText("用户名"), "learner");
  await user.type(screen.getByLabelText("密码"), "wrong-password");
  const submit = screen.getByRole("button", { name: "登录" });
  await user.click(submit);
  expect(screen.getByRole("button", { name: /登录/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /登录/ }));
  expect(fetch).toHaveBeenCalledTimes(1);

  rejectLogin(new TypeError("offline"));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络不通，稍后再试");
  expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
});
