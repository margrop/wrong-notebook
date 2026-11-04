/**
 * E6：错题列表多选导出 JSON / Excel / Word。
 * 数据源：scenario.db 直接创建 3 道错题（含答案、解析、题型，其中 1 道 originalImageUrl 为 PNG data URL）。
 * 进入路径：/notebooks/<id> → 「多选」（exact: true，避免与题型筛选「多选题」冲突）→ 勾选 3 题 → 「导出 JSON」。
 */
import { expect, test } from './support/fixtures';
import type { Page, Scenario } from './support/fixtures';
import { TINY_PNG_DATA_URL, captureDownload, readXlsxRows, unzipDocx } from './support/e6-helpers';

/** 通过 db 创建 3 道测试错题：A（含 PNG data URL 原图）、B、C */
async function seedThreeItems(scenario: Scenario) {
    const itemA = await scenario.item('A', {
        questionText: `计算 1 + 2。${scenario.marker}`,
        answerText: '3',
        analysis: '直接相加。',
        questionType: 'calculation',
        originalImageUrl: TINY_PNG_DATA_URL,
    });
    const itemB = await scenario.item('B', {
        questionText: `下列哪个是偶数？${scenario.marker}`,
        answerText: '2',
        analysis: '2 能被 2 整除。',
        questionType: 'single_choice',
    });
    const itemC = await scenario.item('C', {
        questionText: `求解 x + 1 = 3。${scenario.marker}`,
        answerText: 'x = 2',
        analysis: '移项得 x = 3 - 1 = 2。',
        questionType: 'calculation',
    });
    return { itemA, itemB, itemC };
}

/** 进入错题本详情页的多选模式，按题干勾选指定错题，返回勾选顺序的 id 数组 */
async function enterSelectModeAndPick(page: Page, questionTexts: string[]): Promise<string[]> {
    await page.getByRole('button', { name: '多选', exact: true }).click();
    const picked: string[] = [];
    for (const text of questionTexts) {
        const card = page.locator('a', { hasText: text }).locator('..');
        await card.getByRole('checkbox').click();
        picked.push(text);
    }
    return picked;
}

/** 打开导出对话框并选择目标格式（SegmentedControl 渲染为 role="tab"） */
async function openExportDialogPickFormat(page: Page, formatLabel: string) {
    await page.getByRole('button', { name: '导出 JSON' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: formatLabel, exact: true }).click();
    return dialog;
}

test('[E2E-F6-1] 多选 3 题导出 JSON：不勾/勾选「包含原图」均正确，顺序与选择一致', async ({ page, scenario }) => {
    const { itemA, itemB, itemC } = await seedThreeItems(scenario);
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(`计算 1 + 2。${scenario.marker}`)).toBeVisible();

    // 依次勾选 C、A、B（与列表默认顺序不同），服务端按 ids 传入顺序输出
    await enterSelectModeAndPick(page, [
        `求解 x + 1 = 3。${scenario.marker}`,
        `计算 1 + 2。${scenario.marker}`,
        `下列哪个是偶数？${scenario.marker}`,
    ]);

    // 第一次导出：JSON，不勾选「包含原图」
    const dialog = await openExportDialogPickFormat(page, 'JSON');
    const first = await captureDownload(page, () => dialog.getByRole('button', { name: '导出', exact: true }).click());
    expect(first.name).toMatch(/\.json$/);
    const file1 = JSON.parse(first.buffer.toString('utf8')) as {
        format: string; version: number; questions: Array<{
            text: string; answer?: string; questionType?: string; images?: Array<{ dataUrl: string }>;
        }>;
    };
    expect(file1.format).toBe('wrong-notebook-questions');
    expect(file1.version).toBe(1);
    expect(file1.questions).toHaveLength(3);
    // 服务端按 ids 传入顺序输出（src/app/api/error-items/export-questions/route.ts）
    expect(file1.questions.map((q) => q.text)).toEqual([
        `求解 x + 1 = 3。${scenario.marker}`,
        `计算 1 + 2。${scenario.marker}`,
        `下列哪个是偶数？${scenario.marker}`,
    ]);
    expect(file1.questions[0].questionType).toBe('calculation');
    expect(file1.questions[1].questionType).toBe('calculation');
    expect(file1.questions[2].questionType).toBe('single_choice');
    // 不勾选「包含原图」：任何题都不应有 images
    expect(file1.questions.every((q) => !q.images)).toBe(true);

    // 第二次导出：勾选「包含原图」（仅第 2 题 A 有 data URL 原图）
    const dialog2 = await openExportDialogPickFormat(page, 'JSON');
    await dialog2.getByLabel('包含原图（文件会变大）').check();
    const second = await captureDownload(page, () => dialog2.getByRole('button', { name: '导出', exact: true }).click());
    const file2 = JSON.parse(second.buffer.toString('utf8')) as { questions: Array<{ text: string; images?: Array<{ dataUrl: string }> }> };
    expect(file2.questions).toHaveLength(3);
    // 仅 A（选择顺序第 2 位）有 images
    expect(file2.questions[0].images).toBeUndefined();
    expect(file2.questions[1].images).toHaveLength(1);
    expect(file2.questions[1].images?.[0].dataUrl).toBe(TINY_PNG_DATA_URL);
    expect(file2.questions[2].images).toBeUndefined();

    // 未触发 AI
    expect((await scenario.model()).calls).toHaveLength(0);
    void itemA; void itemB; void itemC;
});

