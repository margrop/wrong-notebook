import { describe, expect, it } from 'vitest';
import { composeQuestionInput, splitQuestionText } from '@/lib/question-split/text';

describe('行首标记识别', () => {
    it('【答案】提取答案并从题干移除', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n【答案】2\n2．计算 2 + 2。');
        expect(result.questions[0].text).toBe('计算 1 + 1。');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[1].answer).toBeUndefined();
    });

    it('「答案：」与「Answer:」同样识别', () => {
        const result = splitQuestionText('1．What is 2+2?\n答案：4\n2．Solve x.\nAnswer: x = 1');
        expect(result.questions[0].answer).toBe('4');
        expect(result.questions[1].answer).toBe('x = 1');
    });

    it('【解析】/【分析】/【详解】/【解答】/【点评】并入 analysis，保留小标题', () => {
        const result = splitQuestionText('1．计算。\n【解析】因为 1+1=2\n【点评】注意进位\n2．下一题。');
        expect(result.questions[0].analysis).toContain('因为 1+1=2');
        expect(result.questions[0].analysis).toContain('注意进位');
        expect(result.questions[0].text).toBe('计算。');
    });

    it('【知识点】按顿号、逗号、分号分隔', () => {
        const result = splitQuestionText('1．计算。\n【知识点】加法、减法，乘法；除法\n2．下一题。');
        expect(result.questions[0].knowledgePoints).toEqual(['加法', '减法', '乘法', '除法']);
    });

    it('【难度】支持数字、星级与文字', () => {
        const numeric = splitQuestionText('1．计算。\n【难度】3\n2．计算。\n难度：★★★★\n3．计算。\n难度：较难');
        expect(numeric.questions[0].difficultyStars).toBe(3);
        expect(numeric.questions[1].difficultyStars).toBe(4);
        expect(numeric.questions[2].difficultyStars).toBe(4);
    });

    it('无法识别的难度忽略，不报错', () => {
        const result = splitQuestionText('1．计算。\n【难度】很难\n2．下一题。');
        expect(result.questions[0].difficultyStars).toBeUndefined();
        expect(result.questions[0].text).toBe('计算。');
    });

    it('【错答】/「我的答案：」/「学生答案：」提取错答', () => {
        const result = splitQuestionText('1．计算。\n【错答】3\n2．计算。\n我的答案：5\n3．计算。\n学生答案：7');
        expect(result.questions[0].wrongAnswer).toBe('3');
        expect(result.questions[1].wrongAnswer).toBe('5');
        expect(result.questions[2].wrongAnswer).toBe('7');
    });

    it('无标记时行为完全不变', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。');
        expect(result.questions[0].text).toBe('计算 1 + 1。');
        expect(result.questions[0].answer).toBeUndefined();
        expect(result.questions[0].analysis).toBeUndefined();
        expect(result.questions[0].knowledgePoints).toBeUndefined();
        expect(result.questions[0].difficultyStars).toBeUndefined();
        expect(result.questions[0].wrongAnswer).toBeUndefined();
    });

    it('多种标记同时存在时全部提取，题干只剩正文', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n【答案】2\n【解析】因为 1+1=2\n【知识点】加法\n【难度】2\n【错答】3');
        const q = result.questions[0];
        expect(q.text).toBe('计算 1 + 1。');
        expect(q.answer).toBe('2');
        expect(q.analysis).toBe('因为 1+1=2');
        expect(q.knowledgePoints).toEqual(['加法']);
        expect(q.difficultyStars).toBe(2);
        expect(q.wrongAnswer).toBe('3');
    });
});

