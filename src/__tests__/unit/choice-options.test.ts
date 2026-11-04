import { describe, expect, it } from 'vitest';
import { splitChoiceOptions } from '@/lib/print/choice-options';

describe('splitChoiceOptions', () => {
    it('短选项逐行排列时拆出并排成 4 列', () => {
        const layout = splitChoiceOptions('下列哪个数是质数？（ ）\nA. 4\nB. 6\nC. 7\nD. 9');
        expect(layout).toEqual({
            stem: '下列哪个数是质数？（ ）',
            options: [
                { label: 'A.', content: '4' },
                { label: 'B.', content: '6' },
                { label: 'C.', content: '7' },
                { label: 'D.', content: '9' },
            ],
            after: '',
            columns: 4,
        });
    });

    it('题干与 A 同行、选项间有空行、全角与括号标记都能识别', () => {
        const layout = splitChoiceOptions('计算结果是（ ） A．$\\frac{1}{2}$\n\nB．$\\frac{1}{3}$\n\nC．1\n\nD．2');
        expect(layout?.stem).toBe('计算结果是（ ）');
        expect(layout?.options.map((o) => o.content)).toEqual(['$\\frac{1}{2}$', '$\\frac{1}{3}$', '1', '2']);
        expect(layout?.columns).toBe(4);

        const bracket = splitChoiceOptions('Which is prime?\n(A) 4\n(B) 6\n(C) 7\n(D) 9');
        expect(bracket?.options.map((o) => o.label)).toEqual(['(A)', '(B)', '(C)', '(D)']);
    });

    it('每行两个选项时也能拆开', () => {
        const layout = splitChoiceOptions('选出正确的一项\nA. 甲  B. 乙\nC. 丙  D. 丁');
        expect(layout?.options.map((o) => `${o.label}${o.content}`)).toEqual(['A.甲', 'B.乙', 'C.丙', 'D.丁']);
    });

    it('按最长选项选择 2 列或 1 列，图片选项整行显示', () => {
        const medium = splitChoiceOptions('下列说法正确的是\nA. 质数都是奇数\nB. 1 是最小的质数\nC. 2 是偶数中唯一的质数\nD. 合数至少有三个因数');
        expect(medium?.columns).toBe(2);
        const long = splitChoiceOptions('下列说法正确的是\nA. 所有的质数都是奇数，所有的合数都是偶数，没有例外\nB. 2\nC. 3\nD. 4');
        expect(long?.columns).toBe(1);
        const image = splitChoiceOptions('选图\nA. ![a](/a.png)\nB. ![b](/b.png)\nC. ![c](/c.png)');
        expect(image?.columns).toBe(1);
    });

    it('选项之后的图示段落保留在后面', () => {
        const layout = splitChoiceOptions('如图，阴影面积是\nA. 1\nB. 2\nC. 3\nD. 4\n\n图示：正方形内有一个圆。');
        expect(layout?.after).toBe('图示：正方形内有一个圆。');
    });

    it('非选择题、选项已在同一行或无法可靠拆分时返回 null', () => {
        expect(splitChoiceOptions('求解方程 $x^2=4$。')).toBeNull();
        expect(splitChoiceOptions(null)).toBeNull();
        expect(splitChoiceOptions('下列正确的是\nA. 1  B. 2  C. 3  D. 4')).toBeNull();
        expect(splitChoiceOptions('已知 A、B、C 三点共线，求证：AB+BC=AC。')).toBeNull();
        // C 选项跨两行，后面的续行无法判断归属
        expect(splitChoiceOptions('下列正确的是\nA. 1\nB. 2\nC. 第一行\n第二行')).toBeNull();
    });
});
