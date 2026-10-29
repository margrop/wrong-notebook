/**
 * OpenAI Provider 单元测试
 *
 * 测试 OpenAI 服务初始化、响应解析和错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCompletionCreate = vi.hoisted(() => vi.fn());

// Mock OpenAI SDK
vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCompletionCreate,
                },
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
        aiProvider: 'openai',
        openai: {
            apiKey: 'test-key',
            model: 'gpt-4o',
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
import { OpenAIProvider } from '@/lib/ai/openai-provider';
import type { ParsedQuestion } from '@/lib/ai/types';

type PrivateOpenAIProvider = {
    parseResponse(text: string): ParsedQuestion;
    extractTag(text: string, tagName: string): string | null;
    handleError(error: unknown): never;
};

function asPrivateProvider(provider: OpenAIProvider): PrivateOpenAIProvider {
    return provider as unknown as PrivateOpenAIProvider;
}

describe('OpenAI Provider 响应解析', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIProvider({
            apiKey: 'test-key',
            model: 'gpt-4o',
        });
    });

    describe('parseResponse', () => {
        it('举一反三清理题号和分值，拒绝返回选择题', async () => {
            const response = (question: string) => ({ choices: [{ finish_reason: 'stop', message: { content: `<question_text>${question}</question_text><answer_text>4</answer_text><analysis>计算</analysis><subject>数学</subject>` } }] });
            mockCompletionCreate.mockResolvedValue(response('1. （5分）求 2+2 的值。'));
            expect((await provider.generateSimilarQuestion('原题', [])).questionText).toBe('求 2+2 的值。');
            expect(mockCompletionCreate.mock.calls[0][0].messages[0].content).toContain('只能生成填空题或解答题');
            mockCompletionCreate.mockResolvedValue(response('求和。\nA. 2\nB. 4'));
            await expect(provider.generateSimilarQuestion('原题', [])).rejects.toThrow('AI_RESPONSE_ERROR');
        });
        it('解析配图标签，SVG 经净化', () => {
            const base = '<question_text>Q</question_text><answer_text>A</answer_text><analysis>An</analysis><subject>数学</subject>';
            const parsed = asPrivateProvider(provider).parseResponse(base + '<has_figure>true</has_figure><figure_svg><svg onload="x()"><rect width="1" height="1"/></svg></figure_svg>');
            expect(parsed.hasFigure).toBe(true);
            expect(parsed.figureSvg).toContain('<rect');
            expect(parsed.figureSvg).not.toContain('onload');
            expect(asPrivateProvider(provider).parseResponse(base)).toMatchObject({ hasFigure: false, figureSvg: null });
        });

        it('举一反三时把原题配图放进提示词，并解析新题配图', async () => {
            mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<question_text>新题</question_text><answer_text>A</answer_text><analysis>An</analysis><figure_svg><svg><circle r="2"/></svg></figure_svg>' } }] });
            const original = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';

            const result = await provider.generateSimilarQuestion('原题', ['面积'], 'zh', 'medium', null, original);

            expect(mockCompletionCreate.mock.calls[0][0].messages[0].content).toContain(original);
            expect(result.figureSvg).toContain('<circle r="2"/>');
        });

        it('单独重绘配图：发送原题图片并解析结果', async () => {
            mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<has_figure>true</has_figure><figure_svg><svg><line x1="0" y1="0" x2="1" y2="1"/></svg></figure_svg>' } }] });

            const figure = await provider.generateFigureSvg('QUJD', 'image/png', '如图');

            const request = mockCompletionCreate.mock.calls[0][0];
            expect(request.messages[1].content[0].image_url.url).toBe('data:image/png;base64,QUJD');
            expect(figure.hasFigure).toBe(true);
            expect(figure.figureSvg).toContain('<line');
        });

        it('解析难度星级标签，缺失或非法时为 null', () => {
            const base = '<question_text>Q</question_text><answer_text>A</answer_text><analysis>An</analysis><subject>数学</subject>';
            expect(asPrivateProvider(provider).parseResponse(base + '<difficulty_stars>4</difficulty_stars>').difficultyStars).toBe(4);
            expect(asPrivateProvider(provider).parseResponse(base + '<difficulty_stars>★★</difficulty_stars>').difficultyStars).toBe(2);
            expect(asPrivateProvider(provider).parseResponse(base).difficultyStars).toBeNull();
            expect(asPrivateProvider(provider).parseResponse(base + '<difficulty_stars>9</difficulty_stars>').difficultyStars).toBeNull();
        });

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

describe('OpenAI Provider 重新解题错因同步', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIProvider({
            apiKey: 'test-key',
            model: 'gpt-4o',
        });
    });

    it('重新解题应该返回新的错因字段，供前端覆盖旧错因', async () => {
        mockCompletionCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: `
<answer_text>x = 2</answer_text>
<analysis>两边同时减 3，再除以 2。</analysis>
<knowledge_points>一元一次方程</knowledge_points>
<wrong_answer_text>x = 4</wrong_answer_text>
<mistake_status>wrong_attempt</mistake_status>
<mistake_analysis>把 7 - 3 算错了。</mistake_analysis>
                    `.trim(),
                },
            }],
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh', '数学');

        expect(result.answerText).toBe('x = 2');
        expect(result.knowledgePoints).toEqual(['一元一次方程']);
        expect(result.wrongAnswerText).toBe('x = 4');
        expect(result.mistakeStatus).toBe('wrong_attempt');
        expect(result.mistakeAnalysis).toContain('算错');
    });

    it('重新解题缺少错因标签时应该返回默认值', async () => {
        mockCompletionCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: `
<answer_text>x = 2</answer_text>
<analysis>移项计算。</analysis>
<knowledge_points>一元一次方程</knowledge_points>
                    `.trim(),
                },
            }],
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh', '数学');

        expect(result.answerText).toBe('x = 2');
        expect(result.wrongAnswerText).toBe('');
        expect(result.mistakeAnalysis).toBe('');
        expect(result.mistakeStatus).toBe('unknown');
    });
});

describe('OpenAI Provider 错误处理', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIProvider({
            apiKey: 'test-key',
            model: 'gpt-4o',
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

        it('应该将 JSON 解析错误转换为 AI_RESPONSE_ERROR', () => {
            const parseError = new Error('Invalid JSON format');
            expect(() => asPrivateProvider(provider).handleError(parseError)).toThrow('AI_RESPONSE_ERROR');
        });

        it('未知错误应该转换为 AI_UNKNOWN_ERROR', () => {
            const unknownError = new Error('Something went wrong');
            expect(() => asPrivateProvider(provider).handleError(unknownError)).toThrow('AI_UNKNOWN_ERROR');
        });
    });
});

describe('OpenAI Provider 掌握概率评估与学科判断', () => {
    let provider: OpenAIProvider;
    const input = {
        questionText: '求解 2x + 3 = 7',
        knowledgePoints: ['一元一次方程'],
        history: [{ date: '2026-10-01T00:00:00.000Z', difficulty: 'medium', result: 'correct' as const, source: 'practice' }],
        ruleProbability: 0.6,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });
    });

    it('应该解析 JSON 结果并换算为 0~1 的概率', async () => {
        mockCompletionCreate.mockResolvedValueOnce({
            choices: [{ message: { content: '```json\n{"probability": 72, "reason": "近期做对一次"}\n```' } }],
        });

        const result = await provider.evaluateMastery(input);

        expect(result).toEqual({ probability: 0.72, reason: '近期做对一次' });
        const prompt = mockCompletionCreate.mock.calls[0][0].messages[0].content as string;
        expect(prompt).toContain('求解 2x + 3 = 7');
        expect(prompt).toContain('做对');
        expect(prompt).toContain('60%');
    });

    it('概率超出范围时应该报错，交由调用方兜底', async () => {
        mockCompletionCreate.mockResolvedValueOnce({
            choices: [{ message: { content: '{"probability": 150, "reason": "x"}' } }],
        });

        await expect(provider.evaluateMastery(input)).rejects.toThrow();
    });

    it('重新解题应该返回规范化后的学科', async () => {
        mockCompletionCreate.mockResolvedValueOnce({
            choices: [{ message: { content: '<answer_text>x = 2</answer_text><analysis>移项。</analysis><knowledge_points>方程</knowledge_points><subject>数学</subject>' } }],
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh');

        expect(result.subject).toBe('数学');
    });
});

describe('OpenAI Provider 知识点重新标注', () => {
    it('返回清单内的知识点', async () => {
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });
        mockCompletionCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"tags": ["植树问题", "不存在的"]}' } }] });

        const tags = await provider.suggestKnowledgeTags({ questionText: '题目', subject: '数学', allowedTags: ['植树问题'] });

        expect(tags).toEqual({ tags: ['植树问题'], difficultyStars: null });
    });
});

describe('OpenAI Provider 推理模型截断重试', () => {
    it('重新解题时思考耗尽额度后用更大上限重试并成功', async () => {
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'minimax-latest' });
        mockCompletionCreate
            .mockResolvedValueOnce({ choices: [{ finish_reason: 'length', message: { content: '' } }] })
            .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '<answer_text>x = 2</answer_text><analysis>移项</analysis><knowledge_points>方程</knowledge_points>' } }] });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh');

        expect(result.answerText).toBe('x = 2');
        expect(mockCompletionCreate.mock.calls.map((args) => args[0].max_tokens)).toEqual([8192, 32768]);
    });

    it('重试后仍为空时返回 AI_OUTPUT_TRUNCATED 而不是未知错误', async () => {
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'minimax-latest' });
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'length', message: { content: '' } }] });

        await expect(provider.reanswerQuestion('题目', 'zh')).rejects.toThrow('AI_OUTPUT_TRUNCATED');
        mockCompletionCreate.mockReset();
    });
});

describe('OpenAI Provider SVG 动画讲解', () => {
    const animation = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><circle r="5" opacity="0"><set attributeName="opacity" to="1" begin="2s" fill="freeze"/></circle><script>alert(1)</script></svg>';

    beforeEach(() => vi.clearAllMocks());

    it('把题目、答案、解析和配图放进提示词，解析并净化动画', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: `<svg_animation>${animation}</svg_animation>` } }] });
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

        const svg = await provider.generateSvgAnimation('求三角形面积', '6', '底乘高除以二', '<svg><rect width="3" height="4"/></svg>');

        const request = mockCompletionCreate.mock.calls[0][0];
        expect(request.max_tokens).toBe(16384);
        expect(request.messages[0].content).toContain('求三角形面积');
        expect(request.messages[0].content).toContain('底乘高除以二');
        expect(request.messages[0].content).toContain('<rect width="3" height="4"/>');
        expect(svg).toContain('<set attributeName="opacity"');
        expect(svg).not.toContain('<script');
    });

    it('language=en 时提示词和用户消息都要求动画文字使用英文', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: `<svg_animation>${animation}</svg_animation>` } }] });
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

        await provider.generateSvgAnimation('求三角形面积', '6', '底乘高除以二', null, 'en');

        const request = mockCompletionCreate.mock.calls[0][0];
        expect(request.messages[0].content).toContain('must be in English');
        expect(request.messages[1].content).toContain('in English');
    });

    it('回复中没有有效 SVG 时返回 null', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<svg_animation>无法生成</svg_animation>' } }] });
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

        expect(await provider.generateSvgAnimation('题目', '', '')).toBeNull();
    });
});

const narrationSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><metadata id="narration">[{"begin":0,"text":"旧的"}]</metadata><text y="480">第一步<set attributeName="opacity" to="1" begin="3s"/></text></svg>';
const narrationReply = '<narration>[{"begin":3,"text":"第二步"},{"begin":0,"text":"第一步"}]</narration>';
const expectedNarration = [{ begin: 0, text: '第一步' }, { begin: 3, text: '第二步' }];

describe('OpenAI Provider 补写语音讲解稿', () => {
    beforeEach(() => vi.clearAllMocks());

    it('把题目、解析和动画放进提示词，解析讲解稿', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: narrationReply } }] });
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

        expect(await provider.generateSvgNarration('求三角形面积', '6', '底乘高除以二', narrationSvg)).toEqual(expectedNarration);

        const request = mockCompletionCreate.mock.calls[0][0];
        expect(request.max_tokens).toBe(4096);
        expect(request.messages[0].content).toContain('求三角形面积');
        expect(request.messages[0].content).toContain('底乘高除以二');
        expect(request.messages[0].content).toContain('总时长约 3 秒');
        expect(request.messages[0].content).toContain('讲解使用简体中文');
    });

    it('回复中没有有效讲解稿时返回 null', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<narration>[]</narration>' } }] });
        expect(await new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' }).generateSvgNarration('题目', '', '', narrationSvg)).toBeNull();
    });
});

describe('OpenAI Provider 修复 LaTeX', () => {
    const latexInput = { answerText: { text: '$\\frac{1}{2$', issues: ['Expected }'] } };

    it('发送原文和问题，解析修复结果', async () => {
        mockCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<answer_text>$\\frac{1}{2}$</answer_text>' } }] });
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

        expect(await provider.fixLatex(latexInput)).toEqual({ answerText: '$\\frac{1}{2}$' });
        expect(mockCompletionCreate.mock.calls.at(-1)?.[0].messages[0].content).toContain('Expected }');
    });
});

describe('OpenAI Provider 判题', () => {
    it('解析判定结果，提示词包含学生答案和标准答案', async () => {
        const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });
        mockCompletionCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"correct": false, "reason": "只答出一个解"}' } }] });

        const result = await provider.gradeAnswer({ questionText: '解方程 x² = 1', answerText: 'x = 1 或 x = -1', userAnswer: 'x=1' });

        expect(result).toEqual({ correct: false, reason: '只答出一个解' });
        const prompt = mockCompletionCreate.mock.calls.at(-1)?.[0].messages[0].content as string;
        expect(prompt).toContain('x = 1 或 x = -1');
        expect(prompt).toContain('【学生答案】\nx=1');
    });
});
