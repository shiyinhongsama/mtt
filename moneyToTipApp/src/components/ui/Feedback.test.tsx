import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ErrorState } from "./Feedback";
import Sheet from "./Sheet";
import Toast from "./Toast";

it("retries an asynchronous page from its error state", async () => {
  const onRetry = vi.fn();
  const user = userEvent.setup();
  render(<ErrorState message="网络不通" onRetry={onRetry} />);

  expect(screen.getByRole("alert")).toHaveTextContent("网络不通");
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it("closes a sheet with Escape", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Sheet title="编辑题目" onClose={onClose}>表单</Sheet>);

  expect(screen.getByRole("dialog", { name: "编辑题目" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

it("announces non-blocking feedback", () => {
  render(<Toast>已保存</Toast>);
  expect(screen.getByRole("status")).toHaveTextContent("已保存");
});
