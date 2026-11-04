import { expect, test } from './support/fixtures';

/** 构造题目交换格式 JSON 文件 */
function buildQuestionsJson(questions: Record<string, unknown>[]): Buffer {
    return Buffer.from(JSON.stringify({ format: 'wrong-notebook-questions', version: 1, questions }), 'utf8');
}

/** 上传 JSON 并等待摘要出现 */
async function uploadJson(page: import('./support/fixtures').Page, questions: Record<string, unknown>[], fileName = 'questions.json') {
    const buffer = buildQuestionsJson(questions);
    await page.getByTestId('import-file-input').setInputFiles({ name: fileName, mimeType: 'application/json', buffer });
    await expect(page.getByTestId('file-import-summary')).toBeVisible();
}

test('[E2E-F1-1] JSON 导入 3 题：摘要 → 选择错题本 → 按原样入库 → 无 AI 调用', async ({ page, scenario }) => {
    const marker = scenario.marker;
    const questions = [
        {
            text: `一个长方形的长是七厘米，宽是五厘米，求它的面积。${marker}1`,
            answer: '35 平方厘米',
            analysis: '面积等于长乘宽。',
            knowledgePoints: ['一元一次方程'],
            questionType: 'single_choice',
            difficultyStars: 2,
        },
        {
            text: `某商店购进一批商品，进价为每件100元，按20%的利润率定价，求每件售价。${marker}2`,
            answer: '120 元',
            analysis: '售价 = 100 × (1 + 20%) = 120 元。',
            knowledgePoints: ['二元一次方程'],
            questionType: 'fill_blank',
            difficultyStars: 3,
        },
        {
            text: `求解方程 x + 2 = 5，并说明每一步的依据。${marker}3`,
            answer: 'x = 3',
            analysis: '移项得 x = 3。',
            knowledgePoints: ['一元一次方程'],
            questionType: 'calculation',
            difficultyStars: 4,
        },
    ];

    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await expect(page.getByTestId('file-import-panel')).toBeVisible();

    await uploadJson(page, questions);
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 3 道题。');

    // 选择目标错题本（页面已通过 ?notebook= 参数预选）
    await expect(page.getByTestId('file-import-summary')).toContainText('目标错题本');
    await expect(page.getByTestId('file-import-summary').getByRole('combobox')).toContainText('数学');
    await page.getByRole('button', { name: '导入 3 道题' }).click();

    // 单批次直达批次详情页
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题\s*·\s*已选 3 题/);

    // 展开第 1 题，再展开「答案与知识点」确认答案字段
    await page.getByTestId('draft-item').nth(0).getByRole('button', { name: '编辑' }).click();
    await page.getByTestId('draft-item').nth(0).getByRole('button', { name: '答案与知识点' }).click();
    await expect(page.getByTestId('draft-item').nth(0).locator('textarea').nth(1)).toHaveValue('35 平方厘米');
    await page.getByTestId('draft-item').nth(0).getByRole('button', { name: '完成' }).click();

    // 全部题目都有答案 → 默认解析方式是「AI 只补知识点和难度」，改为「按原样入库」
    await expect(page.getByTestId('draft-analysis-none')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('draft-analysis-none').click();
    await expect(page.getByTestId('draft-analysis-none')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('draft-start-hint')).toContainText('不调用 AI、不消耗额度');

    await page.getByRole('button', { name: /按原样导入 3 题/ }).click();
    await expect(page.getByTestId('batch-progress')).toBeVisible();

    // 等待 3 道错题入库
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(3);

    const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    expect(saved.every((item) => item.subjectId === scenario.book.id)).toBe(true);

    const q1 = saved.find((item) => item.questionText?.includes(`${marker}1`));
    const q2 = saved.find((item) => item.questionText?.includes(`${marker}2`));
    const q3 = saved.find((item) => item.questionText?.includes(`${marker}3`));
    expect(q1).toMatchObject({ answerText: '35 平方厘米', analysis: '面积等于长乘宽。', questionType: 'single_choice', difficultyStars: 2 });
    expect(q2).toMatchObject({ answerText: '120 元', analysis: '售价 = 100 × (1 + 20%) = 120 元。', questionType: 'fill_blank', difficultyStars: 3 });
    expect(q3).toMatchObject({ answerText: 'x = 3', analysis: '移项得 x = 3。', questionType: 'calculation', difficultyStars: 4 });

    // mock AI 无任何调用
    expect((await scenario.model()).calls).toHaveLength(0);
});