test('[E2E-F6-2] 多选 3 题导出 Excel：.xlsx 表头与导入模板一致（含「题干」「答案」），数据 3 行', async ({ page, scenario }) => {
    await seedThreeItems(scenario);
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(`计算 1 + 2。${scenario.marker}`)).toBeVisible();

    await enterSelectModeAndPick(page, [
        `计算 1 + 2。${scenario.marker}`,
        `下列哪个是偶数？${scenario.marker}`,
        `求解 x + 1 = 3。${scenario.marker}`,
    ]);
    const dialog = await openExportDialogPickFormat(page, 'Excel');
    const downloaded = await captureDownload(page, () => dialog.getByRole('button', { name: '导出', exact: true }).click());
    expect(downloaded.name).toMatch(/\.xlsx$/);
    const rows = await readXlsxRows(downloaded.buffer);
    // 表头与导入模板一致：题干/选项A~D/答案/解析/知识点/难度/题型/学科/年级学期/来源/大题/题号
    expect(rows[0]).toEqual(['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '知识点', '难度', '题型', '学科', '年级学期', '来源', '大题', '题号']);
    expect(rows).toHaveLength(4); // 表头 + 3 题
    expect(rows[1][0]).toContain(`计算 1 + 2。${scenario.marker}`);
    expect(rows[1][5]).toBe('3');
    expect(rows[2][0]).toContain(`下列哪个是偶数？${scenario.marker}`);
    expect(rows[3][0]).toContain(`求解 x + 1 = 3。${scenario.marker}`);
    expect(rows[3][5]).toBe('x = 2');
    // Excel 不写入图片列，images 不会出现在任何单元格
    expect(rows.flat().every((cell) => !cell.includes('data:image'))).toBe(true);
    expect((await scenario.model()).calls).toHaveLength(0);
});

test('[E2E-F6-3] 多选 3 题导出 Word（含答案与解析）：.docx 含 3 道题干与「参考答案」；勾选原图时 word/media/ 下有图片', async ({ page, scenario }) => {
    await seedThreeItems(scenario);
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(`计算 1 + 2。${scenario.marker}`)).toBeVisible();

    await enterSelectModeAndPick(page, [
        `计算 1 + 2。${scenario.marker}`,
        `下列哪个是偶数？${scenario.marker}`,
        `求解 x + 1 = 3。${scenario.marker}`,
    ]);
    // 第一次：默认包含答案与解析，不勾选原图
    const dialog = await openExportDialogPickFormat(page, 'Word');
    const first = await captureDownload(page, () => dialog.getByRole('button', { name: '导出', exact: true }).click());
    expect(first.name).toMatch(/\.docx$/);
    const entries1 = unzipDocx(first.buffer);
    const documentXml1 = entries1['word/document.xml'] ?? '';
    expect(documentXml1).toContain(`计算 1 + 2。${scenario.marker}`);
    expect(documentXml1).toContain(`下列哪个是偶数？${scenario.marker}`);
    expect(documentXml1).toContain(`求解 x + 1 = 3。${scenario.marker}`);
    expect(documentXml1).toContain('参考答案');
    expect(documentXml1).toContain('答案：3');
    // 不勾选原图：word/media/ 下无文件
    expect(Object.keys(entries1).filter((p) => p.startsWith('word/media/'))).toHaveLength(0);

    // 第二次：勾选「包含原图」
    const dialog2 = await openExportDialogPickFormat(page, 'Word');
    await dialog2.getByLabel('包含原图（文件会变大）').check();
    const second = await captureDownload(page, () => dialog2.getByRole('button', { name: '导出', exact: true }).click());
    const entries2 = unzipDocx(second.buffer);
    const documentXml2 = entries2['word/document.xml'] ?? '';
    expect(documentXml2).toContain(`计算 1 + 2。${scenario.marker}`);
    expect(documentXml2).toContain('参考答案');
    const mediaFiles = Object.keys(entries2).filter((p) => p.startsWith('word/media/'));
    expect(mediaFiles.length).toBeGreaterThan(0);
    expect((await scenario.model()).calls).toHaveLength(0);
});

