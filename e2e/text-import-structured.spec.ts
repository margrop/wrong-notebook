import { expect, test } from './support/fixtures';

/** 生成 65 道编号题（每题文字很短，保证按题数分批） */
function buildLongText(count: number): string {
    return Array.from({ length: count }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
}

/** 构造一个最小可用的 .docx（zip 容器，含 [Content_Types].xml 与 document.xml） */
function buildMinimalDocx(text: string): Buffer {
    // 用 Node 内置 zlib 生成 zip 成本较高，这里用 fflate（已在 node_modules 中）
    const { zipSync, strToU8 } = require('fflate') as typeof import('fflate');
    const files: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
        '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
        'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
    };
    return Buffer.from(zipSync(files));
}

test.describe('文字录入：结构化标记与答案区回填', () => {
    test('[E2E-F5-1] 粘贴带结构化标记与参考答案区的文字，分题预览识别后字段正确入库', async ({ page, scenario }) => {
        await scenario.login(page);
        await page.goto(`/?notebook=${scenario.book.id}`);
        await page.getByRole('tab', { name: '手动输入', exact: true }).click();

        const text = [
            '1．某班有男生 20 人，女生 18 人，男生人数是女生的几倍？',
            '【答案】20÷18=10/9',
            '【解析】用男生人数除以女生人数。',
            '【知识点】倍数关系',
            '【难度】★★',
            '【题型】填空题',
            '',
            '2．3×4=（　）',
            '',
            '3．计算 5 + 6。',
            '',
            '参考答案',
            '1.A 2.B 3.C',
        ].join('\n');

        await page.locator('#question-text').fill(text);
        await expect(page.getByTestId('multi-detected')).toContainText('检测到 3 道编号题');
        await page.getByRole('button', { name: '分题预览（3 题）' }).click();
        await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);

        const items = page.getByTestId('draft-item');
        await expect(items).toHaveCount(3);

        // 第 1 题：展开题目后字段区默认折叠，先点开「答案与知识点」
        await items.nth(0).getByRole('button', { name: '编辑' }).click();
        await items.nth(0).getByRole('button', { name: '答案与知识点' }).click();
        await expect(items.nth(0).getByLabel('参考答案')).toHaveValue('20÷18=10/9');
        await expect(items.nth(0).getByLabel('题型')).toContainText('填空题');
        await expect(items.nth(0).getByLabel('难度')).toContainText('★★');

        // 第 2 题：全角题号后紧跟数字也能识别
        await expect(items.nth(1)).toContainText('3×4=（');

        // 第 3 题：参考答案区按题号回填
        await items.nth(2).getByRole('button', { name: '编辑' }).click();
        await items.nth(2).getByRole('button', { name: '答案与知识点' }).click();
        await expect(items.nth(2).getByLabel('参考答案')).toHaveValue('C');

        // 第 1 题答案以标记为准，不被答案区覆盖（重新展开第 1 题核对）
        await items.nth(0).getByRole('button', { name: '编辑' }).click();
        await items.nth(0).getByRole('button', { name: '答案与知识点' }).click();
        await expect(items.nth(0).getByLabel('参考答案')).toHaveValue('20÷18=10/9');

        // 按原样入库：不调用 AI，字段以草稿为准
        await page.getByRole('radio', { name: '按原样入库' }).click();
        await page.getByRole('button', { name: '按原样导入 3 题' }).click();
        await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(3);

        const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id }, orderBy: { questionText: 'asc' } });
        expect(saved).toHaveLength(3);
        const first = saved.find((item) => item.questionText?.includes('男生人数是女生的几倍'));
        expect(first).toBeDefined();
        expect(first!.answerText).toBe('20÷18=10/9');
        expect(first!.difficultyStars).toBe(2);
        expect(first!.questionType).toBe('fill_blank');
        const second = saved.find((item) => item.questionText?.includes('3×4'));
        expect(second).toBeDefined();
        const third = saved.find((item) => item.questionText?.includes('计算 5 + 6'));
        expect(third).toBeDefined();
    });
});

test.describe('文字录入：长文字自动分批', () => {
    test('[E2E-F5-2] 65 道编号题自动拆成 2 个批次，提示文案包含数量', async ({ page, scenario }) => {
        await scenario.login(page);
        await page.goto(`/?notebook=${scenario.book.id}`);
        await page.getByRole('tab', { name: '手动输入', exact: true }).click();

        await page.locator('#question-text').fill(buildLongText(65));
        await expect(page.getByTestId('multi-detected')).toContainText('检测到 65 道编号题');
        await page.getByRole('button', { name: '分题预览（60 题）' }).click();

        // 提示文案包含 2 个批次
        await expect(page.getByText(/已拆成 2 个批次/)).toBeVisible();
        await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);

        // 数据库验证：2 个批次，题目合计 65
        const batches = await scenario.db.importBatch.findMany({ where: { userId: scenario.user.id } });
        expect(batches).toHaveLength(2);
        const draftCounts = batches.map((batch) => {
            const draft = JSON.parse(batch.draft || '{"items":[]}') as { items: unknown[] };
            return draft.items.length;
        });
        expect(draftCounts.sort((a, b) => a - b)).toEqual([5, 60]);
        expect(draftCounts.reduce((sum, count) => sum + count, 0)).toBe(65);
    });
});

test.describe('文字录入：从文件导入', () => {
    test('[E2E-F5-3] 选择 .txt 填入文字框；已有内容时可追加；选择 .docx 提示切换入口', async ({ page, scenario }) => {
        await scenario.login(page);
        await page.goto(`/?notebook=${scenario.book.id}`);
        await page.getByRole('tab', { name: '手动输入', exact: true }).click();

        // 先手动输入一段内容
        await page.locator('#question-text').fill('1．手动输入的题目。');

        // 选择 .txt 文件
        const txtContent = '2．文件导入的题目。';
        await page.getByTestId('import-file-input').setInputFiles({
            name: 'questions.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(txtContent, 'utf8'),
        });

        // 出现替换/追加确认
        await expect(page.getByText('文字框已有内容，用文件内容替换，还是追加到末尾？')).toBeVisible();
        await page.getByRole('button', { name: '追加到末尾' }).click();

        // 两段内容都在
        await expect(page.locator('#question-text')).toHaveValue(/手动输入的题目/);
        await expect(page.locator('#question-text')).toHaveValue(/文件导入的题目/);

        // 选择 .docx 文件
        const docxBuffer = buildMinimalDocx('题库文件内容');
        await page.getByTestId('import-file-input').setInputFiles({
            name: 'bank.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: docxBuffer,
        });

        // 出现题库文件提示
        await expect(page.getByText('这是题库文件，请使用「导入题库文件」入口导入。')).toBeVisible();
        await expect(page.getByRole('button', { name: '切换到导入题库文件' })).toBeVisible();
    });
});
