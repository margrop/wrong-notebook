import { readFileSync } from 'node:fs';
import { expect, test } from './support/fixtures';
import type { Page } from './support/fixtures';
import { buildCsvBuffer, buildXlsxBuffer, TEMPLATE_COLUMNS } from './support/e2-helpers';

/** 首页切到「导入题库文件」tab 并等待面板就绪（自动选中目标错题本） */
async function gotoFileImportTab(page: Page, notebookId: string) {
    await page.goto(`/?notebook=${notebookId}`);
    await page.getByRole('tab', { name: '导入题库文件', exact: true }).click();
    await expect(page.getByTestId('file-import-panel')).toBeVisible();
}

/** 上传文件并等待摘要出现 */
async function uploadAndWaitSummary(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
    await page.getByTestId('import-file-input').setInputFiles(file);
    await expect(page.getByTestId('file-import-summary')).toBeVisible();
}

test('[E2E-F2-1] 导入 .xlsx 题库：2 道单选 + 1 道填空，按原样入库后字段正确', async ({ page, scenario }) => {
    const rows = [
        // 单选题 1
        ['下列哪个数是质数？', '2', '4', '6', '8', 'A', '2 是质数，其他都是合数。', '数的认识、质数与合数', '3', '单选题', '数学', '七年级上学期', '2025 期中', '第一大题', '1'],
        // 单选题 2
        ['一元一次方程 2x = 4 的解是（　　）。', 'x = 1', 'x = 2', 'x = 3', 'x = 4', 'B', '两边同除以 2 得 x = 2。', '一元一次方程', '2', '单选题', '数学', '七年级上学期', '2025 期中', '第一大题', '2'],
        // 填空题
        ['1 + 1 = ____。', '', '', '', '', '2', '基础加法。', '基础运算', '易', '填空题', '数学', '一年级上学期', '课堂练习', '第一大题', '3'],
    ];
    const buffer = await buildXlsxBuffer(rows);

    await scenario.login(page);
    await gotoFileImportTab(page, scenario.book.id);

    // 模板下载链接可见
    await expect(page.getByRole('button', { name: '下载 Excel 模板' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载 CSV 模板' })).toBeVisible();

    await uploadAndWaitSummary(page, { name: 'questions.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });

    // 摘要显示 3 题
    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 3 道题。');

    // 确认导入
    await page.getByRole('button', { name: '导入 3 道题' }).click();

    // 单批直达批次详情页
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题\s*·\s*已选 3 题/);

    // 草稿第 1 题题干包含「A．」开头的选项行
    const firstItem = page.getByTestId('draft-item').nth(0);
    await expect(firstItem).toContainText('A．2');

    // 选择「按原样入库」（所有题都带答案，默认即为 tags，需手动切到 none）
    await page.getByTestId('draft-analysis-none').click();
    await expect(page.getByTestId('draft-analysis-none')).toHaveAttribute('aria-checked', 'true');

    // 按原样入库不调用 AI
    expect((await scenario.model()).calls).toHaveLength(0);

    // 开始导入
    await page.getByRole('button', { name: '按原样导入 3 题' }).click();

    // 等待全部入库
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 30000 });
    await expect(page.getByTestId('batch-counts')).toContainText('已导入 3');

    // 数据库验证
    const items = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id }, orderBy: { createdAt: 'asc' } });
    expect(items).toHaveLength(3);

    // 第 1 题：单选题，题干含选项行
    expect(items[0].questionText).toContain('下列哪个数是质数？');
    expect(items[0].questionText).toContain('A．2');
    expect(items[0].questionText).toContain('B．4');
    expect(items[0].answerText).toBe('A');
    expect(items[0].analysis).toBe('2 是质数，其他都是合数。');
    expect(items[0].questionType).toBe('single_choice');
    expect(items[0].difficultyStars).toBe(3);

    // 第 2 题：单选题
    expect(items[1].questionText).toContain('一元一次方程 2x = 4 的解是');
    expect(items[1].questionText).toContain('A．x = 1');
    expect(items[1].answerText).toBe('B');
    expect(items[1].questionType).toBe('single_choice');
    expect(items[1].difficultyStars).toBe(2);

    // 第 3 题：填空题
    expect(items[2].questionText).toContain('1 + 1 = ____。');
    expect(items[2].answerText).toBe('2');
    expect(items[2].questionType).toBe('fill_blank');
    expect(items[2].difficultyStars).toBe(1);

    // 全部落在目标错题本
    expect(items.every((item) => item.subjectId === scenario.book.id)).toBe(true);

    // 不调用 AI
    expect((await scenario.model()).calls).toHaveLength(0);
});

