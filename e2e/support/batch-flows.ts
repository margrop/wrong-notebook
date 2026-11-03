import { expect } from './fixtures';
import type { Page, Scenario } from './fixtures';

/** 页面不出现横向滚动 */
export async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
}

/** 元素中心没有被底部导航、悬浮按钮等遮挡 */
export async function expectNotCovered(page: Page, testId: string) {
    const covered = await page.getByTestId(testId).evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !hit || !(element === hit || element.contains(hit));
    });
    expect(covered).toBe(false);
}

export async function saveShot(page: Page, name: string, testInfo: { outputPath: (name: string) => string }) {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

export const batchOf = (scenario: Scenario) => scenario.db.importBatch.findFirstOrThrow({ where: { userId: scenario.user.id }, include: { tasks: true } });
export const calls = async (scenario: Scenario, operation: string) => (await scenario.model()).calls.filter((call) => call.operation === operation);