describe('答案区按题号回填', () => {
    it('答案区条目按题号填入对应题目，匹配上的不再列入 ignored', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1．2\n2．4');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[1].answer).toBe('4');
        expect(result.ignored.join('\n')).not.toContain('1．2');
        expect(result.ignored.join('\n')).not.toContain('2．4');
    });

    it('答案区条目带解析时解析也填入对应题目', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1．答案：2 解析：因为 1+1=2\n2．答案：4');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[0].analysis).toBe('因为 1+1=2');
        expect(result.questions[1].answer).toBe('4');
        expect(result.ignored.join('\n')).not.toContain('1．答案：2');
    });

    it('匹配不上的条目仍列入 ignored', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1．2\n3．6');
        expect(result.questions[0].answer).toBe('2');
        expect(result.questions[1].answer).toBeUndefined();
        expect(result.ignored.join('\n')).toContain('3．6');
    });

    it('答案区没有按题号列条目时保持原有行为（整体列入 ignored）', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n第一题答案是 2，第二题答案是 4。');
        expect(result.questions[0].answer).toBeUndefined();
        expect(result.questions[1].answer).toBeUndefined();
        expect(result.ignored.join('\n')).toContain('第一题答案是 2');
    });

    it('一行多题（半角点分隔）拆成多个条目', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。\n参考答案\n1.B 2.C 3.A');
        expect(result.questions[0].answer).toBe('B');
        expect(result.questions[1].answer).toBe('C');
        expect(result.questions[2].answer).toBe('A');
    });

    it('一行多题（全角点、全角空格分隔）拆成多个条目', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1．B　2．C');
        expect(result.questions[0].answer).toBe('B');
        expect(result.questions[1].answer).toBe('C');
    });

    it('一行多题（顿号、分号分隔）拆成多个条目', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1、A；2、D');
        expect(result.questions[0].answer).toBe('A');
        expect(result.questions[1].answer).toBe('D');
    });

    it('一行多题但中间有题号未匹配时，未匹配部分留在 ignored', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1.B 3.C');
        expect(result.questions[0].answer).toBe('B');
        expect(result.questions[1].answer).toBeUndefined();
        expect(result.ignored.join('\n')).toContain('3.C');
    });

    it('区间写法：字母个数等于区间长度时逐题分配', () => {
        const text = '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。\n4．计算 4 + 4。\n5．计算 5 + 5。\n参考答案\n1～5 BCADB';
        const result = splitQuestionText(text);
        expect(result.questions.map((question) => question.answer)).toEqual(['B', 'C', 'A', 'D', 'B']);
    });

    it('区间写法：其他分隔符写法同样识别', () => {
        const text = '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。\n4．计算 4 + 4。\n5．计算 5 + 5。\n参考答案\n1-5：BCADB';
        const result = splitQuestionText(text);
        expect(result.questions.map((question) => question.answer)).toEqual(['B', 'C', 'A', 'D', 'B']);
    });

    it('区间写法：字母个数与区间长度不符时保留在 ignored', () => {
        const text = '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。\n4．计算 4 + 4。\n5．计算 5 + 5。\n参考答案\n1～5 BCAD';
        const result = splitQuestionText(text);
        expect(result.questions.every((question) => question.answer === undefined)).toBe(true);
        expect(result.ignored.join('\n')).toContain('1～5 BCAD');
    });

    it('答案本身是小数（1. 2.5）不误拆为多个条目', () => {
        const result = splitQuestionText('1．计算 1.5 + 0.5。\n参考答案\n1. 2.5');
        expect(result.questions[0].answer).toBe('2.5');
        expect(result.ignored.join('\n')).not.toContain('1. 2.5');
    });

    it('答案含逗号（1. x=1, 2x+3=5）不误拆为多个条目', () => {
        const result = splitQuestionText('1．解方程。\n参考答案\n1. x=1, 2x+3=5');
        expect(result.questions[0].answer).toBe('x=1, 2x+3=5');
    });

    it('较长的单题答案保持单条解析，不拆', () => {
        const longAnswer = '因为 1+1=2，且 2+2=4，两者相加得到 6，所以最终结果为 6。'.repeat(2);
        const result = splitQuestionText(`1．计算。\n2．计算。\n参考答案\n1. ${longAnswer}\n2. 4`);
        expect(result.questions[0].answer).toBe(longAnswer);
        expect(result.questions[1].answer).toBe('4');
    });
});

describe('composeQuestionInput 附加答案解析', () => {
    it('无结构化字段时输出与现在一致', () => {
        const result = composeQuestionInput({ text: '计算 1 + 1。', material: null });
        expect(result).toBe('计算 1 + 1。');
    });

    it('带答案、解析、错答时附加小节', () => {
        const result = composeQuestionInput({
            text: '计算 1 + 1。',
            material: null,
            answer: '2',
            analysis: '因为 1+1=2',
            wrongAnswer: '3',
        });
        expect(result).toContain('计算 1 + 1。');
        expect(result).toContain('参考答案：2');
        expect(result).toContain('参考解析：因为 1+1=2');
        expect(result).toContain('学生作答：3');
    });

    it('公共材料在前，结构化字段在后', () => {
        const result = composeQuestionInput({
            text: '计算 1 + 1。',
            material: '阅读材料',
            answer: '2',
        });
        expect(result).toMatch(/^阅读材料\n\n计算 1 \+ 1。\n\n参考答案：2$/);
    });
});
