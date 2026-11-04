/**
 * xlsx.ts 与 table-template.ts 的单元测试：
 * 用 write-excel-file 生成真实 .xlsx 文件，再用 read-excel-file 解析回来做往返验证。
 */
import { describe, expect, it } from 'vitest';
import { parseXlsxFile } from '@/lib/import/file-parsers/xlsx';
import { buildCsvTemplate, buildXlsxTemplate, TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE_ROWS } from '@/lib/import/file-parsers/table-template';

describe('parseXlsxFile', () => {
    it('解析单工作表 .xlsx 文件', async () => {
        const { default: writeExcelFile } = await import('write-excel-file/universal');
        const sheetData = [
            ['题干', '答案', '解析'],
            ['1+1=?', '2', '基础加法'],
            ['2+2=?', '4', '基础加法'],
        ];
        const blob = await writeExcelFile(sheetData).toBlob();

        const result = await parseXlsxFile(blob);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].text).toBe('1+1=?');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[1].answer).toBe('4');
    });

    it('多工作表时用工作表名作为默认大题', async () => {
        const { default: writeExcelFile } = await import('write-excel-file/universal');
        const sheet1 = [
            ['题干', '答案'],
            ['题1', 'A'],
        ];
        const sheet2 = [
            ['题干', '答案'],
            ['题2', 'B'],
        ];
        const blob = await writeExcelFile([
            { data: sheet1, sheet: '第一章' },
            { data: sheet2, sheet: '第二章' },
        ]).toBlob();

        const result = await parseXlsxFile(blob);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].section).toBe('第一章');
        expect(result.questions[1].section).toBe('第二章');
    });

    it('多工作表时表内有大题列则不用工作表名', async () => {
        const { default: writeExcelFile } = await import('write-excel-file/universal');
        const sheet1 = [
            ['题干', '大题'],
            ['题1', '自定义大题'],
        ];
        const sheet2 = [
            ['题干'],
            ['题2'],
        ];
        const blob = await writeExcelFile([
            { data: sheet1, sheet: '第一章' },
            { data: sheet2, sheet: '第二章' },
        ]).toBlob();

        const result = await parseXlsxFile(blob);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].section).toBe('自定义大题');
        expect(result.questions[1].section).toBe('第二章');
    });

    it('空工作表跳过', async () => {
        const { default: writeExcelFile } = await import('write-excel-file/universal');
        const sheet1: string[][] = [];
        const sheet2 = [
            ['题干'],
            ['题1'],
        ];
        const blob = await writeExcelFile([
            { data: sheet1, sheet: '空表' },
            { data: sheet2, sheet: '有数据' },
        ]).toBlob();

        const result = await parseXlsxFile(blob);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('题1');
    });

    it('模板 .xlsx 解析回来与示例一致（往返测试）', async () => {
        const blob = await buildXlsxTemplate();
        const result = await parseXlsxFile(blob);

        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);

        // 第一题：选择题
        const q1 = result.questions[0];
        expect(q1.text).toContain('下列哪个选项是正确的？');
        expect(q1.text).toContain('A．选项一');
        expect(q1.text).toContain('D．选项四');
        expect(q1.answer).toBe('A');
        expect(q1.analysis).toBe('这是解析内容。');
        expect(q1.knowledgePoints).toEqual(['知识点一', '知识点二']);
        expect(q1.difficultyStars).toBe(3);
        expect(q1.questionType).toBe('单选题');
        expect(q1.subject).toBe('数学');
        expect(q1.gradeSemester).toBe('七年级上学期');
        expect(q1.source).toBe('2025 期中');
        expect(q1.section).toBe('第一大题');
        expect(q1.label).toBe('1');

        // 第二题：填空题
        const q2 = result.questions[1];
        expect(q2.text).toContain('1+1=____。');
        expect(q2.answer).toBe('2');
        expect(q2.analysis).toBe('基础加法运算。');
        expect(q2.difficultyStars).toBe(1);
        expect(q2.questionType).toBe('填空题');
    });
});

describe('buildCsvTemplate', () => {
    it('生成 UTF-8 BOM 的 CSV 字符串', () => {
        const csv = buildCsvTemplate();
        expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it('CSV 模板可被 parseCsvText 解析回来', async () => {
        const { parseCsvText } = await import('@/lib/import/file-parsers/csv');
        const csv = buildCsvTemplate();
        const { rows } = parseCsvText(csv);

        expect(rows[0]).toEqual(TEMPLATE_COLUMNS);
        expect(rows[1]).toEqual(TEMPLATE_EXAMPLE_ROWS[0]);
        expect(rows[2]).toEqual(TEMPLATE_EXAMPLE_ROWS[1]);
    });
});

describe('TEMPLATE_COLUMNS', () => {
    it('包含所有必需列', () => {
        expect(TEMPLATE_COLUMNS).toContain('题干');
        expect(TEMPLATE_COLUMNS).toContain('答案');
        expect(TEMPLATE_COLUMNS).toContain('解析');
        expect(TEMPLATE_COLUMNS).toContain('选项A');
        expect(TEMPLATE_COLUMNS).toContain('选项D');
        expect(TEMPLATE_COLUMNS).toContain('知识点');
        expect(TEMPLATE_COLUMNS).toContain('难度');
        expect(TEMPLATE_COLUMNS).toContain('题型');
    });
});
