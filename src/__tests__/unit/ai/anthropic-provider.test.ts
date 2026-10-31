/**
 * Anthropic Provider 单元测试
 *
 * 测试请求构造、正文提取、截断重试和错误码映射
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    class APIError extends Error {
        status: number | undefined;
        constructor(status: number | undefined, message: string) {
            super(message);
            this.status = status;
        }
    }
    class APIConnectionError extends APIError {
        constructor(message = 'Connection error.') {
            super(undefined, message);
        }
    }
    class APIConnectionTimeoutError extends APIConnectionError {
        constructor() {
            super('Request timed out.');
        }
    }
    return {
        create: vi.fn(),
        clientOptions: [] as unknown[],
        APIError,
        APIConnectionError,
        APIConnectionTimeoutError,
    };
});

vi.mock('@anthropic-ai/sdk', () => {
    class MockAnthropic {
        static APIError = mocks.APIError;
        static APIConnectionError = mocks.APIConnectionError;
        static APIConnectionTimeoutError = mocks.APIConnectionTimeoutError;
        messages = { create: mocks.create };
        constructor(options: unknown) {
            mocks.clientOptions.push(options);
        }
    }
    return { default: MockAnthropic };
});

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));

vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({ aiProvider: 'anthropic', prompts: {} })),
}));

vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

import { AnthropicProvider } from '@/lib/ai/anthropic-provider';

const QUESTION_XML = `
<subject>数学</subject>
<question_text>2 + 3 = ?</question_text>
<answer_text>5</answer_text>
<analysis>直接相加</analysis>
<knowledge_points>加法, 20以内加法</knowledge_points>
<requires_image>false</requires_image>
<difficulty_stars>2</difficulty_stars>
`;

function message(text: string, stopReason = 'end_turn', extraBlocks: unknown[] = []) {
    return {
        content: [...extraBlocks, { type: 'text', text }],
        stop_reason: stopReason,
        usage: { input_tokens: 10, output_tokens: 10 },
    };
}

describe('AnthropicProvider', () => {
    it('举一反三清理题号和分值，拒绝返回选择题', async () => {
        const provider = new AnthropicProvider({ apiKey: 'test-key' });
        mocks.create.mockResolvedValue(message(QUESTION_XML.replace('2 + 3 = ?', '1. （5分）求 2+2 的值。')));
        expect((await provider.generateSimilarQuestion('原题', [])).questionText).toBe('求 2+2 的值。');
        expect(mocks.create.mock.calls[0][0].system).toContain('只能生成填空题或解答题');
        mocks.create.mockResolvedValue(message(QUESTION_XML.replace('2 + 3 = ?', '求和。\nA. 2\nB. 4')));
        await expect(provider.generateSimilarQuestion('原题', [])).rejects.toThrow('AI_RESPONSE_ERROR');
    });
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clientOptions.length = 0;
    });

    it('缺少 API Key 时报认证错误', () => {
        expect(() => new AnthropicProvider({})).toThrow(/AI_AUTH_ERROR/);
    });

    it('规范化 baseUrl（去掉末尾斜杠和 /v1），并显式设置超时', () => {
        new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://gw.example.com/anthropic/v1/' });

        // 兼容网关：API Key 以 x-api-key 请求头发送（与旧版 SDK 一致），不交给 SDK 的 apiKey
        expect(mocks.clientOptions[0]).toMatchObject({
            apiKey: null,
            baseURL: 'https://gw.example.com/anthropic',
            timeout: expect.any(Number),
            defaultHeaders: { 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' },
        });
    });

    it('传 authToken 时以 Bearer 认证，且不读取环境变量里的 API Key', () => {
        mocks.clientOptions.length = 0;
        new AnthropicProvider({ authToken: 'mmoat_x', baseUrl: 'https://agent.minimax.cn/mavis/api/v1/llm' });

        expect(mocks.clientOptions[0]).toMatchObject({
            apiKey: null,
            authToken: 'mmoat_x',
            baseURL: 'https://agent.minimax.cn/mavis/api/v1/llm',
        });
    });

    it('图片识别：以 base64 图片块发送，并解析 XML 回复', async () => {
        mocks.create.mockResolvedValue(message(QUESTION_XML));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-test' });

        const result = await provider.analyzeImage('aGVsbG8=', 'image/png');

        const request = mocks.create.mock.calls[0][0];
        expect(request.model).toBe('claude-test');
        expect(request.max_tokens).toBe(8192);
        expect(typeof request.system).toBe('string');
        expect(request.messages[0].content[0]).toEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
        });
        expect(result).toMatchObject({
            subject: '数学',
            questionText: '2 + 3 = ?',
            answerText: '5',
            knowledgePoints: ['加法', '20以内加法'],
            requiresImage: false,
            difficultyStars: 2,
        });
    });

    it('重新解题：data URL 图片拆出 media_type 和数据', async () => {
        mocks.create.mockResolvedValue(message('<answer_text>5</answer_text><analysis>相加</analysis><subject>数学</subject>'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        const result = await provider.reanswerQuestion('2 + 3 = ?', 'zh', '数学', 'data:image/webp;base64,QUJD');

        expect(mocks.create.mock.calls[0][0].messages[0].content[0].source).toEqual({ type: 'base64', media_type: 'image/webp', data: 'QUJD' });
        expect(result).toMatchObject({ answerText: '5', analysis: '相加', subject: '数学' });
    });

    it('忽略推理模型返回的 thinking 块，只取正文', async () => {
        mocks.create.mockResolvedValue(message('{"tags": ["加法"]}', 'end_turn', [{ type: 'thinking', thinking: '先想一想', signature: 'x' }]));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        const tags = await provider.suggestKnowledgeTags({ questionText: '2+3', subject: '数学', allowedTags: ['加法', '减法'] });

        expect(tags).toEqual({ tags: ['加法'], difficultyStars: null });
    });

    it('单独重绘配图：以图片块发送并解析配图', async () => {
        mocks.create.mockResolvedValue(message('<has_figure>true</has_figure><figure_svg><svg><rect width="2" height="2"/></svg></figure_svg>'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        const figure = await provider.generateFigureSvg('QUJD', 'image/jpeg', '如图');

        expect(mocks.create.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: 'QUJD' } });
        expect(figure).toMatchObject({ hasFigure: true });
        expect(figure.figureSvg).toContain('<rect');
    });

    it('正文为空且因 max_tokens 截断时，用更大的上限重试一次', async () => {
        mocks.create
            .mockResolvedValueOnce({ content: [{ type: 'thinking', thinking: '...', signature: 'x' }], stop_reason: 'max_tokens', usage: {} })
            .mockResolvedValueOnce(message('{"probability": 85, "reason": "连续答对"}'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        const result = await provider.evaluateMastery({ questionText: 'q', knowledgePoints: [], history: [], ruleProbability: 0.5 });

        expect(mocks.create).toHaveBeenCalledTimes(2);
        expect(mocks.create.mock.calls[0][0].max_tokens).toBe(4096);
        expect(mocks.create.mock.calls[1][0].max_tokens).toBe(32768);
        expect(result.probability).toBe(0.85);
    });

    it('重试后仍被截断时报 AI_OUTPUT_TRUNCATED', async () => {
        mocks.create.mockResolvedValue({ content: [], stop_reason: 'max_tokens', usage: {} });
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        await expect(provider.generateSimilarQuestion('2+3', ['加法'])).rejects.toThrow('AI_OUTPUT_TRUNCATED');
    });

    it.each([
        [new mocks.APIError(401, 'invalid x-api-key'), 'AI_AUTH_ERROR'],
        [new mocks.APIError(403, 'forbidden'), 'AI_PERMISSION_DENIED'],
        [new mocks.APIError(404, 'model not found'), 'AI_NOT_FOUND'],
        [new mocks.APIError(429, 'rate limited'), 'AI_QUOTA_EXCEEDED'],
        [new mocks.APIError(529, 'overloaded'), 'AI_SERVICE_UNAVAILABLE'],
        [new mocks.APIConnectionTimeoutError(), 'AI_TIMEOUT_ERROR'],
        [new mocks.APIConnectionError(), 'AI_CONNECTION_FAILED'],
    ])('把 SDK 错误映射为标准错误码 %#', async (error, code) => {
        mocks.create.mockRejectedValue(error);
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        await expect(provider.generateSimilarQuestion('2+3', ['加法'])).rejects.toThrow(code);
    });

    it('回复缺少必需标签时报 AI_RESPONSE_ERROR', async () => {
        mocks.create.mockResolvedValue(message('我不知道'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        await expect(provider.generateSimilarQuestion('2+3', ['加法'])).rejects.toThrow('AI_RESPONSE_ERROR');
    });
});

describe('Anthropic Provider SVG 动画讲解', () => {
    const animation = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><circle r="5" opacity="0"><set attributeName="opacity" to="1" begin="2s" fill="freeze"/></circle><script>alert(1)</script></svg>';

    it('解析并净化动画', async () => {
        mocks.create.mockResolvedValue(message(`<svg_animation>${animation}</svg_animation>`));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        const svg = await provider.generateSvgAnimation('求面积', '6', '解析');

        const request = mocks.create.mock.calls.at(-1)?.[0];
        expect(request.max_tokens).toBe(16384);
        expect(request.system).toContain('求面积');
        expect(svg).toContain('<set attributeName="opacity"');
        expect(svg).not.toContain('<script');
    });
});

const narrationSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><metadata id="narration">[{"begin":0,"text":"旧的"}]</metadata><text y="480">第一步<set attributeName="opacity" to="1" begin="3s"/></text></svg>';
const narrationReply = '<narration>[{"begin":3,"text":"第二步"},{"begin":0,"text":"第一步"}]</narration>';
const expectedNarration = [{ begin: 0, text: '第一步' }, { begin: 3, text: '第二步' }];

describe('Anthropic Provider 补写语音讲解稿', () => {
    it('提示词包含去掉旧讲解稿的动画，解析讲解稿', async () => {
        mocks.create.mockResolvedValue(message(narrationReply));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        expect(await provider.generateSvgNarration('求面积', '6', '解析', narrationSvg)).toEqual(expectedNarration);

        const request = mocks.create.mock.calls.at(-1)?.[0];
        expect(request.max_tokens).toBe(4096);
        expect(request.system).toContain('begin="3s"');
        expect(request.system).not.toContain('旧的');
    });

    it('没有有效讲解稿时返回 null', async () => {
        mocks.create.mockResolvedValue(message('<narration>无法生成</narration>'));
        expect(await new AnthropicProvider({ apiKey: 'sk-ant' }).generateSvgNarration('题目', '', '', narrationSvg)).toBeNull();
    });
});

describe('Anthropic Provider 修复 LaTeX', () => {
    const latexInput = { answerText: { text: '$\\frac{1}{2$', issues: ['Expected }'] } };

    it('解析修复结果', async () => {
        mocks.create.mockResolvedValue(message('<answer_text>$\\frac{1}{2}$</answer_text>'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        expect(await provider.fixLatex(latexInput)).toEqual({ answerText: '$\\frac{1}{2}$' });
        expect(mocks.create.mock.calls.at(-1)?.[0].system).toContain('Expected }');
    });
});

describe('Anthropic Provider 判题', () => {
    it('解析判定结果', async () => {
        mocks.create.mockResolvedValue(message('{"correct": false, "reason": "缺少单位"}'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        expect(await provider.gradeAnswer({ questionText: '求路程', answerText: '30 米', userAnswer: '30' })).toEqual({ correct: false, reason: '缺少单位' });
        expect(mocks.create.mock.calls.at(-1)?.[0].system).toContain('【学生答案】\n30');
    });

    it('判定结果格式不对时报错，由调用方兜底', async () => {
        mocks.create.mockResolvedValue(message('{"result": "对"}'));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant' });

        await expect(provider.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'b' })).rejects.toThrow();
    });
});
