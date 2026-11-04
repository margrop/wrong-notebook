import { expect, test } from './support/fixtures';
import { calls } from './support/batch-flows';
import { makeCorruptPdf, makeScannedPdf, makeTextPdf, makeTextPdfWithRects } from './support/e4-helpers';

/** 把 ArrayBuffer 转成 Node Buffer（setInputFiles 要求 Buffer） */
function toBuffer(buffer: ArrayBuffer): Buffer {
    return Buffer.from(buffer);
}

/**
 * 文字版 PDF：1 页 3 道英文编号题。
 * 每行动词不同，避免跨页页眉页脚检测把「去数字后相同」的行误判为页眉。
 */
function textPdfOnePage(): ArrayBuffer {
    return makeTextPdf([
        [
            { text: '1. Compute 2 + 3.', y: 72 },
            { text: '2. Evaluate 4 + 5.', y: 144 },
            { text: '3. Calculate 6 + 7.', y: 216 },
        ],
    ]);
}

/** 文字版 PDF：2 页，第 1 页 2 题、第 2 页 1 题（跨页） */
function textPdfTwoPages(): ArrayBuffer {
    return makeTextPdf([
        [
            { text: '1. Compute 2 + 3.', y: 72 },
            { text: '2. Evaluate 4 + 5.', y: 144 },
        ],
        [{ text: '3. Calculate 6 + 7.', y: 72 }],
    ]);
}

/** 打开首页「导入题库文件」页签并上传 PDF 文件 */
async function uploadPdf(page: import('./support/fixtures').Page, buffer: ArrayBuffer, fileName: string) {
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await page.getByTestId('import-file-input').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: toBuffer(buffer) });
}

test('[E2E-F4-1] 文字版 PDF（1 页 3 题）：摘要 3 题、生产构建下 pdfjs worker 正常加载，进入批次后按原样入库成功', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, textPdfOnePage(), 'text-one-page.pdf');
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 3 道题。', { timeout: 30000 });
    await expect(page.getByTestId('file-import-summary')).toContainText('text-one-page.pdf');
    await expect(page.getByRole('button', { name: '导入 3 道题' })).toBeEnabled();
    await page.getByRole('button', { name: '导入 3 道题' }).click();

    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/, { timeout: 30000 });
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/);
    const items = page.getByTestId('draft-item');
    await expect(items).toHaveCount(3);
    // 分题预览把顶层题号剥离为「原题号 N」，正文不含题号
    await expect(items.nth(0)).toContainText('原题号 1');
    await expect(items.nth(0)).toContainText('Compute 2 + 3.');
    await expect(items.nth(1)).toContainText('原题号 2');
    await expect(items.nth(1)).toContainText('Evaluate 4 + 5.');
    await expect(items.nth(2)).toContainText('原题号 3');
    await expect(items.nth(2)).toContainText('Calculate 6 + 7.');

    // 按原样入库：本用例验证 PDF 解析与入库，不经 AI（带原图的题用 AI 完整解析时会按图片识别，见 P2）
    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: /按原样导入 3 题/ }).click();
    await expect(page.getByTestId('batch-progress')).toBeVisible();
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(3);
    const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    expect(saved.every((item) => item.subjectId === scenario.book.id)).toBe(true);
    const texts = saved.map((item) => item.questionText);
    expect(texts).toContain('Compute 2 + 3.');
    expect(texts).toContain('Evaluate 4 + 5.');
    expect(texts).toContain('Calculate 6 + 7.');
});

test('[E2E-F4-2] 文字版 PDF（2 页跨页 3 题）：摘要 3 题、批次 3 题入库', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, textPdfTwoPages(), 'text-two-pages.pdf');
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 3 道题。', { timeout: 30000 });
    await page.getByRole('button', { name: '导入 3 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/, { timeout: 30000 });
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/);
    await expect(page.getByTestId('draft-item')).toHaveCount(3);

    // 按原样入库：本用例验证 PDF 解析与入库，不经 AI（带原图的题用 AI 完整解析时会按图片识别，见 P2）
    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: /按原样导入 3 题/ }).click();
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(3);
});

// 回归：解析时 pdfjs 会转移 ArrayBuffer 所有权，渲染扫描页前需保留可用的数据副本
test('[E2E-F4-3] 扫描版 PDF（2 页无文字层）：显示扫描版视图与页数，确认后每页创建 image 批次', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, makeScannedPdf(2), 'scanned-two-pages.pdf');

    // 进入扫描版视图：标题提示总页数
    const scanned = page.getByTestId('file-import-scanned-pdf');
    await expect(scanned).toBeVisible({ timeout: 30000 });
    await expect(scanned).toContainText('这是扫描版 PDF（共 2 页）');
    await expect(scanned).toContainText('scanned-two-pages.pdf');
    // 目标错题本已由 ?notebook= 预选；确认按钮可用
    const confirm = page.getByRole('button', { name: '转为图片并识别导入' });
    await expect(confirm).toBeEnabled();

    await confirm.click();
    // 2 个批次：跳转到导入中心列表（多批）
    await expect(page).toHaveURL(/\/import-tasks$/, { timeout: 30000 });
    const card = page.getByTestId('import-batch-card');
    await expect(card).toHaveCount(2);

    // mock AI 的 split 被调用 2 次（每页一次）
    expect(await calls(scenario, 'split')).toHaveLength(2);
    // 数据库中 source='image' 的批次 2 个
    await expect.poll(() => scenario.db.importBatch.count({ where: { userId: scenario.user.id, source: 'image' } })).toBe(2);
});

