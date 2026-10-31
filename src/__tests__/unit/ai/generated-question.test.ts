import { describe, expect, it } from 'vitest';
import { normalizeGeneratedQuestion } from '@/lib/ai/generated-question';
import { GENERATED_QUESTION_RULES, generateSimilarQuestionPrompt } from '@/lib/ai/prompts';
import type { ParsedQuestion } from '@/lib/ai/types';

const question = (questionText: string): ParsedQuestion => ({
    questionText, answerText: '4', analysis: '计算得到 4', subject: '数学', knowledgePoints: [],
    wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', requiresImage: false,
});

describe('生成填空题或解答题', () => {
    it('默认模板和自定义模板都强制使用统一题型规则', () => {
        for (const customTemplate of [undefined, '请沿用原题题型：{{original_question}}']) {
            const prompt = generateSimilarQuestionPrompt('zh', '选择正确答案 A. 2 B. 4', [], 'hard', { customTemplate });
            expect(prompt).toContain(GENERATED_QUESTION_RULES);
            expect(prompt).toContain('只能生成填空题或解答题');
            expect(prompt).not.toContain('包含选项（如果是选择题）');
            expect(prompt.endsWith(GENERATED_QUESTION_RULES)).toBe(true);
        }
    });

    it.each(['第 3 题（5 分）求 2 + 2 的值。', '3. 求 2 + 2 的值。（5分）', 'Question 3: [5 marks] 求 2 + 2 的值。'])('去掉生成题目中的题号和分值：%s', (text) => {
        const result = normalizeGeneratedQuestion(question(text));
        expect(result.questionText).toBe('求 2 + 2 的值。');
        expect(result.answerText).toBe('4');
    });

    it.each(['求和。\nA. 2\nB. 4\nC. 6\nD. 8', '下列正确的是 A. 2 B. 4', '请选择：\n（A）2\n（B）4'])('拒绝带选项的输出，避免直接删除选项造成题目缺条件', (text) => {
        expect(() => normalizeGeneratedQuestion(question(text))).toThrow('AI_RESPONSE_ERROR');
    });

    it.each(['1.5 千克糖分成 3 份，每份多少千克？', '三角形 ABC 中，A、B、C 为顶点，求角 A 的度数。', '求点 A. 的坐标。'])('保留题目的小数和几何字母：%s', (text) => {
        expect(normalizeGeneratedQuestion(question(text)).questionText).toBe(text);
    });

    it.each([
        '某比赛统计如下。已知：① 冠军集到 15 张；② 平均每人 7 张；③ 平均每人 5 张。求总人数。',
        '根据条件①和条件②求面积。',
        '已知①面积为 12；②周长为 16。求边长。',
        '① 第一项为 3；② 第二项为 5；③ 公差为 2。求前 10 项和。',
    ])('保留圈码作为条件编号的题目（不视为选择题选项）：%s', (text) => {
        expect(normalizeGeneratedQuestion(question(text)).questionText).toBe(text);
    });

    it.each([
        '下列正确的是 ① 12 ② 15 ③ 18 ④ 20',
        '请选择：\n① 2\n② 4\n③ 6\n④ 8',
        '答案为 ① A ② B ③ C ④ D',
        '① 3cm ② 5cm ③ 7cm ④ 9cm',
        '① 春天 ② 夏天 ③ 秋天 ④ 冬天',
        '① apple ② banana ③ orange ④ grape',
        '① 唐朝 ② 宋朝 ③ 元朝 ④ 明朝',
    ])('拒绝圈码作为候选选项的题目（跨科目）：%s', (text) => {
        expect(() => normalizeGeneratedQuestion(question(text))).toThrow('AI_RESPONSE_ERROR');
    });

    it.each([
        '下列正确的是 ① 12 ② 15 ③ 18',
        '请选择 ① 2 ② 4 ③ 6',
        '以下说法正确的是 ① 甲 ② 乙 ③ 丙',
    ])('拒绝带引导词且圈码作为候选选项的题目（无标点分隔）：%s', (text) => {
        expect(() => normalizeGeneratedQuestion(question(text))).toThrow('AI_RESPONSE_ERROR');
    });

    it.each([
        '已知 ① 甲数为 12，乙数为 8；② 甲比乙多 4。求两数之和。',
        '① 第一天走 30 千米；② 第二天走 45 千米；③ 全程 100 千米。求剩余路程。',
    ])('保留圈码编号但后跟中文描述的题目：%s', (text) => {
        expect(normalizeGeneratedQuestion(question(text)).questionText).toBe(text);
    });

    it.each([
        '已知 ① 甲数为 12 ② 乙数为 8 ③ 丙数为 5 求三数之和。',
        '① 第一天走 30 千米 ② 第二天走 45 千米 ③ 全程 100 千米 求剩余路程',
    ])('保留圈码编号但漏标点的题目（不应误判为选项）：%s', (text) => {
        expect(normalizeGeneratedQuestion(question(text)).questionText).toBe(text);
    });
});
