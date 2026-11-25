import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api/client";
import { renderAt } from "../test/render";
import MePage from "./MePage";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("confirms in app and clears both credentials and the review snapshot on logout", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  setToken("user-token");
  localStorage.setItem("mtt_review_snapshot_v2", "snapshot");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/v1/identity/me") return Response.json({ id: 7, username: "learner", role: "user" });
    if (url === "/api/v1/stats") return Response.json({ reviewed_today: 0, due_today: 0, mature_count: 0, active_questions: 0 });
    if (url === "/api/v1/plans") return Response.json([]);
    if (url === "/api/v1/identity/tokens") return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  }));
  renderAt("/me", <Routes>
    <Route path="/me" element={<MePage />} />
    <Route path="/login" element={<div>登录页</div>} />
  </Routes>);

  await user.click(screen.getByRole("button", { name: "退出登录" }));
  const dialog = await screen.findByRole("dialog", { name: "退出登录？" });
  await user.click(within(dialog).getByRole("button", { name: "确认退出" }));

  expect(await screen.findByText("登录页")).toBeVisible();
  expect(localStorage.getItem("mtt_token")).toBeNull();
  expect(localStorage.getItem("mtt_review_snapshot_v2")).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});