test('[E2E-F1-2] AI 只补知识点和难度：tag-suggest 补全缺失字段', async ({ page, scenario }) => {
    const marker = scenario.marker;
    const questions = [
        { text: `小明有 5 个苹果，又买了 3 个，现在一共有几个？${marker}A`, answer: '8 个' },
        { text: `一辆汽车以每小时 60 千米的速度行驶了 2 小时，一共行驶了多少千米？${marker}B`, answer: '120 千米' },
    ];

    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await uploadJson(page, questions);
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 2 道题。');

    await page.getByRole('button', { name: '导入 2 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题\s*·\s*已选 2 题/);

    // 有答案 → 默认「AI 只补知识点和难度」
    await expect(page.getByTestId('draft-analysis-tags')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('draft-analysis-none')).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: /补全标签并导入 2 题/ }).click();
    await expect(page.getByTestId('batch-progress')).toBeVisible();

    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(2);

    const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id }, include: { tags: true } });
    for (const item of saved) {
        expect(item.answerText).toMatch(/^(8 个|120 千米)$/);
        expect(item.difficultyStars).toBe(2);
        expect(item.questionType).toBe('calculation');
        expect(item.tags.map((tag) => tag.name)).toContain('一元一次方程');
        expect(item.subjectId).toBe(scenario.book.id);
    }

    // 只调用了 tag-suggest，没有 analysis / reanswer
    const modelCalls = (await scenario.model()).calls;
    const operations = modelCalls.map((call) => call.operation);
    expect(operations.filter((op) => op === 'tag-suggest')).toHaveLength(2);
    expect(operations).not.toContain('analysis');
    expect(operations).not.toContain('reanswer');
});

test('[E2E-F1-3] 解析错误提示：部分题目出错时只导入正常题；非法 JSON 显示解析失败', async ({ page, scenario }) => {
    const marker = scenario.marker;
    const questions = [
        { text: ``, answer: '1' },
        { text: `计算 1 + 2 = ____。${marker}OK`, answer: '3', analysis: '加法。' },
    ];

    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();

    // 第 1 题缺 text，第 2 题正常 → 摘要显示 1 题
    await uploadJson(page, questions);
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 1 道题。');
    await expect(page.getByTestId('file-import-summary').locator('[role="alert"]')).toContainText('有 1 道题解析出错');
    await expect(page.getByTestId('file-import-summary').locator('[role="alert"]')).toContainText('第 1 题');

    await page.getByRole('button', { name: '导入 1 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 1 题\s*·\s*已选 1 题/);

    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: /按原样导入 1 题/ }).click();
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(1);
    const saved = await scenario.db.errorItem.findFirstOrThrow({ where: { userId: scenario.user.id } });
    expect(saved.questionText).toContain(`${marker}OK`);
    expect(saved.subjectId).toBe(scenario.book.id);

    // 非法 JSON → toast 提示解析错误，停留在选择阶段
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await page.getByTestId('import-file-input').setInputFiles({
        name: 'bad.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{ not valid json', 'utf8'),
    });
    // toast 提示「不是合法的 JSON 文件，请检查文件内容」
    await expect(page.locator('[role="status"]').last()).toContainText('不是合法的 JSON 文件，请检查文件内容');
    // 停留在选择阶段（pick 视图重新出现，摘要消失）
    await expect(page.getByTestId('file-import-summary')).toHaveCount(0);
    await expect(page.getByTestId('file-import-panel')).toBeVisible();
    await expect(page.getByText('选择题库文件，解析后按批次导入')).toBeVisible();
});
