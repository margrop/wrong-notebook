/**
 * csv.ts 单元测试：RFC 4180 引号、字段内换行、转义双引号、分隔符识别。
 */
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '@/lib/import/file-parsers/csv';

describe('parseCsvText', () => {
    it('解析基本逗号分隔 CSV', () => {
        const csv = '题干,答案\n题1,A\n题2,B\n';
        const result = parseCsvText(csv);
        expect(result.delimiter).toBe(',');
        expect(result.rows).toEqual([
            ['题干', '答案'],
            ['题1', 'A'],
            ['题2', 'B'],
        ]);
    });

    it('识别分号分隔符', () => {
        const csv = '题干;答案\n题1;A\n题2;B\n';
        const result = parseCsvText(csv);
        expect(result.delimiter).toBe(';');
        expect(result.rows[1]).toEqual(['题1', 'A']);
    });

    it('识别制表符分隔符', () => {
        const csv = '题干\t答案\n题1\tA\n';
        const result = parseCsvText(csv);
        expect(result.delimiter).toBe('\t');
        expect(result.rows[1]).toEqual(['题1', 'A']);
    });

    it('引号字段包含分隔符', () => {
        const csv = '题干,答案\n"含,逗号的题",A\n';
        const result = parseCsvText(csv);
        expect(result.rows[1][0]).toBe('含,逗号的题');
        expect(result.rows[1][1]).toBe('A');
    });

    it('字段内换行（引号内 LF）', () => {
        const csv = '题干,答案\n"第一行\n第二行",A\n';
        const result = parseCsvText(csv);
        expect(result.rows[1][0]).toBe('第一行\n第二行');
        expect(result.rows).toHaveLength(2);
    });

    it('字段内换行（引号内 CRLF）', () => {
        const csv = '题干,答案\r\n"第一行\r\n第二行",A\r\n';
        const result = parseCsvText(csv);
        expect(result.rows[1][0]).toBe('第一行\r\n第二行');
    });

    it('转义双引号（两个连续引号）', () => {
        const csv = '题干,答案\n"含""引号""的题",A\n';
        const result = parseCsvText(csv);
        expect(result.rows[1][0]).toBe('含"引号"的题');
    });

    it('CRLF 行结束符', () => {
        const csv = '题干,答案\r\n题1,A\r\n题2,B\r\n';
        const result = parseCsvText(csv);
        expect(result.rows).toHaveLength(3);
        expect(result.rows[1]).toEqual(['题1', 'A']);
    });

    it('空行跳过', () => {
        const csv = '题干,答案\n\n题1,A\n\n\n题2,B\n';
        const result = parseCsvText(csv);
        expect(result.rows).toHaveLength(3);
    });

    it('BOM 兼容', () => {
        const csv = '\uFEFF题干,答案\n题1,A\n';
        const result = parseCsvText(csv);
        expect(result.rows[0][0]).toBe('题干');
        expect(result.rows[1]).toEqual(['题1', 'A']);
    });

    it('空字段', () => {
        const csv = '题干,答案,解析\n题1,,有解析\n';
        const result = parseCsvText(csv);
        expect(result.rows[1]).toEqual(['题1', '', '有解析']);
    });

    it('最后一行无换行符', () => {
        const csv = '题干,答案\n题1,A';
        const result = parseCsvText(csv);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[1]).toEqual(['题1', 'A']);
    });
});
