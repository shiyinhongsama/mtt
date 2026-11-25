import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { renderAt } from "../test/render";
import OnboardingPage from "./OnboardingPage";

function renderPage() {
  return renderAt("/onboarding", <Routes>
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/today" element={<div>今日首页</div>} />
    <Route path="/add" element={<div>导入自己的题</div>} />
  </Routes>);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("creates the sample once while pending and continues after success", async () => {
  const user = userEvent.setup();
  let resolveRequest!: (value: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  renderPage();

  await user.click(screen.getByRole("button", { name: "一键体验 3 道示例题" }));
  const pending = screen.getByRole("button", { name: /示例题/ });
  expect(pending).toBeDisabled();
  await user.click(pending);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/identity/onboarding/sample", expect.objectContaining({ method: "POST" }));

  resolveRequest(Response.json({ bank_id: 2, question_ids: [3, 4, 5] }));
  expect(await screen.findByText("今日首页")).toBeVisible();
});

it("shows a failure and retries the same action", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(Response.json({ bank_id: 2, question_ids: [3, 4, 5] })));
  renderPage();

  await user.click(screen.getByRole("button", { name: "一键体验 3 道示例题" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("网络不通，稍后再试");
  await user.click(screen.getByRole("button", { name: "一键体验 3 道示例题" }));

  expect(await screen.findByText("今日首页")).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("lets people import their own material instead", async () => {
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole("button", { name: "先导入自己的题" }));
  expect(await screen.findByText("导入自己的题")).toBeVisible();
});
