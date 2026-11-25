import {
  api,
  createSampleAndOpenToday,
  expect,
  login,
  test,
} from "./fixtures";

test("普通用户无需 token 或 CLI 即可完成示例、搜索和小样本洞察", async ({ page }) => {
  await login(page);
  await createSampleAndOpenToday(page);

  const progress = page.getByRole("region", { name: "今日学习进度" });
  await expect(progress).toContainText("今日完成");
  await expect(progress).toContainText("3 新题");
  await expect(progress).toContainText("3 当前到期");

  await page.getByRole("link", { name: "题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "题库", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索题目" }).fill("HTTP");
  await expect(page.getByRole("heading", { name: "HTTP 协议默认使用哪个端口？" })).toBeVisible();
  await expect(page.getByText("根据艾宾浩斯遗忘规律，哪种复习方式更合理？", { exact: true })).toHaveCount(0);

  await page.goto("./#/insights");
  await expect(page.getByRole("heading", { name: "记忆洞察", exact: true })).toBeVisible();
  await expect(page.getByText("样本积累中", { exact: true })).toBeVisible();
  await expect(page.getByText("0 / 0 次回忆成功", { exact: true })).toBeVisible();
  await expect(page.getByText("再完成 20 次有效复习后显示保持率")).toBeVisible();
});

test("批量确认保留成功项并明确指出需要修正的题目", async ({ page }) => {
  await login(page);
  await api(page, "/questions", {
    method: "POST",
    body: {
      stem: "有效的待确认题", answer: "答案", qtype: "blank", source: "e2e.md", status: "pending",
    },
  });
  await api(page, "/questions", {
    method: "POST",
    body: {
      stem: "需要修正的待确认题",
      answer: "不存在的选项",
      qtype: "choice",
      options: ["甲", "乙"],
      source: "e2e.md",
      status: "pending",
    },
  });

  await page.goto("./#/library");
  await expect(page.getByRole("heading", { name: "有效的待确认题" })).toBeVisible();
  await page.getByRole("checkbox", { name: "选择有效的待确认题" }).check();
  await page.getByRole("checkbox", { name: "选择需要修正的待确认题" }).check();
  await page.getByRole("button", { name: "批量确认", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("1 道已确认，1 道需要修正");
  const valid = page.getByRole("heading", { name: "有效的待确认题" }).locator("xpath=ancestor::article");
  const invalid = page.getByRole("heading", { name: "需要修正的待确认题" }).locator("xpath=ancestor::article");
  await expect(valid).toContainText("复习中");
  await expect(invalid).toContainText("待确认");
  await expect(page.getByRole("button", { name: "批量确认", exact: true })).toHaveCount(0);
});
