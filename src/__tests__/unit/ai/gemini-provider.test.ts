/**
 * Gemini Provider 单元测试
 *
 * 测试 Gemini 服务响应解析和错因同步
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

// Mock Google GenAI SDK
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class MockGoogleGenAI {
            models = {
                generateContent: mockGenerateContent,
            };
        },
    };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

// Mock config
vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({
        aiProvider: 'gemini',
        gemini: {
            apiKey: 'test-key',
            model: 'gemini-2.0-flash',
        },
    })),
}));

// Mock tag service
vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

// Delayed import to ensure mocks are applied
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import type { ParsedQuestion } from '@/lib/ai/types';

type PrivateGeminiProvider = {
    parseResponse(text: string): ParsedQuestion;
    extractTag(text: string, tagName: string): string | null;
    handleError(error: unknown): never;
};

function asPrivateProvider(provider: GeminiProvider): PrivateGeminiProvider {
    return provider as unknown as PrivateGeminiProvider;
}

describe('Gemini Provider 响应解析', () => {
    it('举一反三清理题号和分值，拒绝返回选择题', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });
        const response = (question: string) => ({ text: `<question_text>${question}</question_text><answer_text>4</answer_text><analysis>计算</analysis><subject>数学</subject>` });
        mockGenerateContent.mockResolvedValue(response('1. （5分）求 2+2 的值。'));
        expect((await provider.generateSimilarQuestion('原题', [])).questionText).toBe('求 2+2 的值。');
        expect(mockGenerateContent.mock.calls[0][0].contents).toContain('只能生成填空题或解答题');
        mockGenerateContent.mockResolvedValue(response('求和。\nA. 2\nB. 4'));
        await expect(provider.generateSimilarQuestion('原题', [])).rejects.toThrow('AI_RESPONSE_ERROR');
    });
    let provider: GeminiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GeminiProvider({
            apiKey: 'test-key',
            model: 'gemini-2.0-flash',
        });
    });

    describe('parseResponse', () => {
        it('应该正确解析包含所有必需标签的响应', () => {
            const mockResponse = `
<question_text>求函数 f(x) = x^2 的最小值</question_text>
<answer_text>最小值为 0</answer_text>
<analysis>这是一个二次函数,开口向上,顶点在原点,因此最小值为 0</analysis>
<subject>数学</subject>
<knowledge_points>二次函数, 函数最值</knowledge_points>
<requires_image>true</requires_image>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.questionText).toBe('求函数 f(x) = x^2 的最小值');
            expect(result.answerText).toBe('最小值为 0');
            expect(result.analysis).toContain('二次函数');
            expect(result.subject).toBe('数学');
            expect(result.knowledgePoints).toContain('二次函数');
            expect(result.knowledgePoints).toContain('函数最值');
            expect(result.requiresImage).toBe(true);
        });

        it('应该解析错因分析相关可选标签', () => {
            const mockResponse = `
<question_text>求 2x + 3 = 7</question_text>
<answer_text>x = 2</answer_text>
<analysis>移项后计算。</analysis>
<wrong_answer_text>x = 4</wrong_answer_text>
<mistake_status>wrong_attempt</mistake_status>
<mistake_analysis>移项后没有正确处理常数项。</mistake_analysis>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.wrongAnswerText).toBe('x = 4');
            expect(result.mistakeStatus).toBe('wrong_attempt');
            expect(result.mistakeAnalysis).toContain('常数项');
        });

        it('缺少错因标签时应该兼容旧响应并标记为未判断', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.wrongAnswerText).toBe('');
            expect(result.mistakeAnalysis).toBe('');
            expect(result.mistakeStatus).toBe('unknown');
        });

        it('有 wrongAnswerText 时应该强制返回 wrong_attempt 状态', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
<wrong_answer_text>错误解答</wrong_answer_text>
<mistake_status>unknown</mistake_status>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.wrongAnswerText).toBe('错误解答');
            expect(result.mistakeStatus).toBe('wrong_attempt');
        });

        it('缺少必需标签时应该抛出错误', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
            `.trim();

            expect(() => asPrivateProvider(provider).parseResponse(mockResponse)).toThrow('Missing critical XML tags');
        });
    });
});

describe('Gemini Provider 重新解题错因同步', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GeminiProvider({
            apiKey: 'test-key',
            model: 'gemini-2.0-flash',
        });
    });

    it('重新解题应该返回新的错因字段，供前端覆盖旧错因', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: `
<answer_text>x = 2</answer_text>
<analysis>两边同时减 3，再除以 2。</analysis>
<knowledge_points>一元一次方程</knowledge_points>
<wrong_answer_text>x = 4</wrong_answer_text>
<mistake_status>wrong_attempt</mistake_status>
<mistake_analysis>把 7 - 3 算错了。</mistake_analysis>
            `.trim(),
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh', '数学');

        expect(result.answerText).toBe('x = 2');
        expect(result.knowledgePoints).toEqual(['一元一次方程']);
        expect(result.wrongAnswerText).toBe('x = 4');
        expect(result.mistakeStatus).toBe('wrong_attempt');
        expect(result.mistakeAnalysis).toContain('算错');
    });

    it('重新解题缺少错因标签时应该返回默认值', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: `
<answer_text>x = 2</answer_text>
<analysis>移项计算。</analysis>
<knowledge_points>一元一次方程</knowledge_points>
            `.trim(),
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh', '数学');

        expect(result.answerText).toBe('x = 2');
        expect(result.wrongAnswerText).toBe('');
        expect(result.mistakeAnalysis).toBe('');
        expect(result.mistakeStatus).toBe('unknown');
    });
});

describe('Gemini Provider 错误处理', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GeminiProvider({
            apiKey: 'test-key',
            model: 'gemini-2.0-flash',
        });
    });

    describe('handleError', () => {
        it('应该将网络错误转换为 AI_CONNECTION_FAILED', () => {
            const networkError = new Error('fetch failed');
            expect(() => asPrivateProvider(provider).handleError(networkError)).toThrow('AI_CONNECTION_FAILED');
        });

        it('应该将认证错误转换为 AI_AUTH_ERROR', () => {
            const authError = new Error('Unauthorized: Invalid API key');
            expect(() => asPrivateProvider(provider).handleError(authError)).toThrow('AI_AUTH_ERROR');
        });

        it('未知错误应该转换为 AI_UNKNOWN_ERROR', () => {
            const unknownError = new Error('Something went wrong');
            expect(() => asPrivateProvider(provider).handleError(unknownError)).toThrow('AI_UNKNOWN_ERROR');
        });
    });
});

describe('Gemini Provider 掌握概率评估与学科判断', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' });
    });

    it('应该解析掌握概率评估结果', async () => {
        mockGenerateContent.mockResolvedValueOnce({ text: '{"probability": 35, "reason": "最近一次不会做"}' });

        const result = await provider.evaluateMastery({
            questionText: '题目',
            knowledgePoints: [],
            history: [{ date: '2026-10-01T00:00:00.000Z', difficulty: 'hard', result: 'not_attempted', source: 'exam' }],
            ruleProbability: 0.2,
        });

        expect(result).toEqual({ probability: 0.35, reason: '最近一次不会做' });
    });

    it('学科不在列表内时应该返回 undefined', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            text: '<answer_text>A</answer_text><analysis>略</analysis><knowledge_points>x</knowledge_points><subject>天文</subject>',
        });

        const result = await provider.reanswerQuestion('题目', 'zh');

        expect(result.subject).toBeUndefined();
    });
});

describe('Gemini Provider 知识点重新标注', () => {
    it('返回清单内的知识点', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' });
        mockGenerateContent.mockResolvedValueOnce({ text: '```json\n{"tags": ["鸡兔同笼"]}\n```' });

        const tags = await provider.suggestKnowledgeTags({ questionText: '题目', subject: '数学', allowedTags: ['鸡兔同笼'] });

        expect(tags).toEqual({ tags: ['鸡兔同笼'], difficultyStars: null });
    });
});

describe('Gemini Provider SVG 动画讲解', () => {
    const animation = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><circle r="5" opacity="0"><set attributeName="opacity" to="1" begin="2s" fill="freeze"/></circle><script>alert(1)</script></svg>';

    it('解析并净化动画，没有标签时从正文中取 SVG', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });
        mockGenerateContent.mockResolvedValue({ text: `<svg_animation>${animation}</svg_animation>` });
        const svg = await provider.generateSvgAnimation('求面积', '6', '解析');
        expect(JSON.stringify(mockGenerateContent.mock.calls.at(-1)?.[0].contents)).toContain('求面积');
        expect(svg).toContain('<set attributeName="opacity"');
        expect(svg).not.toContain('<script');

        mockGenerateContent.mockResolvedValue({ text: '动画如下：' + animation });
        expect(await provider.generateSvgAnimation('求面积', '6', '解析')).toContain('<circle');
    });
});

const narrationSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><metadata id="narration">[{"begin":0,"text":"旧的"}]</metadata><text y="480">第一步<set attributeName="opacity" to="1" begin="3s"/></text></svg>';
const narrationReply = '<narration>[{"begin":3,"text":"第二步"},{"begin":0,"text":"第一步"}]</narration>';
const expectedNarration = [{ begin: 0, text: '第一步' }, { begin: 3, text: '第二步' }];

describe('Gemini Provider 补写语音讲解稿', () => {
    it('提示词包含动画，解析讲解稿，没有标签时从正文中取 JSON', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });
        mockGenerateContent.mockResolvedValue({ text: narrationReply });
        expect(await provider.generateSvgNarration('求面积', '6', '解析', narrationSvg)).toEqual(expectedNarration);
        expect(JSON.stringify(mockGenerateContent.mock.calls.at(-1)?.[0].contents)).toContain('求面积');

        mockGenerateContent.mockResolvedValue({ text: '讲解稿：[{"begin":0,"text":"第一步"}]' });
        expect(await provider.generateSvgNarration('求面积', '6', '解析', narrationSvg)).toEqual([{ begin: 0, text: '第一步' }]);
    });
});

describe('Gemini Provider 修复 LaTeX', () => {
    const latexInput = { answerText: { text: '$\\frac{1}{2$', issues: ['Expected }'] } };

    it('解析修复结果', async () => {
        mockGenerateContent.mockResolvedValue({ text: '<answer_text>$\\frac{1}{2}$</answer_text>' });
        const provider = new GeminiProvider({ apiKey: 'test-key' });

        expect(await provider.fixLatex(latexInput)).toEqual({ answerText: '$\\frac{1}{2}$' });
    });
});

describe('Gemini Provider 判题', () => {
    it('解析代码块中的判定结果', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' });
        mockGenerateContent.mockResolvedValueOnce({ text: '```json\n{"correct": "true", "reason": "等价表达式"}\n```' });

        const result = await provider.gradeAnswer({ questionText: '化简 2(x+1)', answerText: '2x + 2', userAnswer: '2+2x', language: 'zh' });

        expect(result).toEqual({ correct: true, reason: '等价表达式' });
    });
});