test('[E2E-F6-4] 往返：导出的 JSON 经首页「导入题库文件」按原样入库，题目数量增加 3', async ({ page, scenario }) => {
    await seedThreeItems(scenario);
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(`计算 1 + 2。${scenario.marker}`)).toBeVisible();

    // 第一次导出 JSON（不勾选「包含原图」，纯文本往返）
    await enterSelectModeAndPick(page, [
        `计算 1 + 2。${scenario.marker}`,
        `下列哪个是偶数？${scenario.marker}`,
        `求解 x + 1 = 3。${scenario.marker}`,
    ]);
    const dialog = await openExportDialogPickFormat(page, 'JSON');
    const downloaded = await captureDownload(page, () => dialog.getByRole('button', { name: '导出', exact: true }).click());
    const exported = JSON.parse(downloaded.buffer.toString('utf8')) as { questions: Array<{ text: string }> };
    expect(exported.questions).toHaveLength(3);

    // 删除原 3 题，避免按题干判重导致导入被去重（数据库计数：0 → 3）
    const seeded = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    expect(seeded).toHaveLength(3);
    for (const item of seeded) {
        const response = await page.request.delete(`/api/error-items/${item.id}/delete`);
        expect(response.ok()).toBeTruthy();
    }

    // 首页「导入题库文件」上传同一 JSON
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await expect(page.getByTestId('file-import-panel')).toBeVisible();
    await page.getByTestId('import-file-input').setInputFiles({
        name: 'roundtrip.json',
        mimeType: 'application/json',
        buffer: downloaded.buffer,
    });
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 3 道题。');

    await page.getByRole('button', { name: '导入 3 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题\s*·\s*已选 3 题/);

    // 按原样入库（不调用 AI）
    await page.getByTestId('draft-analysis-none').click();
    await expect(page.getByTestId('draft-analysis-none')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: '按原样导入 3 题' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 30000 });
    await expect(page.getByTestId('batch-counts')).toContainText('已导入 3');

    // 数据库验证：0 + 新导入 3 道 = 3，且题干与导出文件一致
    const items = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.subjectId === scenario.book.id)).toBe(true);
    expect(items.map((item) => item.questionText).sort()).toEqual(exported.questions.map((q) => q.text).sort());
    // 不调用 AI
    expect((await scenario.model()).calls).toHaveLength(0);
});
