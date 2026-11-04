// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startMockAI, DUMMY_KEY } from '../../../e2e/support/mock-ai.mjs';
import { OpenAIProvider } from '@/lib/ai/openai-provider';

vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ prompts: {} }) }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn() }) }));
let mock: Awaited<ReturnType<typeof startMockAI>>;
let provider: OpenAIProvider;
beforeAll(async () => {
    mock = await startMockAI();
    await fetch(`${mock.origin}/control/protocol`, { method: 'POST', body: '{}' });
    provider = new OpenAIProvider({ apiKey: DUMMY_KEY, baseUrl: `${mock.origin}/cases/protocol/v1`, model: 'e2e-mock-model' });
});
afterAll(async () => { await mock.close(); });

describe('本地模型服务与真实适配器的协议', () => {
    it('控制接口拒绝原型键及内部集合覆盖，保留既有场景', async () => {
        for (const body of ['{"__proto__":{"polluted":true}}', '{"calls":[]}', '{"hold":"false"}']) {
            const response = await fetch(`${mock.origin}/control/protocol`, { method: 'POST', body });
            expect(response.status).toBe(400);
        }
        expect(Object.getPrototypeOf(mock.cases.get('protocol'))).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
    it('图片分析通过真实 SDK 与 XML 解析器，并记录多模态请求', async () => {
        const result = await provider.analyzeImage('dGVzdA==', 'image/png', 'zh', 8, '数学', '初二上', { subjectName: '数学', tags: ['一元一次方程'] });
        expect(result).toMatchObject({ answerText: 'x = 3', subject: '数学', difficultyStars: 3, questionType: 'calculation', gradeSemester: '初二上' });
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'analysis', hasImage: true }));
    });
    it('带参考文字（题库文件文字层）的图片识别仍按 analysis 协议处理', async () => {
        const result = await provider.analyzeImage('dGVzdA==', 'image/png', 'zh', null, null, null, undefined, '从 PDF 提取的文字层，可能乱码');
        expect(result).toMatchObject({ answerText: 'x = 3', subject: '数学' });
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'analysis', hasImage: true }));
    });
    it('变式题及内嵌 SVG 按正式输出协议解析', async () => {
        const result = await provider.generateSimilarQuestion('求面积。E2E_protocol_A', [], 'zh', 'medium', '初二上');
        expect(result.questionText).toContain('E2E_protocol_A变式');
        expect(result.figureSvg).toContain('<svg');
    });
    it('模型判题使用 correct 字段且不产生未声明请求', async () => {
        expect(await provider.gradeAnswer({ questionText: '证明奇偶性', answerText: '按定义', userAnswer: '给出论证' })).toMatchObject({ correct: true });
        expect(mock.violations).toEqual([]);
    });
});

describe('本地模型服务的分题协议', () => {
    it('文字分题只返回行号范围，经真实适配器按原文拼回', async () => {
        const result = await provider.splitQuestions({ kind: 'text', lines: ['计算 3 + 4。', '', '小明有 5 个苹果，', '又买了 3 个，现在有几个？'], language: 'zh' });
        expect(result.questions.map((question) => question.text)).toEqual(['计算 3 + 4。', '小明有 5 个苹果，\n又买了 3 个，现在有几个？']);
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'split', hasImage: false }));
    });
    it('图片分题必须携带图片，返回题目与归一化区域', async () => {
        const result = await provider.splitQuestions({ kind: 'image', imageBase64: 'dGVzdA==', mimeType: 'image/jpeg', language: 'zh' });
        expect(result.questions).toHaveLength(3);
        expect(result.questions[0]).toMatchObject({ label: '1', hasFigure: true, regions: [{ x: 0.048, y: 0.197, width: 0.905, height: 0.35 }] });
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'split', hasImage: true }));
    });
    it('修正文字使用修正协议，按 id 返回整理后的文字', async () => {
        const result = await provider.fixQuestionText([{ id: 'q1', text: '两块地一共100公项。\n草稿：4x=120' }]);
        expect(result).toEqual([{ id: 'q1', text: '两块地一共100公顷。', uncertain: ['公项'] }]);
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'fix-text' }));
    });
    it('文字题解析使用解题协议，题干由应用保留', async () => {
        const result = await provider.reanswerQuestion('计算 3 + 4。', 'zh', '数学');
        expect(result.answerText).toContain('E2E 答案：计算 3 + 4');
        expect(mock.cases.get('protocol')?.calls).toContainEqual(expect.objectContaining({ operation: 'reanswer' }));
        expect(mock.violations).toEqual([]);
    });
});
