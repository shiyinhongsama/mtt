import type { Page } from "@playwright/test";
import {
  api,
  createSampleAndOpenToday,
  expect,
  login,
  test,
} from "./fixtures";

/** 问答题：对照答案后评「记得」，直到本轮完成 */
async function rateEveryQuestionAsRemembered(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("button", { name: "心里想好答案了，对照标准答案" }).click();
    await page.getByRole("button", { name: /^记得/ }).click();
    await expect(page.getByText("已保存，这次评分已用于调整下次复习。")).toBeVisible();
    await page.getByRole("button", { name: "下一题", exact: true }).click();
  }
}

test("两个学习计划各完成一轮：进度独立，第二轮不会重放第一轮的题", async ({ page, isolatedBackend }) => {
  await login(page);
  await createSampleAndOpenToday(page);

  // 上一轮没做完的自由复习会留在本地，不能让它顶掉接下来每个计划自己的题
  await page.getByRole("button", { name: "继续今日复习" }).click();
  await expect(page.getByText("根据艾宾浩斯遗忘规律，哪种复习方式更合理？", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "退出本轮复习" }).click();
  await expect(page.getByRole("button", { name: "继续今日复习" })).toBeVisible();

  // 示例题库之外再建一个题库，两个题库各建一个每天 2 题的计划并加入今日
  const banks = (await (await api(page, "/questions/banks")).json()) as { id: number; name: string }[];
  const sampleBank = banks.find((bank) => bank.name === "忙里偷题示例");
  if (!sampleBank) throw new Error("示例题库不存在");
  const httpBank = (await (await api(page, "/questions/banks", { method: "POST", body: { name: "HTTP 基础" } })).json()) as { id: number };
  for (const [stem, answer] of [["HTTP 默认使用哪个端口？", "80"], ["HTTPS 默认使用哪个端口？", "443"]]) {
    await api(page, "/questions", {
      method: "POST",
      body: {
        stem, answer, qtype: "qa", options: [], explanation: "端到端测试用题。", source: "e2e",
        tags: [], difficulty: 1, bank_id: httpBank.id, status: "active",
      },
    });
  }
  const samplePlan = (await (await api(page, "/plans", {
    method: "POST", body: { name: "示例计划", bank_id: sampleBank.id, daily_goal: 2 },
  })).json()) as { id: number };
  const httpPlan = (await (await api(page, "/plans", {
    method: "POST", body: { name: "HTTP 计划", bank_id: httpBank.id, daily_goal: 2 },
  })).json()) as { id: number };
  await api(page, "/plans/active", { method: "PUT", body: { plan_ids: [samplePlan.id, httpPlan.id] } });

  const dueRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/reviews/due")) dueRequests.push(request.url());
  });

  await page.reload();
  const plans = page.getByRole("region", { name: "今日计划" });
  await expect(plans).toBeVisible();
  await expect(plans.getByRole("link", { name: "开始「示例计划」" })).toBeVisible();
  await expect(plans.getByRole("link", { name: "开始「HTTP 计划」" })).toBeVisible();
  await expect(page.getByRole("link", { name: "继续今日复习" })).toHaveCount(0);

  // 第一个计划
  await plans.getByRole("link", { name: "开始「HTTP 计划」" }).click();
  await expect(page.getByText("HTTP 计划", { exact: true })).toBeVisible();
  await expect(page.getByText("HTTP 默认使用哪个端口？", { exact: true })).toBeVisible();
  await rateEveryQuestionAsRemembered(page, 2);
  await expect(page.getByText("「HTTP 计划」这一轮完成了")).toBeVisible();
  await page.getByRole("link", { name: "返回今日" }).click();

  await expect(plans).toBeVisible();
  await expect(plans.getByRole("progressbar", { name: "HTTP 计划今日进度" })).toHaveAttribute("aria-valuenow", "2");
  await expect(plans.getByRole("progressbar", { name: "示例计划今日进度" })).toHaveAttribute("aria-valuenow", "0");
  await expect(plans.getByText("已达成")).toHaveCount(1);
  expect(isolatedBackend.reviewLogs()).toHaveLength(2);

  // 第二个计划：必须是新拉的题，不是刚做过的 HTTP 题
  await plans.getByRole("link", { name: "开始「示例计划」" }).click();
  await expect(page.getByText("示例计划", { exact: true })).toBeVisible();
  await expect(page.getByText("根据艾宾浩斯遗忘规律，哪种复习方式更合理？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "按逐渐拉长的间隔回顾" }).click();
  await page.getByRole("button", { name: /^记得/ }).click();
  await expect(page.getByText("已保存，这次评分已用于调整下次复习。")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByText("HTTP 协议默认使用哪个端口？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("写下你的答案").fill("80");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByRole("button", { name: /^记得/ }).click();
  await expect(page.getByText("已保存，这次评分已用于调整下次复习。")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByText("「示例计划」这一轮完成了")).toBeVisible();
  await page.getByRole("link", { name: "返回今日" }).click();

  await expect(page.getByText("今日目标已完成")).toBeVisible();
  await expect(plans.getByText("已达成")).toHaveCount(2);

  // 自由模式做完一轮后返回再进：拉题数量不变、缓存键相同，正是旧缺陷重放的路径
  await page.getByRole("link", { name: "加练", exact: true }).click();
  await expect(page.getByText("复习提交失败时，应保留当前题面，并使用同一请求标识重试。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "对", exact: true }).click();
  await page.getByRole("button", { name: /^记得/ }).click();
  await expect(page.getByText("已保存，这次评分已用于调整下次复习。")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByText("这轮复习完成了")).toBeVisible();
  await page.getByRole("link", { name: "返回今日" }).click();

  await expect(page.getByText("今日目标已完成")).toBeVisible();
  await page.getByRole("link", { name: "加练", exact: true }).click();
  // 所有题都要几小时后才到期：必须重新拉题并直接结束，而不是把刚做过的题再放出来
  await expect(page.getByText("这轮复习完成了")).toBeVisible();
  await expect(page.getByRole("button", { name: /^记得/ })).toHaveCount(0);

  expect(dueRequests).toHaveLength(4);
  expect(dueRequests[1]).toContain(`bank_id=${sampleBank.id}`);
  const logs = isolatedBackend.reviewLogs();
  expect(logs).toHaveLength(5);
  expect(new Set(logs.map((log) => log.question_id)).size).toBe(5);
});
