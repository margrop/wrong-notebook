import { describe, expect, it } from 'vitest';
import { resolveTeachingRule } from '@/lib/ai/teaching-rules/router';
import { generateReanswerRequest } from '@/lib/ai/prompt-requests';

describe('题型讲解规则路由', () => {
    it.each([
        ['数学', 'calculation', 'math.calculation.v1'],
        ['数学', 'solution', 'math.solution.v1'],
        ['英语', 'reading', 'english.reading.v1'],
    ])('%s/%s 命中专属规则', (subject, questionType, ruleId) => {
        const result = resolveTeachingRule({ subject, questionType });
        expect(result).toMatchObject({ ruleId, matched: true, confidence: 'high' });
        expect(result.instructions).not.toBe('');
    });

    it('接受中文题型别名并在未知组合时使用通用兜底', () => {
        expect(resolveTeachingRule({ subject: '数学', questionType: '计算题' }).ruleId).toBe('math.calculation.v1');
        expect(resolveTeachingRule({ subject: '物理', questionType: '解答题' })).toMatchObject({
            ruleId: 'generic.v1',
            matched: false,
            confidence: 'fallback',
        });
    });

    it('按语言选择专属规则文本', () => {
        const result = resolveTeachingRule({ subject: '英语', questionType: 'reading' }, 'en');
        expect(result.instructions).toContain('main idea');
        expect(result.instructions).not.toContain('先判断题目');
    });
});

describe('题型专属提示词组装', () => {
    it('只注入当前规则，不注入其他试点题型', () => {
        const rule = resolveTeachingRule({ subject: '数学', questionType: 'calculation' });
        const request = generateReanswerRequest('zh', '求 1+1', '数学', {}, '三年级上', rule);

        expect(request.system).toContain('math.calculation.v1');
        expect(request.system).toContain('单位、正负号、数量级');
        expect(request.system).not.toContain('原文证据所在的句子或段落');
    });

    it('未知组合不添加专属规则但保留统一输出协议', () => {
        const rule = resolveTeachingRule({ subject: '物理', questionType: 'solution' });
        const request = generateReanswerRequest('zh', '题目', '物理', {}, null, rule);

        expect(request.system).not.toContain('当前题型专属讲解规范');
        expect(request.system).toContain('<answer_text>');
        expect(request.system).toContain('<analysis>');
    });
});
