import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import Button from "./Button";

it("blocks duplicate activation while loading", async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  render(<Button loading onClick={onClick}>保存</Button>);

  const button = screen.getByRole("button", { name: "保存中" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await user.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps a large touch target and explicit variant", () => {
  render(<Button variant="danger">暂停</Button>);
  expect(screen.getByRole("button", { name: "暂停" }).className).toMatch(/danger/);
});
