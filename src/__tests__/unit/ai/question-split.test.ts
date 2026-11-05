/**
 * AI 分题：四个主要提供商都把真实图片随请求发送，并输出同一种统一结构；模型输出按不可信数据校验
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    openaiCreate: vi.fn(),
    azureCreate: vi.fn(),
    geminiGenerate: vi.fn(),
    anthropicCreate: vi.fn(),
}));

vi.mock('openai', async () => {
    const { sdkMethod } = await import('../../helpers/sdk-response');
    return {
        default: class MockOpenAI {
            chat = { completions: { create: sdkMethod(mocks.openaiCreate) } };
        },
        AzureOpenAI: class MockAzureOpenAI {
            chat = { completions: { create: sdkMethod(mocks.azureCreate) } };
        },
    };
});
vi.mock('@google/genai', () => ({
    GoogleGenAI: class MockGoogleGenAI {
        models = { generateContent: mocks.geminiGenerate };
    },
}));
vi.mock('@anthropic-ai/sdk', async () => {
    const { sdkMethod } = await import('../../helpers/sdk-response');
    class APIError extends Error {}
    class MockAnthropic {
        static APIError = APIError;
        static APIConnectionError = APIError;
        static APIConnectionTimeoutError = APIError;
        messages = { create: sdkMethod(mocks.anthropicCreate) };
    }
    return { default: MockAnthropic };
});
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/config', () => ({ getAppConfig: vi.fn(() => ({ prompts: {} })) }));

import { AnthropicProvider } from '@/lib/ai/anthropic-provider';
import { AzureOpenAIProvider } from '@/lib/ai/azure-provider';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { OpenAIProvider } from '@/lib/ai/openai-provider';
import { normalizeSplitRegion, parseQuestionSplit } from '@/lib/ai/question-split';
import type { QuestionSplitInput } from '@/lib/ai/question-split';
import { QUESTION_SPLIT_CONTRACT_TITLE } from '@/lib/ai/prompts';
import type { AIService } from '@/lib/ai/types';

const IMAGE_BASE64 = '/9j/4AAQSkZJRgABAQ';
const imageInput: QuestionSplitInput = { kind: 'image', imageBase64: IMAGE_BASE64, mimeType: 'image/jpeg', language: 'zh' };
const textInput: QuestionSplitInput = { kind: 'text', lines: ['标题', '1．计算 1 + 1。', '2．如图，求面积。', '（1）求长；', '（2）求宽。'], language: 'zh' };
const IMAGE_REPLY = JSON.stringify({
    quality: 'clear',
    questions: [
        { label: '1．', text: '如图，求长方形的面积。', regions: [{ x: 50, y: 40, w: 900, h: 300 }], hasFigure: true, unclear: false },
        { label: 2, text: '下列说法正确的是', regions: [{ x: 50, y: 380, w: 1200, h: 250 }, { x: -5, y: 990, w: 3, h: 3 }] },
    ],
});
const TEXT_REPLY = '```json\n' + JSON.stringify({ questions: [{ label: '1', lines: [2, 2] }, { label: '2', lines: [3, 5] }] }) + '\n```';

function openAiReply(text: string) {
    return { choices: [{ message: { content: text }, finish_reason: 'stop' }] };
}

const providers: Array<{
    name: string;
    create: () => AIService;
    reply: (text: string) => void;
    request: () => { system: string; userText: string; image: string | null };
}> = [
    {
        name: 'OpenAI（含国产兼容渠道）',
        create: () => new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-test' }),
        reply: (text) => mocks.openaiCreate.mockResolvedValueOnce(openAiReply(text)),
        request: () => {
            const body = mocks.openaiCreate.mock.calls.at(-1)![0];
            const content = body.messages[1].content;
            const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
            return {
                system: body.messages[0].content,
                userText: parts.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join(''),
                image: parts.find((part: { type: string }) => part.type === 'image_url')?.image_url.url ?? null,
            };
        },
    },
    {
        name: 'Azure OpenAI',
        create: () => new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://example.openai.azure.com', deploymentName: 'deploy' }),
        reply: (text) => mocks.azureCreate.mockResolvedValueOnce(openAiReply(text)),
        request: () => {
            const body = mocks.azureCreate.mock.calls.at(-1)![0];
            const content = body.messages[1].content;
            const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
            return {
                system: body.messages[0].content,
                userText: parts.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join(''),
                image: parts.find((part: { type: string }) => part.type === 'image_url')?.image_url.url ?? null,
            };
        },
    },
    {
        name: 'Gemini',
        create: () => new GeminiProvider({ apiKey: 'test-key', model: 'gemini-test' }),
        reply: (text) => mocks.geminiGenerate.mockResolvedValueOnce({ text, candidates: [{ finishReason: 'STOP' }] }),
        request: () => {
            const body = mocks.geminiGenerate.mock.calls.at(-1)![0];
            const parts = Array.isArray(body.contents) ? body.contents : [{ text: body.contents }];
            const inline = parts.find((part: { inlineData?: { data: string; mimeType: string } }) => part.inlineData)?.inlineData;
            return {
                system: body.config.systemInstruction,
                userText: parts.filter((part: { text?: string }) => part.text).map((part: { text: string }) => part.text).join(''),
                image: inline ? `data:${inline.mimeType};base64,${inline.data}` : null,
            };
        },
    },
    {
        name: 'Anthropic（含 MiniMax Code 等兼容接口）',
        create: () => new AnthropicProvider({ apiKey: 'test-key', model: 'claude-test' }),
        reply: (text) => mocks.anthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }),
        request: () => {
            const body = mocks.anthropicCreate.mock.calls.at(-1)![0];
            const content = body.messages[0].content;
            const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
            const image = parts.find((part: { type: string }) => part.type === 'image');
            return {
                system: body.system,
                userText: parts.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join(''),
                image: image ? `data:${image.source.media_type};base64,${image.source.data}` : null,
            };
        },
    },
];

beforeEach(() => {
    // 每个用例只为当前提供商排队回复，清掉其他提供商未用完的排队
    for (const mock of [mocks.openaiCreate, mocks.azureCreate, mocks.geminiGenerate, mocks.anthropicCreate]) mock.mockReset();
});

describe.each(providers)('$name 分题', ({ create, reply, request }) => {
    it('图片分题把真实图片随请求发送，返回统一结构，区域按 0～1 校验', async () => {
        reply(IMAGE_REPLY);
        const result = await create().splitQuestions(imageInput);
        const sent = request();
        expect(sent.image).toBe(`data:image/jpeg;base64,${IMAGE_BASE64}`);
        expect(sent.system).toContain(QUESTION_SPLIT_CONTRACT_TITLE);
        expect(sent.system).toContain('配图');
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0]).toMatchObject({ label: '1', text: '如图，求长方形的面积。', hasFigure: true, flags: [], regions: [{ x: 0.05, y: 0.04, width: 0.9, height: 0.3 }] });
        // 超出图片的部分裁掉，过小的区域丢弃
        expect(result.questions[1].regions).toEqual([{ x: 0.05, y: 0.38, width: 0.95, height: 0.25 }]);
        expect(result.warnings).toEqual([]);
    });

    it('文字分题不发送图片，题目文字由原文按行号拼回', async () => {
        reply(TEXT_REPLY);
        const result = await create().splitQuestions(textInput);
        const sent = request();
        expect(sent.image).toBeNull();
        expect(sent.userText).toContain('"n":3');
        expect(result.questions.map((question) => question.text)).toEqual(['计算 1 + 1。', '如图，求面积。\n（1）求长；\n（2）求宽。']);
        expect(result.ignored).toEqual(['标题']);
    });

    it('模型不支持图片时给出明确错误', async () => {
        const failure = new Error('400 Invalid content type. image_url is only supported by certain models; this model does not support image input');
        mocks.openaiCreate.mockRejectedValueOnce(failure);
        mocks.azureCreate.mockRejectedValueOnce(failure);
        mocks.geminiGenerate.mockRejectedValue(failure);
        mocks.anthropicCreate.mockRejectedValueOnce(failure);
        await expect(create().splitQuestions(imageInput)).rejects.toThrow('AI_IMAGE_NOT_SUPPORTED');
    });

    it('无法解析的回复按返回异常处理', async () => {
        reply('抱歉，我无法处理。');
        await expect(create().splitQuestions(imageInput)).rejects.toThrow(/AI_RESPONSE_ERROR/);
    });
});

describe('分题结果校验', () => {
    it('文字分题：越界、倒序、与其他题重叠的范围丢弃；公共材料可被多题引用，但不能与题干重叠', () => {
        const lines = ['阅读材料：某店上午卖 30 件，下午卖 45 件。', '1．全天卖多少件？', '2．下午多卖多少件？', '3．计算 9 - 3。', '多余的一行'];
        const result = parseQuestionSplit(JSON.stringify({ questions: [
            { lines: [2, 2], material: [1, 1] },
            { lines: [3, 3], material: [1, 1] },
            { lines: [3, 4], material: null },
            { lines: [4, 4], material: [3, 3] },
            { lines: [5, 2] },
            { lines: [0, 1] },
        ] }), { kind: 'text', lines, language: 'zh' });
        expect(result.questions.map((question) => [question.text, question.material])).toEqual([
            ['全天卖多少件？', '阅读材料：某店上午卖 30 件，下午卖 45 件。'],
            ['下午多卖多少件？', '阅读材料：某店上午卖 30 件，下午卖 45 件。'],
            ['计算 9 - 3。', null],
        ]);
        expect(result.ignored).toEqual(['多余的一行']);
    });

    it('JSON 被截断时只保留完整的题并提示', () => {
        const truncated = '{"quality":"clear","questions":[{"label":"1","text":"第一题 \\"引号\\" {括号}","regions":[{"x":0,"y":0,"w":500,"h":200}]},{"label":"2","text":"第二题被截';
        const result = parseQuestionSplit(truncated, { kind: 'image', imageBase64: 'x', mimeType: 'image/jpeg', language: 'zh' });
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('第一题 "引号" {括号}');
        expect(result.warnings).toContain('truncated');
    });

    it('图片分题：没有区域的题标记未定位，看不清与不完整如实标记，模糊照片给出提示', () => {
        const result = parseQuestionSplit(JSON.stringify({ quality: 'blurry', questions: [
            { label: '3', text: '看不清', regions: [], unclear: true, partial: true },
            { text: '', regions: [] },
        ] }), { kind: 'image', imageBase64: 'x', mimeType: 'image/jpeg', language: 'zh' });
        expect(result.questions).toEqual([expect.objectContaining({ label: '3', flags: ['unclear', 'partial', 'unlocated'], regions: [] })]);
        expect(result.warnings).toEqual(['blurry']);
    });

    it('空结果返回空列表，题数超过上限时截断并提示', () => {
        expect(parseQuestionSplit('{"questions":[]}', textInput).questions).toEqual([]);
        const many = parseQuestionSplit(JSON.stringify({ questions: Array.from({ length: 70 }, (_, index) => ({ text: `题 ${index}`, regions: [{ x: 0, y: index * 10, w: 1000, h: 10 }] })) }), imageInput);
        expect(many.questions).toHaveLength(60);
        expect(many.warnings).toContain('tooMany');
        // 多出的题不静默丢弃
        expect(many.ignored).toEqual(Array.from({ length: 10 }, (_, index) => `题 ${index + 60}`));
    });

    it('区域坐标规范化', () => {
        expect(normalizeSplitRegion({ x: '100', y: 200, w: 300, h: 400 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
        expect(normalizeSplitRegion({ x: 900, y: 900, w: 500, h: 500 })).toEqual({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 });
        expect(normalizeSplitRegion({ x: 0, y: 0, w: 5, h: 500 })).toBeNull();
        expect(normalizeSplitRegion({ x: 'a', y: 0, w: 100, h: 100 })).toBeNull();
        expect(normalizeSplitRegion(null)).toBeNull();
    });
});
