import {
  createSampleAndOpenToday,
  expect,
  login,
  test,
} from "./fixtures";

test("登录、弱网重试、下一题和刷新恢复共享同一复习事实", async ({ page, isolatedBackend }) => {
  await login(page);
  await createSampleAndOpenToday(page);
  await page.getByRole("button", { name: "继续今日复习" }).click();

  const firstQuestion = page.getByText("根据艾宾浩斯遗忘规律，哪种复习方式更合理？", { exact: true });
  await expect(firstQuestion).toBeVisible();
  await page.getByRole("button", { name: "按逐渐拉长的间隔回顾" }).click();
  await expect(page.getByRole("button", { name: /^记得/ })).toBeVisible();

  const clientIds: string[] = [];
  let attempts = 0;
  await page.route("**/api/v1/reviews", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts += 1;
    const payload = route.request().postDataJSON() as { client_id: string };
    clientIds.push(payload.client_id);
    if (attempts === 1) {
      await route.abort("failed");
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: /^记得/ }).click();
  await expect(page.getByRole("alert")).toContainText("结果尚未保存");
  await expect(firstQuestion).toBeVisible();
  await expect(page.getByText("按逐渐拉长的间隔回顾", { exact: true }).first()).toBeVisible();
  expect(clientIds).toHaveLength(1);

  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("已保存，这次评分已用于调整下次复习。")).toBeVisible();
  expect(attempts).toBe(2);
  expect(clientIds).toHaveLength(2);
  expect(clientIds[1]).toBe(clientIds[0]);

  await page.getByRole("button", { name: "下一题", exact: true }).click();
  const secondQuestion = page.getByText("HTTP 协议默认使用哪个端口？", { exact: true });
  await expect(secondQuestion).toBeVisible();
  await page.reload();
  await expect(secondQuestion).toBeVisible();
  await expect(page.getByPlaceholder("写下你的答案")).toBeVisible();

  const logs = isolatedBackend.reviewLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0].client_id).toBe(clientIds[0]);
});
