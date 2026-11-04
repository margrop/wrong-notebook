import { test, expect } from './support/fixtures';
import type { Scenario } from './support/fixtures';

/** 生成 6 道测试错题：3 道单选题、2 道填空题、1 道未设题型 */
async function createSixItems(scenario: Scenario) {
    const types: (string | null)[] = ['single_choice', 'single_choice', 'single_choice', 'fill_blank', 'fill_blank', null];
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (let i = 0; i < labels.length; i++) {
        await scenario.item(labels[i], { questionType: types[i] });
    }
}

/** 通过 UI 创建一份 6 题原题直出试卷，返回试卷 ID */
async function createOriginalExam(page: import('./support/fixtures').Page, count: string) {
    await page.goto('/exams');
    await page.getByRole('checkbox', { name: /数学/ }).check();
    await page.getByRole('button', { name: '原题', exact: true }).click();
    await page.locator('#exam-count').fill(count);
    await page.getByRole('button', { name: '创建原题试卷', exact: true }).click();
    await page.waitForURL(/\/exams\/[^/]+$/);
    return new URL(page.url()).pathname.split('/').pop()!;
}

test.describe('E7 题型筛选与试卷分值', () => {
    test('[E2E-F7-1] 错题列表按题型筛选', async ({ page, scenario }) => {
        await createSixItems(scenario);
        await scenario.login(page);
        await page.goto(`/notebooks/${scenario.book.id}`);
        // 先看到 6 道
        await expect(page.locator('[data-slot="card"]')).toHaveCount(6);
        // 点「单选题」按钮
        await page.getByRole('button', { name: '单选题', exact: true }).click();
        await expect(page.locator('[data-slot="card"]')).toHaveCount(3);
        // 再加选「未设置」
        await page.getByRole('button', { name: '未设置', exact: true }).click();
        await expect(page.locator('[data-slot="card"]')).toHaveCount(4);
    });

    test('[E2E-F7-2] 原题直出 + 同时生成 A/B 卷', async ({ page, scenario }) => {
        await createSixItems(scenario);
        await scenario.login(page);
        await page.goto('/exams');
        // 组卷：选择错题本、原题模式、题数 3、同时生成 A/B 卷
        await page.getByRole('checkbox', { name: /数学/ }).check();
        await page.getByRole('button', { name: '原题', exact: true }).click();
        await page.locator('#exam-count').fill('3');
        await page.locator('#exam-parallel').click();
        await page.getByRole('button', { name: '创建原题试卷', exact: true }).click();
        await page.waitForURL(/\/exams\/[^/]+$/);
        // 详情页显示标题含（A 卷）
        await expect(page.locator('h1')).toContainText('（A 卷）');
        // 列表出现两份试卷
        await page.goto('/exams');
        await expect(page.getByText(/（A 卷）/)).toBeVisible();
        await expect(page.getByText(/（B 卷）/)).toBeVisible();
        // 数据库验证：两卷合计 6 题，errorItemId 不重叠。
        // 两卷各 3 题（跨题型交替分配，任一卷不超过每卷题数）
        const papers = await scenario.db.examPaper.findMany({ where: { userId: scenario.user.id } });
        expect(papers).toHaveLength(2);
        const aPaper = papers.find((p) => p.title.includes('（A 卷）'))!;
        const bPaper = papers.find((p) => p.title.includes('（B 卷）'))!;
        const aQuestions = await scenario.db.examQuestion.findMany({ where: { paperId: aPaper.id } });
        const bQuestions = await scenario.db.examQuestion.findMany({ where: { paperId: bPaper.id } });
        expect(aQuestions).toHaveLength(3);
        expect(bQuestions).toHaveLength(3);
        const aIds = new Set(aQuestions.map((q) => q.errorItemId));
        const bIds = new Set(bQuestions.map((q) => q.errorItemId));
        expect(aIds.size).toBe(aQuestions.length);
        expect(bIds.size).toBe(bQuestions.length);
        for (const id of bIds) expect(aIds.has(id)).toBeFalsy();
    });

    // 回归：分值输入框的 min/step 需允许整数与一位小数（曾因 min=0.001、step=0.5 被浏览器校验拦截）
    test('[E2E-F7-3] 试卷详情设置每题分值与总分', async ({ page, scenario }) => {
        await createSixItems(scenario);
        await scenario.login(page);
        const id = await createOriginalExam(page, '3');
        // 设置每题 5 分
        const uniform = page.getByRole('spinbutton', { name: '每题统一分值', exact: true });
        await uniform.fill('5');
        await uniform.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByText('总分 15 分')).toBeVisible();
        // 单题改为 2.5 分
        const firstInput = page.locator('input[id^="exam-score-"]').first();
        await firstInput.fill('2.5');
        await firstInput.press('Enter');
        await expect(page.getByText('总分 12.5 分')).toBeVisible();
        // 刷新后保留
        await page.reload();
        await expect(page.getByText('总分 12.5 分')).toBeVisible();
        await expect(page.locator('input[id^="exam-score-"]').first()).toHaveValue('2.5');
        // 数据库验证
        const questions = await scenario.db.examQuestion.findMany({ where: { paperId: id } });
        expect(questions.filter((q) => q.score === 2.5)).toHaveLength(1);
        expect(questions.filter((q) => q.score === 5)).toHaveLength(2);
    });

    test('[E2E-F7-4] 按题型分大题', async ({ page, scenario }) => {
        await createSixItems(scenario);
        await scenario.login(page);
        const id = await createOriginalExam(page, '6');
        // 通过 API 设置分值（UI 输入受 FIXME 中 HTML 验证 bug 影响）
        await page.request.patch(`/api/exams/${id}`, { data: { score: 5 } });
        // 打开按题型分大题（Radix Checkbox 用 click 切换）
        await page.getByRole('checkbox', { name: '按题型分大题', exact: true }).click();
        await expect(page.getByRole('heading', { name: /一、单选题/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: /二、填空题/ })).toBeVisible();
        // 题号连续：1..6 分布在三个大题下
        const cardNumbers = await page.locator('[data-slot="card"] > div > div > span.font-semibold').allTextContents();
        expect(cardNumbers.map((n) => n.replace('.', '')).join(',')).toBe('1,2,3,4,5,6');
        // 打开打印页：满分行与大题标题存在（答案页同样分组，故标题出现两次，取第一个）
        await page.goto(`/exams/${id}/print`);
        await expect(page.getByText('满分 30 分')).toBeVisible();
        await expect(page.getByRole('heading', { name: /一、单选题/ }).first()).toBeVisible();
        await expect(page.getByRole('heading', { name: /二、填空题/ }).first()).toBeVisible();
        // 关闭开关后大题标题消失
        await page.goto(`/exams/${id}`);
        await page.getByRole('checkbox', { name: '按题型分大题', exact: true }).click();
        await expect(page.getByRole('heading', { name: /一、单选题/ })).toHaveCount(0);
    });

    test('[E2E-F7-5] 组卷时按题型筛选', async ({ page, scenario }) => {
        await createSixItems(scenario);
        await scenario.login(page);
        await page.goto('/exams');
        await page.getByRole('checkbox', { name: /数学/ }).check();
        await page.getByRole('button', { name: '原题', exact: true }).click();
        // 只选填空题
        await page.getByRole('button', { name: '填空题', exact: true }).click();
        await page.locator('#exam-count').fill('10');
        await page.getByRole('button', { name: '创建原题试卷', exact: true }).click();
        await page.waitForURL(/\/exams\/[^/]+$/);
        const id = new URL(page.url()).pathname.split('/').pop()!;
        const questions = await scenario.db.examQuestion.findMany({ where: { paperId: id } });
        expect(questions).toHaveLength(2);
        for (const q of questions) {
            const item = await scenario.db.errorItem.findUniqueOrThrow({ where: { id: q.errorItemId! } });
            expect(item.questionType).toBe('fill_blank');
        }
    });
});
