import { describe, it, expect } from 'vitest';
import {
    AUTO_ANSWER_SPACE_PX,
    FIXED_ANSWER_SPACE_PX,
    SOLUTION_EXTRA_PER_PART_PX,
    SOLUTION_MAX_PX,
    countQuestionParts,
    detectQuestionKind,
    getAnswerSpacePx,
    isAnswerSpaceMode,
} from '@/lib/exam-answer-space';

describe('detectQuestionKind', () => {
    it('识别逐行或同行排列的选项为选择题', () => {
        expect(detectQuestionKind('下列哪个数是质数？\nA. 4\nB. 6\nC. 7\nD. 9')).toBe('choice');
        expect(detectQuestionKind('计算 $2+3$ 的值（ ）  A．4  B．5  C．6  D．7')).toBe('choice');
        expect(detectQuestionKind('Which is prime? (A) 4 (B) 6 (C) 7 (D) 9')).toBe('choice');
    });

    it('不把点名或地名当作选项', () => {
        expect(detectQuestionKind('已知 A、B、C 三点共线，求证：AB+BC=AC。')).toBe('solution');
        expect(detectQuestionKind('甲从 A 地出发前往 B 地，C 地在两地之间，求两人相遇时间。')).toBe('solution');
    });

    it('识别判断题', () => {
        expect(detectQuestionKind('判断下列说法是否正确：0 是自然数。')).toBe('judgment');
        expect(detectQuestionKind('True or False: every square is a rectangle.')).toBe('judgment');
    });

    it('识别下划线、空括号等填空标记', () => {
        expect(detectQuestionKind('$3 \\times 4 =$ ______。')).toBe('fill');
        expect(detectQuestionKind('一个三角形的内角和是（ ）度。')).toBe('fill');
        expect(detectQuestionKind('圆的周长公式是 \\_\\_\\_。')).toBe('fill');
        expect(detectQuestionKind('$x = \\underline{\\quad}$')).toBe('fill');
    });

    it('乘号和函数括号不影响判断，其余按解答题处理', () => {
        expect(detectQuestionKind('计算 $12 × 5$，并写出过程。')).toBe('solution');
        expect(detectQuestionKind('已知 $f(x)=x^2$，求 $f(3)$。')).toBe('solution');
    });
});

describe('countQuestionParts', () => {
    it('统计全角与行首半角小问编号', () => {
        expect(countQuestionParts('已知函数。（1）求最小值；（2）求单调区间；（3）证明不等式。')).toBe(3);
        expect(countQuestionParts('已知数列。\n(1) 求通项；\n(2) 求前 n 项和。')).toBe(2);
    });

    it('不把函数参数当作小问，没有小问时为 1', () => {
        expect(countQuestionParts('已知 f(1)=2，f(2)=5，求 f(3)。')).toBe(1);
    });
});

describe('getAnswerSpacePx', () => {
    it('固定模式所有题目使用同一高度', () => {
        expect(getAnswerSpacePx('none', 'A. 1\nB. 2\nC. 3')).toBe(0);
        expect(getAnswerSpacePx('small', '求解。')).toBe(FIXED_ANSWER_SPACE_PX.small);
        expect(getAnswerSpacePx('medium', '______')).toBe(120);
        expect(getAnswerSpacePx('large', '求解。')).toBe(FIXED_ANSWER_SPACE_PX.large);
    });

    it('自动模式按题型取高度，解答题随小问增加并有上限', () => {
        expect(getAnswerSpacePx('auto', '结果是 ______。')).toBe(AUTO_ANSWER_SPACE_PX.fill);
        expect(getAnswerSpacePx('auto', '求解方程 $x^2=4$。')).toBe(AUTO_ANSWER_SPACE_PX.solution);
        expect(getAnswerSpacePx('auto', '（1）求 a；（2）求 b。'))
            .toBe(AUTO_ANSWER_SPACE_PX.solution + SOLUTION_EXTRA_PER_PART_PX);
        expect(getAnswerSpacePx('auto', '（1）（2）（3）（4）（5）（6）（7）')).toBe(SOLUTION_MAX_PX);
        expect(AUTO_ANSWER_SPACE_PX.fill).toBeLessThan(AUTO_ANSWER_SPACE_PX.solution);
    });
});

describe('isAnswerSpaceMode', () => {
    it('只接受已定义的模式', () => {
        expect(isAnswerSpaceMode('auto')).toBe(true);
        expect(isAnswerSpaceMode('large')).toBe(true);
        expect(isAnswerSpaceMode('huge')).toBe(false);
        expect(isAnswerSpaceMode(null)).toBe(false);
    });
});