test('[E2E-F2-2] 导入 CSV（UTF-8 BOM）：引号字段内含逗号与换行，导入后保留', async ({ page, scenario }) => {
    const rows = [
        ['小明有 3 个苹果，又买了 5 个，现在一共有几个？', '', '', '', '', '8 个', '3 + 5 = 8。', '基础运算', '易', '填空题', '数学', '一年级上学期', '', '', ''],
        ['下列说法中，正确的是（　　）。\n① 1+1=2\n② 2+2=5', '① 正确', '② 正确', '①②都正确', '都不正确', 'A', '① 显然正确，② 错误。', '逻辑判断', '3', '单选题', '数学', '三年级上学期', '', '', ''],
    ];
    const buffer = buildCsvBuffer(rows);

    await scenario.login(page);
    await gotoFileImportTab(page, scenario.book.id);
    await uploadAndWaitSummary(page, { name: 'questions.csv', mimeType: 'text/csv', buffer });

    await expect(page.getByTestId('file-import-summary')).toContainText('共解析出 2 道题。');

    await page.getByRole('button', { name: '导入 2 道题' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题\s*·\s*已选 2 题/);

    // 第 1 题题干包含逗号
    const firstItem = page.getByTestId('draft-item').nth(0);
    await expect(firstItem).toContainText('小明有 3 个苹果，又买了 5 个');

    // 第 2 题题干包含换行
    const secondItem = page.getByTestId('draft-item').nth(1);
    await expect(secondItem).toContainText('下列说法中，正确的是');
    await expect(secondItem).toContainText('① 1+1=2');

    // 按原样入库
    await page.getByTestId('draft-analysis-none').click();
    await page.getByRole('button', { name: '按原样导入 2 题' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 30000 });

    const items = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id }, orderBy: { createdAt: 'asc' } });
    expect(items).toHaveLength(2);
    expect(items[0].questionText).toContain('小明有 3 个苹果，又买了 5 个');
    expect(items[1].questionText).toContain('① 1+1=2');
});

test('[E2E-F2-3] 模板下载：Excel 与 CSV 模板均可下载且非空', async ({ page, scenario }) => {
    await scenario.login(page);
    await gotoFileImportTab(page, scenario.book.id);

    // 下载 Excel 模板
    const [xlsxDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '下载 Excel 模板' }).click(),
    ]);
    const xlsxPath = await xlsxDownload.path();
    expect(xlsxPath).toBeTruthy();
    const xlsxContent = readFileSync(xlsxPath!);
    expect(xlsxContent.length).toBeGreaterThan(0);

    // 下载 CSV 模板
    const [csvDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '下载 CSV 模板' }).click(),
    ]);
    const csvPath = await csvDownload.path();
    expect(csvPath).toBeTruthy();
    const csvContent = readFileSync(csvPath!, 'utf8');
    expect(csvContent.length).toBeGreaterThan(0);

    // CSV 模板首行包含「题干」与「答案」
    const firstLine = csvContent.split('\n')[0].replace(/^﻿/, '');
    expect(firstLine).toContain('题干');
    expect(firstLine).toContain('答案');
});

test('[E2E-F2-4] 缺少题干列的表格：摘要显示错误且无法确认导入', async ({ page, scenario }) => {
    // 构造一个缺少「题干」列的 xlsx：只有「答案」「解析」列
    const { default: writeExcelFile } = await import('write-excel-file/node');
    const sheetData = [['答案', '解析'], ['A', '这是解析'], ['B', '这是解析']];
    const buffer = await writeExcelFile(sheetData).toBuffer();

    await scenario.login(page);
    await gotoFileImportTab(page, scenario.book.id);

    // 上传后：解析失败，toast 显示错误，回到选择页
    await page.getByTestId('import-file-input').setInputFiles({ name: 'no-text.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    // 等待 toast 出现（「未找到「题干」列…」）
    await expect(page.getByText(/未找到「题干」列/)).toBeVisible();

    // 仍停留在选择页（file-import-summary 不出现）
    await expect(page.getByTestId('file-import-summary')).toHaveCount(0);
    // 确认按钮不存在
    await expect(page.getByRole('button', { name: /导入 \d+ 道题/ })).toHaveCount(0);
});
