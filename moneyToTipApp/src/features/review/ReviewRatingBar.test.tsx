import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { dueQuestion } from "../../test/factories";
import { formatInterval } from "./format";
import ReviewRatingBar from "./ReviewRatingBar";

it("formats the actual minute-level rating previews", () => {
  expect(formatInterval(10)).toBe("10 分钟");
  expect(formatInterval(234)).toBe("4 小时");
  expect(formatInterval(1440)).toBe("1 天");
});

it("disables every rating while submitting", async () => {
  const onRate = vi.fn();
  const user = userEvent.setup();
  render(<ReviewRatingBar question={dueQuestion(1)} disabled onRate={onRate} />);

  const good = screen.getByRole("button", { name: /记得/ });
  expect(good).toHaveTextContent("8 小时");
  expect(good).toBeDisabled();
  expect(screen.getByRole("button", { name: /忘记/ })).toBeDisabled();
  await user.click(good);
  expect(onRate).not.toHaveBeenCalled();
});
