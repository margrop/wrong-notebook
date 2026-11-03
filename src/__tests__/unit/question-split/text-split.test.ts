import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeQuestionInput, matchQuestionNumber, splitQuestionText, stripQuestionNumber } from '@/lib/question-split/text';

const issue6 = readFileSync(join(__dirname, '../../fixtures/issue-6-nine-questions.txt'), 'utf8');

describe('本地文字分题', () => {
    it('issue #6 样例准确分成 9 道，选项与小问留在原题，标题与姓名栏不成题', () => {
        const result = splitQuestionText(issue6);
        expect(result.detected).toBe(true);
        expect(result.questions).toHaveLength(9);
        expect(result.questions.map((question) => question.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
        const [q1, q2, q3, q4, q5, q6, q7, q8, q9] = result.questions;
        expect(q1.text).toBe('有两根绳子，第一根绳子长 24 米，用去它的 1/4，还剩（　　）米；再用去 1/4 米，还剩（　　）米。第二根绳子比第一根绳子多 1/3，第二根绳子长是（　　）米。');
        expect(q2.text).toContain('7:5');
        expect(q3.text).toContain('1/a ÷ 3/8 ＝ 1/b × 2/5 ＝ 1/c');
        expect(q4.text.split('\n')).toEqual([
            '某市出租车的计费标准如下（不足 1km 按 1km 计算）：3km 以内，12 元；3km 至 10km 的部分，每千米 2 元；10km 以上的部分，每千米 3 元。李叔叔打车去上班，支付了 32 元，行程的里程可能是（　　）km。',
            'A．8.4　　　B．10.6　　　C．11.8　　　D．13.5',
        ]);
        expect(q5.text).toMatch(/A．第一根长[\s\S]*D．无法确定$/);
        expect(q6.text).toContain('7/10 吨');
        expect(q7.text).toContain('12 天');
        expect(q8.text).toContain('3.5 元');
        expect(q9.text.split('\n')).toEqual(['二进制探究。', '（1）二进制数 10101 写成十进制数是（　　）。', '（2）把十进制数 26 写成二进制数是（　　）。']);
        for (const question of result.questions) {
            expect(question.material).toBeNull();
            expect(question.text).not.toMatch(/姓名|错题类似题练习|\n\n/);
        }
        expect(result.ignored.join('\n')).toContain('姓名');
        expect(result.ignored.join('\n')).toContain('错题类似题练习');
    });

    it('一道题带多个小问时不拆开', () => {
        const result = splitQuestionText('已知函数 f(x) = x^2 - 2x。\n(1) 求 f(x) 的最小值；\n(2) 解不等式 f(x) > 3。');
        expect(result.detected).toBe(false);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toContain('(2) 解不等式');
    });

    it('题号写法不同的小问（1) 2)）不当作顶层题', () => {
        const result = splitQuestionText('1. 计算下列各题。\n1) 3 + 4\n2) 5 + 6\n2. 解方程 x + 1 = 2');
        expect(result.questions.map((question) => question.text)).toEqual(['计算下列各题。\n1) 3 + 4\n2) 5 + 6', '解方程 x + 1 = 2']);
    });

    it('未编号的多题不猜测拆分', () => {
        const result = splitQuestionText('计算 3 + 4。\n\n计算 5 × 6。');
        expect(result.detected).toBe(false);
        expect(result.questions).toHaveLength(1);
    });

    it('英文题与公式原样保留', () => {
        const result = splitQuestionText('1. Solve $x^2 - 5x + 6 = 0$.\nA. 1 B. 2 C. 3\n2. What is $\\frac{3}{4}$ of 12?');
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].text).toBe('Solve $x^2 - 5x + 6 = 0$.\nA. 1 B. 2 C. 3');
        expect(result.questions[1].text).toBe('What is $\\frac{3}{4}$ of 12?');
    });

    it('阅读材料作为公共材料随题保留，大题标题只作分组', () => {
        const text = [
            '一、阅读理解（每题 5 分）',
            '阅读下面的短文，完成 1～2 题。',
            '小明每天早上六点起床，先跑步二十分钟，再读半小时书。他说坚持比聪明更重要。',
            '1．小明每天早上做什么运动？',
            '2．小明认为什么更重要？',
            '二、计算题',
            '3．计算 12 × 5。',
        ].join('\n');
        const result = splitQuestionText(text);
        expect(result.questions).toHaveLength(3);
        expect(result.questions[0].material).toContain('小明每天早上六点起床');
        expect(result.questions[1].material).toContain('小明每天早上六点起床');
        expect(result.questions[2].material).toBeNull();
        expect(result.questions[0].section).toBe('一、阅读理解（每题 5 分）');
        expect(result.questions[2].section).toBe('二、计算题');
        expect(composeQuestionInput(result.questions[0])).toMatch(/^阅读下面的短文[\s\S]*\n\n小明每天早上做什么运动？$/);
    });

    it('题组之间的材料只作用于其后的题', () => {
        const text = '1．计算 1 + 1。\n2．计算 2 + 2。\n\n阅读下面的材料，回答 3～4 题。\n某商店上午卖出 30 件，下午卖出 45 件。\n3．全天卖出多少件？\n4．下午比上午多卖多少件？\n5．计算 9 - 3。';
        const result = splitQuestionText(text);
        expect(result.questions).toHaveLength(5);
        expect(result.questions[1].text).toBe('计算 2 + 2。');
        expect(result.questions[1].material).toBeNull();
        expect(result.questions[2].material).toContain('某商店上午卖出 30 件');
        expect(result.questions[3].material).toContain('某商店');
        expect(result.questions[4].material).toBeNull();
    });

    it('只有汉字序号时按汉字序号分题，小数不当题号', () => {
        const result = splitQuestionText('一、一根绳子长 1.5 米，剪去 0.3 米，还剩多少米？\n二、计算 2.5 × 4。');
        expect(result.questions.map((question) => question.text)).toEqual(['一、一根绳子长 1.5 米，剪去 0.3 米，还剩多少米？', '二、计算 2.5 × 4。']);
    });

    it('答案页之后的内容不参与分题', () => {
        const result = splitQuestionText('1．计算 1 + 1。\n2．计算 2 + 2。\n参考答案\n1．2\n2．4');
        expect(result.questions).toHaveLength(2);
        expect(result.ignored.join('\n')).toContain('1．2');
    });

    it('题号识别与去除', () => {
        expect(matchQuestionNumber('12．计算')?.value).toBe(12);
        expect(matchQuestionNumber('第3题 计算')?.value).toBe(3);
        expect(matchQuestionNumber('Question 4: what')?.value).toBe(4);
        expect(matchQuestionNumber('1.5 米')).toBeNull();
        expect(matchQuestionNumber('十二、计算')?.value).toBe(12);
        expect(stripQuestionNumber('3．计算\n（1）小问')).toBe('计算\n（1）小问');
    });

    it('公共题干后的 1) 2) 编号按一道题的小问处理，用户可明确选择仍按编号分题', () => {
        const text = '已知两数的和是 20，差是 4，完成下面的小问：\n1) 求较大的数。\n2) 求较小的数。';
        const result = splitQuestionText(text);
        expect(result).toMatchObject({ detected: false, ambiguous: true, candidateCount: 2 });
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe(text);
        const forced = splitQuestionText(text, { forceNumbered: true });
        expect(forced.questions.map((question) => question.text)).toEqual(['求较大的数。', '求较小的数。']);
        // 短标题不算题干，括号编号的题仍正常分题
        expect(splitQuestionText('练习\n1) 计算 1 + 1\n2) 计算 2 + 2')).toMatchObject({ detected: true, candidateCount: 2 });
    });

    it('「回答下列问题：」后的编号不自动拆开；写明「完成 1～2 题」的材料仍按独立题分', () => {
        expect(splitQuestionText('小明家养了 3 只鸡和 5 只鸭。根据信息回答下列问题：\n1．鸡和鸭一共几只？\n2．鸭比鸡多几只？')).toMatchObject({ detected: false, ambiguous: true });
        expect(splitQuestionText('阅读下面的短文，完成 1～2 题。\n1．小明早上怎样去学校？\n2．小明下午怎样回家？')).toMatchObject({ detected: true, ambiguous: false });
    });

    it('题数超过上限时不静默丢弃：多出的题列入未计入内容并给出数量', () => {
        const text = Array.from({ length: 61 }, (_, index) => `${index + 1}．计算 ${index} + 1。`).join('\n');
        const result = splitQuestionText(text);
        expect(result.questions).toHaveLength(60);
        expect(result.candidateCount).toBe(61);
        expect(result.overflow).toBe(1);
        expect(result.ignored).toEqual(['计算 60 + 1。']);
    });

    it('文字超过长度上限时标记，不当作完整结果', () => {
        expect(splitQuestionText('1．a\n2．b\n' + '字'.repeat(20000)).tooLong).toBe(true);
        expect(splitQuestionText('1．a\n2．b').tooLong).toBe(false);
    });
});