test('[E2E-F4-4] 页码范围：非法范围（超出页数）显示无效提示', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, makeScannedPdf(2), 'scanned-range-invalid.pdf');
    await expect(page.getByTestId('file-import-scanned-pdf')).toBeVisible({ timeout: 30000 });
    await page.locator('#scanned-pdf-range').fill('5-9');
    await page.getByRole('button', { name: '转为图片并识别导入' }).click();
    // 范围无效提示渲染在扫描版视图内（role=alert）；排除 Next.js 路由播报器
    const rangeAlert = page.getByTestId('file-import-scanned-pdf').getByRole('alert');
    await expect(rangeAlert).toContainText('页码范围无效');
    await expect(rangeAlert).toContainText('页码超出范围（共 2 页）');
    // 未创建任何批次
    expect(await scenario.db.importBatch.count({ where: { userId: scenario.user.id, source: 'image' } })).toBe(0);
});

test('[E2E-F4-5] 页码范围：输入「1」只处理第 1 页，只创建 1 个批次', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, makeScannedPdf(2), 'scanned-range-1.pdf');
    const scanned = page.getByTestId('file-import-scanned-pdf');
    await expect(scanned).toBeVisible({ timeout: 30000 });
    await scanned.locator('#scanned-pdf-range').fill('1');
    await page.getByRole('button', { name: '转为图片并识别导入' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/, { timeout: 30000 });
    expect(await calls(scenario, 'split')).toHaveLength(1);
    await expect.poll(() => scenario.db.importBatch.count({ where: { userId: scenario.user.id, source: 'image' } })).toBe(1);
});

test('[E2E-F4-6] 损坏的 PDF：显示无效 PDF 的提示，不创建批次', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, makeCorruptPdf(), 'corrupt.pdf');
    // toast 提示文件损坏或不是有效 PDF
    await expect(page.getByText('无法读取该 PDF 文件，文件可能已损坏或不是有效的 PDF')).toBeVisible({ timeout: 30000 });
    expect(await scenario.db.importBatch.count({ where: { userId: scenario.user.id } })).toBe(0);
});

/**
 * 文字版 PDF（1 页 2 题，第 2 题下方有矩形图形）。
 * 用于题目原图截图测试：选择「有图形的题」时只给第 2 题截图。
 */
function textPdfWithRect(): ArrayBuffer {
    return makeTextPdfWithRects([
        {
            lines: [
                { text: '1. Compute 2 + 3.', y: 150 },
                { text: '2. Evaluate 4 + 5.', y: 350 },
            ],
            rects: [
                // 矩形位于第 2 题区域（题号行下方），y 自上而下
                { x: 100, y: 400, width: 200, height: 60, strokeGray: 0 },
            ],
        },
    ]);
}

test('[E2E-F4-7] 文字版 PDF 含矩形图形：默认「全部题」，改选「有图形的题」→ 第 2 题带 data:image 原图，第 1 题为空', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, textPdfWithRect(), 'text-with-rect.pdf');

    // 摘要视图显示「题目原图」选项，默认选中「全部题」；改选「有图形的题」
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 2 道题。', { timeout: 30000 });
    await expect(page.getByTestId('pdf-image-option')).toBeVisible();
    await expect(page.getByTestId('pdf-image-option-all')).toBeChecked();
    const withGraphics = page.getByTestId('pdf-image-option-with-graphics');
    await withGraphics.check();
    await expect(withGraphics).toBeChecked();

    // 确认导入
    await page.getByRole('button', { name: '导入 2 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/, { timeout: 30000 });
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);

    // 按原样入库
    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: /按原样导入 2 题/ }).click();
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(2);

    // 第 2 题 originalImageUrl 以 data:image/ 开头；第 1 题为空
    const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    const q1 = saved.find((item) => item.questionText?.includes('Compute 2 + 3.'));
    const q2 = saved.find((item) => item.questionText?.includes('Evaluate 4 + 5.'));
    expect(q1).toBeDefined();
    expect(q2).toBeDefined();
    expect(q1?.originalImageUrl ?? '').toBe('');
    expect(q2?.originalImageUrl).toMatch(/^data:image\//);
});

test('[E2E-F4-8] 文字版 PDF 含矩形图形：选择「不保存」→ 两题 originalImageUrl 均为空', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await uploadPdf(page, textPdfWithRect(), 'text-with-rect-none.pdf');

    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 2 道题。', { timeout: 30000 });
    // 选择「不保存」
    await page.getByTestId('pdf-image-option-none').click();

    await page.getByRole('button', { name: '导入 2 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/, { timeout: 30000 });

    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: /按原样导入 2 题/ }).click();
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(2);

    const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    for (const item of saved) {
        expect(item.originalImageUrl ?? '').toBe('');
    }
});
