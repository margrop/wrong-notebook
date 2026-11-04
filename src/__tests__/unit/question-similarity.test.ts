import { describe, expect, it } from 'vitest';
import { calculateQuestionSimilarity, duplicateQuestionSimilarity, normalizeQuestionText } from '@/lib/question/question-similarity';

describe('完整题干相似度', () => {
    it('规范化全角字符、换行和连续空白', () => {
        expect(duplicateQuestionSimilarity('  求解\nｘ ＋ ２ ＝ ５  ', '求解 x + 2 = 5')).toBe(1);
        expect(normalizeQuestionText('e\u0301')).toBe('é');
    });

    it('不合并空题干，也不丢失大小写、运算符、上下标或英文词间空格', () => {
        for (const [left, right] of [['', ''], [' \n', ' '], ['x²', 'x2'], ['CO₂', 'CO2'], ['A', 'a'], ['x < 1', 'x > 1'], ['now here', 'nowhere']]) {
            expect(duplicateQuestionSimilarity(left, right)).toBeNull();
        }
    });

    it('默认阈值为 90%，严格区分等于和大于', () => {
        expect(duplicateQuestionSimilarity('甲'.repeat(100), '甲'.repeat(90) + '乙'.repeat(10))).toBeNull();
        expect(duplicateQuestionSimilarity('甲'.repeat(100), '甲'.repeat(91) + '乙'.repeat(9))).toBeCloseTo(0.91);
    });

    it('严格区分等于 99% 和大于 99%', () => {
        expect(duplicateQuestionSimilarity('甲'.repeat(100), '甲'.repeat(99) + '乙', 99)).toBeNull();
        expect(duplicateQuestionSimilarity('甲'.repeat(101), '甲'.repeat(100) + '乙', 99)).toBeCloseTo(100 / 101);
        expect(duplicateQuestionSimilarity('甲'.repeat(200), '甲'.repeat(198) + '乙乙', 99)).toBeNull();
        expect(duplicateQuestionSimilarity('甲'.repeat(201), '甲'.repeat(199) + '乙乙', 99)).toBeCloseTo(199 / 201);
    });

    it('忽略 AI 附加的图示描述段落，但保留以「图示」开头的题干本身', () => {
        const stem = '（5分）现在两人从相距 $100$ 米的两地同时出发，如图所示，同向而行，大宽追上艾迪两次需要 ____ 分钟。';
        const left = stem + '\n\n图示：环形跑道上，大宽位于左上方，艾迪位于右上方，两人之间的上方弧段长 $100$ 米。';
        const right = stem + '\n\n图示信息：大宽和艾迪沿环形跑道同向跑动，大宽在后方。';
        expect(calculateQuestionSimilarity(left, right)).toBe(1);
        expect(calculateQuestionSimilarity(stem + '\n【图示说明】一个六边形', stem)).toBe(1);
        // 图示段落之后的正文仍参与比较
        expect(calculateQuestionSimilarity(stem + '\n\n图示：甲\n\n(1) 求速度', stem + '\n\n(1) 求速度')).toBe(1);
        expect(calculateQuestionSimilarity(stem + '\n\n图示：甲\n\n(1) 求速度', stem + '\n\n(1) 求时间')).toBeLessThan(1);
        expect(normalizeQuestionText('图示为一个 5 行 6 列的方格图，求长方形个数。')).toContain('图示为一个 5 行 6 列的方格图');
    });

    it('不同长度的填空横线和空括号视为相同', () => {
        expect(calculateQuestionSimilarity('需要 ______ 分钟', '需要 ____ 分钟')).toBe(1);
        expect(calculateQuestionSimilarity('需要 $\\underline{\\quad}$ 分钟', '需要 $__$ 分钟')).toBe(1);
        expect(calculateQuestionSimilarity('答案是（　　）', '答案是( )')).toBe(1);
    });

    it('支持自定义阈值及小数阈值，相等时不判重，100% 时不自动判重', () => {
        expect(duplicateQuestionSimilarity('甲'.repeat(100), '甲'.repeat(96) + '乙'.repeat(4), 95)).toBe(0.96);
        expect(duplicateQuestionSimilarity('甲'.repeat(100), '甲'.repeat(95) + '乙'.repeat(5), 95)).toBeNull();
        expect(duplicateQuestionSimilarity('甲'.repeat(1000), '甲'.repeat(996) + '乙'.repeat(4), 99.6)).toBeNull();
        expect(duplicateQuestionSimilarity('同题', '同题', 100)).toBeNull();
    });

    it('手动对比返回低相似度的完整分数', () => {
        expect(calculateQuestionSimilarity('甲乙丙丁', '甲乙戊己')).toBe(0.5);
        expect(calculateQuestionSimilarity('完全不同', '甲乙丙丁')).toBe(0);
        expect(calculateQuestionSimilarity('', '题目')).toBeNull();
        expect(calculateQuestionSimilarity('ｘ = １', 'x = 1')).toBe(1);
    });

    it('比较完整题目，前 100 字相同但后半段不同也应正常导入', () => {
        const prefix = '相同题干'.repeat(25);
        expect(duplicateQuestionSimilarity(prefix + '选项甲'.repeat(40), prefix + '选项乙'.repeat(40))).toBeNull();
    });

    it('支持插入、删除和替换，比较顺序不影响结果', () => {
        const text = '这是完整题目的已知条件。'.repeat(30);
        for (const changed of [text.slice(1), text + '。', text.slice(0, 150) + '新' + text.slice(151)]) {
            expect(duplicateQuestionSimilarity(text, changed)).toBeGreaterThan(0.99);
            expect(duplicateQuestionSimilarity(changed, text)).toBe(duplicateQuestionSimilarity(text, changed));
        }
    });

    it('按 Unicode 字符计算距离，避免表情等字符的代理对影响阈值', () => {
        expect(duplicateQuestionSimilarity('😀'.repeat(100), '😀'.repeat(99) + '😁', 99)).toBeNull();
    });

    it('带状算法与完整编辑距离在不同长度和差异位置上保持一致', () => {
        const distance = (a: string, b: string) => {
            let row = Array.from({ length: b.length + 1 }, (_, index) => index);
            for (let i = 1; i <= a.length; i++) {
                const next = [i];
                for (let j = 1; j <= b.length; j++) {
                    next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                }
                row = next;
            }
            return row[b.length];
        };
        for (const length of [99, 100, 101, 200, 201, 350]) {
            const text = '甲乙丙丁'.repeat(Math.ceil(length / 4)).slice(0, length);
            for (const position of [0, Math.floor(length / 2), length - 1]) {
                for (const changed of [text.slice(0, position) + text.slice(position + 1), text.slice(0, position) + '新字' + text.slice(position + 1)]) {
                    const edits = distance(text, changed);
                    const maximum = Math.max(text.length, changed.length);
                    // 默认阈值 90%：相似度严格大于 90% 才返回分数
                    const expected = edits * 10 < maximum ? 1 - edits / maximum : null;
                    expect(duplicateQuestionSimilarity(text, changed)).toBe(expected);
                    expect(calculateQuestionSimilarity(text, changed)).toBe(1 - edits / maximum);
                    for (const threshold of [1, 50, 90, 95, 99, 99.5, 99.99, 100]) {
                        const shouldMatch = edits * 10000 < maximum * (10000 - Math.round(threshold * 100));
                        expect(duplicateQuestionSimilarity(text, changed, threshold)).toBe(shouldMatch ? 1 - edits / maximum : null);
                    }
                }
            }
        }
    });
});
