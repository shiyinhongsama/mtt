import type { Page } from "@playwright/test";
import {
  createSampleAndOpenToday,
  expect,
  expectNoHorizontalOverflow,
  login,
  test,
} from "./fixtures";

const viewports = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
];

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expectNoHorizontalOverflow(page);
}

for (const viewport of viewports) {
  test(`${viewport.name}：今日、复习、题库和洞察保持可读且无横向溢出`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date("2026-11-26T08:00:00+08:00"));
    await login(page);
    await createSampleAndOpenToday(page);
    await settle(page);
    await expect(page).toHaveScreenshot(`today-${viewport.name}.png`, { fullPage: true });

    await page.getByRole("button", { name: "继续今日复习" }).click();
    await expect(page.getByText("根据艾宾浩斯遗忘规律，哪种复习方式更合理？", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "按逐渐拉长的间隔回顾" }).click();
    await expect(page.getByRole("button", { name: /^记得/ })).toBeVisible();
    await settle(page);
    const ratingButtons = await page.getByRole("group", { name: "记忆自评" }).getByRole("button").all();
    expect(ratingButtons).toHaveLength(4);
    for (const button of ratingButtons) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page).toHaveScreenshot(`review-${viewport.name}.png`, { fullPage: true });

    await page.goto("./#/library");
    await expect(page.getByRole("heading", { name: "题库", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "HTTP 协议默认使用哪个端口？" })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`library-${viewport.name}.png`, { fullPage: true });

    await page.goto("./#/insights");
    await expect(page.getByRole("heading", { name: "记忆洞察", exact: true })).toBeVisible();
    await expect(page.getByText("样本积累中", { exact: true })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`insights-${viewport.name}.png`, { fullPage: true });
  });
}
