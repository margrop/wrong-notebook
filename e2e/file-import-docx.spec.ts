/**
 * E3：导入 Word（.docx）题库 —— 自动编号、答案解析标记、公式、图片、旧版 .doc。
 *
 * 三个用例：
 * 1. docx 含 3 题：第 1 题手写题号 + 【答案】【解析】；第 2 题含 OMML 分数（1/2）；
 *    第 3 题含内嵌 PNG → 摘要 3 题 → 批次草稿中验证答案、公式、图片缩略图 →
 *    按原样入库 → 第 3 题错题 originalImageUrl 以 data:image/ 开头。
 * 2. Word 自动编号（numbering.xml decimal，正文无题号）→ 能分出 2 题。
 * 3. 旧版 .doc（D0 CF 11 E0 文件头）→ 提示另存为 .docx。
 */
import { expect, test } from './support/fixtures';
import { PNG_1X1, abstractNum, drawingRun, mFraction, mRun, makeDocxBuffer, makeLegacyDocBuffer, num, numPara, oMathContent, para, run } from './support/e3-helpers';

test.describe('E3 导入 Word 题库', () => {
    test('[E2E-F3-1] docx 含手写题号 + 答案解析 + OMML 公式 + 内嵌 PNG：摘要 3 题，批次草稿可见答案/公式/原图，按原样入库后第 3 题带 data:image 原图', async ({ page, scenario }) => {
        // 构造 docx：3 题
        const q1Text = `1．计算 ${scenario.marker} 3 + 4 的值。`;
        const q1Answer = '7';
        const q1Analysis = '直接相加得 7。';
        const q2Text = '2．计算 ';
        const q2After = ' + 3 的值。';
        const q3Text = '3．如图，求阴影部分面积。';

        const body = [
            // 第 1 题：手写题号 + 答案/解析
            para(run(q1Text)),
            para(run(`【答案】${q1Answer}`)),
            para(run(`【解析】${q1Analysis}`)),
            // 第 2 题：OMML 分数
            para(run(q2Text) + oMathContent(mFraction(mRun('1'), mRun('2'))) + run(q2After)),
            // 第 3 题：内嵌 PNG
            para(run(q3Text) + drawingRun()),
        ].join('');

        const docxBuffer = makeDocxBuffer({
            body,
            rels: '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { 'word/media/image1.png': PNG_1X1 },
        });

        await scenario.login(page);
        await page.goto(`/?notebook=${scenario.book.id}`);
        await page.getByRole('tab', { name: '导入题库文件' }).click();
        await page.getByTestId('import-file-input').setInputFiles({ name: 'math-test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer });

        // 摘要视图
        await expect(page.getByTestId('file-import-summary')).toBeVisible();
        await expect(page.getByText('共解析出 3 道题。')).toBeVisible();

        // 确认导入
        await page.getByRole('button', { name: '导入 3 道题' }).click();
        await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
        await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/);

        const items = page.getByTestId('draft-item');
        await expect(items).toHaveCount(3);

        // 第 1 题：展开卡片 → 展开「答案与知识点」折叠区 → 可见参考答案与解析
        await items.nth(0).getByRole('button', { name: '编辑' }).click();
        await items.nth(0).getByRole('button', { name: /答案与知识点/ }).click();
        await expect(items.nth(0).getByLabel('参考答案')).toHaveValue(q1Answer);
        await expect(items.nth(0).getByLabel('解析')).toHaveValue(q1Analysis);

        // 第 2 题：题干包含 $\frac{1}{2}$（以草稿编辑框文本为准）
        await items.nth(1).getByRole('button', { name: '编辑' }).click();
        await expect(items.nth(1).getByLabel('题目文字')).toHaveValue(/\$\\frac\{1\}\{2\}\$/);

        // 第 3 题：显示原图缩略图
        await items.nth(2).getByRole('button', { name: '编辑' }).click();
        await expect(items.nth(2).getByRole('img', { name: '题目原图' })).toBeVisible();

        // 选择「按原样入库」并导入
        await page.getByTestId('draft-analysis-none').click();
        await page.getByRole('button', { name: /按原样导入 3 题/ }).click();

        // 等待入库完成
        await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(3);

        // 第 3 题 originalImageUrl 以 data:image/ 开头
        const items3 = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
        const q3 = items3.find((item) => item.questionText?.includes('阴影部分'));
        expect(q3).toBeDefined();
        expect(q3?.originalImageUrl).toMatch(/^data:image\//);
    });

    test('[E2E-F3-2] Word 自动编号（numbering.xml decimal）：正文无题号，能分出 2 题', async ({ page, scenario }) => {
        const body = [
            numPara('1', 0, run(`计算 ${scenario.marker} 1 + 1。`)),
            numPara('1', 0, run('计算 2 + 2。')),
        ].join('');

        const numbering = abstractNum('10', [{ numFmt: 'decimal', lvlText: '%1.' }]) + num('1', '10');

        const docxBuffer = makeDocxBuffer({ body, numbering });

        await scenario.login(page);
        await page.goto(`/?notebook=${scenario.book.id}`);
        await page.getByRole('tab', { name: '导入题库文件' }).click();
        await page.getByTestId('import-file-input').setInputFiles({ name: 'auto-number.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer });

        await expect(page.getByTestId('file-import-summary')).toBeVisible();
        await expect(page.getByText('共解析出 2 道题。')).toBeVisible();

        await page.getByRole('button', { name: '导入 2 道题' }).click();
        await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
        await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);

        const items = page.getByTestId('draft-item');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toContainText(`计算 ${scenario.marker} 1 + 1`);
        await expect(items.nth(1)).toContainText('计算 2 + 2');
    });

    test('[E2E-F3-3] 旧版 .doc（D0 CF 11 E0 文件头）：提示需另存为 .docx', async ({ page, scenario }) => {
        const legacyBuffer = makeLegacyDocBuffer();

        await scenario.login(page);
        await page.goto('/');
        await page.getByRole('tab', { name: '导入题库文件' }).click();
        await page.getByTestId('import-file-input').setInputFiles({ name: 'old-format.doc', mimeType: 'application/msword', buffer: legacyBuffer });

        // 摘要视图显示错误提示（toast 或摘要错误区）
        await expect(page.getByText('旧版 .doc 格式暂不支持，请在 Word 中另存为 .docx 后再导入')).toBeVisible();
    });
});
