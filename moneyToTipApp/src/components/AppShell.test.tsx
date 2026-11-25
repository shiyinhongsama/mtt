import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AppShell from "./AppShell";

function renderShell(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell><div>页面内容</div></AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("uses four primary destinations", () => {
    renderShell("/today");
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(navigation).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/today");
    expect(screen.getByRole("link", { name: "题库" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "导入" })).toHaveAttribute("href", "/add");
    expect(screen.getByRole("link", { name: "我的" })).toHaveAttribute("href", "/me");
  });

  it.each(["/review", "/insights"])("hides navigation in focus mode at %s", (route) => {
    renderShell(route);
    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(screen.getByText("页面内容")).toBeVisible();
  });
});
