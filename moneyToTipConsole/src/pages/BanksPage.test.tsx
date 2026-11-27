import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setToken } from "../api";
import BanksPage from "./BanksPage";

const banks = [{
  id: 2,
  name: "Python",
  description: "语法与标准库",
  is_default: false,
  question_count: 14,
  created_at: "2026-11-26T00:00:00Z",
}];

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(<AntdApp><BanksPage /></AntdApp>);
}

function mockBanksApi() {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "/api/v1/questions/banks") return Response.json(banks);
    if (url.startsWith("/api/v1/questions/banks/2/export")) {
      return new Response("题面,答案\n测试题,答案\n", { status: 200 });
    }
    if (url === "/api/v1/questions/banks/2/import") {
      return Response.json({
        bank: "Python", created: 1, duplicates: 2, by_status: { pending: 1 },
        invalid: [{ line: 4, reason: "缺少题面" }],
        needs_review: [{ line: 5, stem: "选项不完整", reasons: ["选择题至少需要两个有效选项"] }],
        truncated: false,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  return requests;
}

it("exports one bank with the current credential and the selected format", async () => {
  setToken("admin-token");
  const user = userEvent.setup();
  const requests = mockBanksApi();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:bank-export"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  renderPage();

  const row = (await screen.findByText("Python")).closest("tr");
  expect(row).not.toBeNull();
  await user.click(within(row!).getByRole("button", { name: "导出" }));
  await user.click(await screen.findByRole("menuitem", { name: "导出 JSON" }));

  await waitFor(() => expect(requests.some((request) =>
    request.url === "/api/v1/questions/banks/2/export?format=json" &&
    (request.init?.headers as Record<string, string>)?.Authorization === "Bearer admin-token",
  )).toBe(true));
});

it("imports a file into the selected bank and shows the row-level report", async () => {
  setToken("admin-token");
  const user = userEvent.setup();
  const requests = mockBanksApi();
  renderPage();

  const row = (await screen.findByText("Python")).closest("tr");
  await user.click(within(row!).getByRole("button", { name: "导入" }));
  await waitFor(() => expect(screen.getByText("导入题目到「Python」")).toBeVisible());
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  await user.upload(input, new File(["题面,答案\n新题,答案\n"], "questions.csv", { type: "text/csv" }));

  expect(await screen.findByText(/新增 1 道/)).toBeVisible();
  expect(screen.getByText(/跳过重复 2 道/)).toBeVisible();
  expect(screen.getByText(/缺少题面/)).toBeVisible();
  expect(screen.getByText(/选项不完整/)).toBeVisible();
  expect(screen.getByText(/选择题至少需要两个有效选项/)).toBeVisible();
  await waitFor(() => expect(requests.filter((request) => request.url === "/api/v1/questions/banks").length)
    .toBeGreaterThanOrEqual(2));
  const upload = requests.find((request) => request.url === "/api/v1/questions/banks/2/import");
  expect(upload?.init?.method).toBe("POST");
  expect(upload?.init?.body).toBeInstanceOf(FormData);
  expect((upload?.init?.headers as Record<string, string>).Authorization).toBe("Bearer admin-token");
});
