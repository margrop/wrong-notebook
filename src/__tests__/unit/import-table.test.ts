/**
 * table.ts 单元测试：表头识别、列别名映射、选项列、难度映射、错误与警告。
 */
import { describe, expect, it } from 'vitest';
import { parseTableRows } from '@/lib/import/file-parsers/table';

describe('parseTableRows', () => {
    it('识别中文表头并解析基本题目', () => {
        const rows = [
            ['题干', '答案', '解析'],
            ['1+1=?', '2', '基础加法'],
            ['2+2=?', '4', '基础加法'],
        ];
        const result = parseTableRows(rows);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].text).toBe('1+1=?');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[0].analysis).toBe('基础加法');
        expect(result.questions[1].answer).toBe('4');
    });

    it('识别英文表头别名', () => {
        const rows = [
            ['Question', 'Answer', 'Analysis', 'Knowledge', 'Difficulty'],
            ['What is 2+2?', '4', 'Basic addition', 'math,addition', '3'],
        ];
        const result = parseTableRows(rows);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(1);
        const q = result.questions[0];
        expect(q.text).toBe('What is 2+2?');
        expect(q.answer).toBe('4');
        expect(q.analysis).toBe('Basic addition');
        expect(q.knowledgePoints).toEqual(['math', 'addition']);
        expect(q.difficultyStars).toBe(3);
    });

    it('全角半角与大小写不敏感', () => {
        const rows = [
            ['题 干', '答 案', '难 度'],
            ['test', 'A', '★★★'],
        ];
        const result = parseTableRows(rows);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].answer).toBe('A');
        expect(result.questions[0].difficultyStars).toBe(3);
    });

    it('识别题干列在前 5 行中的任意一行', () => {
        const rows = [
            ['这是说明文字'],
            ['另一行说明'],
            ['题干', '答案'],
            ['题目1', 'A'],
        ];
        const result = parseTableRows(rows);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('题目1');
    });

    it('没有题干列时整体报错', () => {
        const rows = [
            ['答案', '解析'],
            ['A', '解析内容'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: 'TEXT_COLUMN_NOT_FOUND' }]);
    });

    it('未知列产生警告', () => {
        const rows = [
            ['题干', '未知列', '答案'],
            ['题目', 'x', 'A'],
        ];
        const result = parseTableRows(rows);
        expect(result.warnings).toContain('UNKNOWN_COLUMN:未知列');
        expect(result.questions).toHaveLength(1);
    });

    it('选项列追加到题干末尾', () => {
        const rows = [
            ['题干', '选项A', '选项B', '选项C', '选项D', '答案'],
            ['下列哪个正确？', '选项一', '选项二', '选项三', '选项四', 'B'],
        ];
        const result = parseTableRows(rows);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(1);
        const text = result.questions[0].text;
        expect(text).toContain('下列哪个正确？');
        expect(text).toContain('A．选项一');
        expect(text).toContain('B．选项二');
        expect(text).toContain('C．选项三');
        expect(text).toContain('D．选项四');
        expect(result.questions[0].answer).toBe('B');
    });

    it('选项列部分为空时跳过空选项', () => {
        const rows = [
            ['题干', '选项A', '选项B', '选项C', '答案'],
            ['只两个选项', '甲', '乙', '', 'A'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toHaveLength(1);
        const text = result.questions[0].text;
        expect(text).toContain('A．甲');
        expect(text).toContain('B．乙');
        expect(text).not.toContain('C．');
    });

    it('难度映射：数字 1~5', () => {
        const rows = [
            ['题干', '难度'],
            ['题1', '1'],
            ['题2', '5'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].difficultyStars).toBe(1);
        expect(result.questions[1].difficultyStars).toBe(5);
    });

    it('难度映射：★ 个数', () => {
        const rows = [
            ['题干', '难度'],
            ['题1', '★★'],
            ['题2', '★★★★★'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].difficultyStars).toBe(2);
        expect(result.questions[1].difficultyStars).toBe(5);
    });

    it('难度映射：中文文字', () => {
        const rows = [
            ['题干', '难度'],
            ['题1', '易'],
            ['题2', '中等'],
            ['题3', '难'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].difficultyStars).toBe(1);
        expect(result.questions[1].difficultyStars).toBe(3);
        expect(result.questions[2].difficultyStars).toBe(5);
    });

    it('难度映射：0~1 难度系数', () => {
        const rows = [
            ['题干', '难度'],
            ['题1', '0.9'],
            ['题2', '0.7'],
            ['题3', '0.5'],
            ['题4', '0.3'],
            ['题5', '0.1'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].difficultyStars).toBe(1);
        expect(result.questions[1].difficultyStars).toBe(2);
        expect(result.questions[2].difficultyStars).toBe(3);
        expect(result.questions[3].difficultyStars).toBe(4);
        expect(result.questions[4].difficultyStars).toBe(5);
    });

    it('难度无法解析时不填难度也不报错', () => {
        const rows = [
            ['题干', '难度'],
            ['题1', 'unknown'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].difficultyStars).toBeUndefined();
        expect(result.errors).toEqual([]);
    });

    it('题干为空但其他列有值时记错误', () => {
        const rows = [
            ['题干', '答案'],
            ['', 'A'],
            ['正常题', 'B'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('正常题');
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].reason).toContain('TEXT_REQUIRED');
    });

    it('空行跳过', () => {
        const rows = [
            ['题干', '答案'],
            ['题1', 'A'],
            ['', ''],
            ['   ', ''],
            ['题2', 'B'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toHaveLength(2);
        expect(result.errors).toEqual([]);
    });

    it('知识点按多种分隔符拆分', () => {
        const rows = [
            ['题干', '知识点'],
            ['题1', '甲、乙，丙;丁；戊'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].knowledgePoints).toEqual(['甲', '乙', '丙', '丁', '戊']);
    });

    it('数字单元格不变成科学计数法', () => {
        const rows = [
            ['题干', '题号', '答案'],
            ['题1', 42, 3.14],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].label).toBe('42');
        expect(result.questions[0].answer).toBe('3.14');
    });

    it('布尔与日期单元格转字符串', () => {
        const rows = [
            ['题干', '答案'],
            ['题1', true],
            ['题2', new Date('2025-01-15T00:00:00Z')],
        ];
        const result = parseTableRows(rows);
        expect(result.questions[0].answer).toBe('TRUE');
        expect(result.questions[1].answer).toBe('2025-01-15');
    });

    it('defaultSection 作为无大题列时的默认大题', () => {
        const rows = [
            ['题干'],
            ['题1'],
        ];
        const result = parseTableRows(rows, 'Sheet1');
        expect(result.questions[0].section).toBe('Sheet1');
    });

    it('表内有大题列时优先使用表内值', () => {
        const rows = [
            ['题干', '大题'],
            ['题1', '第一大题'],
        ];
        const result = parseTableRows(rows, 'Sheet1');
        expect(result.questions[0].section).toBe('第一大题');
    });

    it('材料、错答、学科、年级、来源、题型字段解析', () => {
        const rows = [
            ['题干', '材料', '错答', '学科', '年级学期', '来源', '题型'],
            ['题1', '阅读材料内容', 'B', '数学', '七年级上', '期中考试', '选择题'],
        ];
        const result = parseTableRows(rows);
        const q = result.questions[0];
        expect(q.material).toBe('阅读材料内容');
        expect(q.wrongAnswer).toBe('B');
        expect(q.subject).toBe('数学');
        expect(q.gradeSemester).toBe('七年级上');
        expect(q.source).toBe('期中考试');
        expect(q.questionType).toBe('选择题');
    });

    it('空表整体报错', () => {
        const result = parseTableRows([]);
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: 'EMPTY_TABLE' }]);
    });

    it('多行表头选择第一个可识别行', () => {
        const rows = [
            ['答案', '解析'],
            ['题干', '答案'],
            ['题1', 'A'],
        ];
        const result = parseTableRows(rows);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('题1');
    });
});
