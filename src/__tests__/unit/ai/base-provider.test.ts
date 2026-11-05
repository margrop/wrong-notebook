/**
 * BaseAIProvider 单元测试
 *
 * 用最小测试子类验证：14 个业务方法调用 complete 时传入的 task/system/user/image 正确；
 * 空响应抛错；异常经 handleError 后抛出。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));

vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({ aiProvider: 'test', prompts: {} })),
}));

vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

import { BaseAIProvider } from '@/lib/ai/base-provider';
import type { CompletionRequest } from '@/lib/ai/base-provider';
import type { CompletionEvent, CompletionResult } from '@/lib/ai/completion';

class TestProvider extends BaseAIProvider {
    protected readonly providerName = 'Test';
    protected readonly configuredModel = 'test-model';
    /** 模拟服务商返回的正文 */
    completeText = vi.fn<(request: CompletionRequest) => Promise<string>>();
    /** 随正文返回的用量、模型和请求 ID */
    completionMeta: Omit<CompletionResult, 'text'> = {};

    constructor() {
        super();
        this.completeText.mockImplementation((request) => Promise.resolve(defaultResponseFor(request.task)));
    }

    protected async complete(request: CompletionRequest): Promise<CompletionResult> {
        return { text: await this.completeText(request), ...this.completionMeta };
    }
}

function defaultResponseFor(task: CompletionRequest['task']): string {
    switch (task) {
        case 'analyze':
            return '<question_text>题目</question_text><answer_text>答案</answer_text><analysis>解析</analysis><subject>数学</subject><knowledge_points>加法</knowledge_points><requires_image>false</requires_image>';
        case 'similar':
            return '<question_text>新题</question_text><answer_text>答案</answer_text><analysis>解析</analysis><subject>数学</subject><knowledge_points>加法</knowledge_points><requires_image>false</requires_image>';
        case 'reanswer':
            return '<answer_text>5</answer_text><analysis>相加</analysis><knowledge_points>加法</knowledge_points>';
        case 'geogebra':
            return '{"suitable":true,"commands":["a=1"],"description":"描述"}';
        case 'mastery':
            return '{"probability":80,"reason":"近期表现"}';
        case 'recognize-grade':
            return '{"gradeSemester":"四年级上"}';
        case 'grading':
            return '{"correct":true,"reason":"数值相等"}';
        case 'tag-suggest':
            return '{"tags":["加法"],"difficultyStars":2}';
        case 'figure':
            return '<has_figure>true</has_figure><figure_svg><svg xmlns="http://www.w3.org/2000/svg"/></figure_svg>';
        case 'latex-fix':
            return '<answer_text>$x$</answer_text>';
        case 'svg-animation':
            return '<svg_animation><svg xmlns="http://www.w3.org/2000/svg"/></svg_animation>';
        case 'svg-narration':
            return '<narration>[{"begin":0,"text":"第一步"}]</narration>';
        case 'question-split':
            return '{"questions":[]}';
        case 'text-fix':
            return '{"questions":[{"id":"q1","text":"修正后","uncertain":[]}]}';
    }
}

describe('BaseAIProvider', () => {
    let provider: TestProvider;

    beforeEach(() => {
        provider = new TestProvider();
    });

    describe('analyzeImage', () => {
        it('task 为 analyze，传入 system/user/image', async () => {
            await provider.analyzeImage('QUJD', 'image/png');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'analyze',
                system: expect.any(String),
                user: expect.any(String),
                image: { base64: 'QUJD', mimeType: 'image/png' },
            }));
        });

        it('带参考文字（题库文件文字层）时，参考文字只进入用户数据消息', async () => {
            await provider.analyzeImage('QUJD', 'image/png', 'zh', null, null, null, undefined, 'PDF 文字层，可能乱码');
            const request = provider.completeText.mock.calls[0][0];
            expect(request.task).toBe('analyze');
            expect(JSON.parse(request.user).data.referenceText).toBe('PDF 文字层，可能乱码');
            expect(request.system).toContain('【参考文字');
            // 参考文字不作为系统指令注入
            expect(request.system).not.toContain('PDF 文字层，可能乱码');
        });

        it('不传参考文字时用户数据不含 referenceText 字段', async () => {
            await provider.analyzeImage('QUJD', 'image/png');
            expect(JSON.parse(provider.completeText.mock.calls[0][0].user).data.referenceText).toBeUndefined();
        });

        it('空响应时抛错', async () => {
            provider.completeText.mockResolvedValue('');
            await expect(provider.analyzeImage('QUJD')).rejects.toThrow();
        });

        it('异常经 handleError 后抛出', async () => {
            const err = new Error('network unreachable');
            provider.completeText.mockRejectedValue(err);
            await expect(provider.analyzeImage('QUJD')).rejects.toThrow('AI_CONNECTION_FAILED');
        });
    });

    describe('generateSimilarQuestion', () => {
        it('task 为 similar，不附带图片', async () => {
            await provider.generateSimilarQuestion('原题', ['加法']);
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'similar',
                system: expect.any(String),
                user: expect.any(String),
            }));
            expect(provider.completeText.mock.calls[0][0].image).toBeUndefined();
        });
    });

    describe('reanswerQuestion', () => {
        it('有图片时附带 image，无图片时不附带', async () => {
            await provider.reanswerQuestion('题目', 'zh', '数学', 'QUJD');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'reanswer',
                image: { base64: 'QUJD' },
            }));
            provider.completeText.mockClear();
            await provider.reanswerQuestion('题目');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'reanswer',
                image: undefined,
            }));
        });
    });

    describe('analyzeForGeogebra', () => {
        it('task 为 geogebra', async () => {
            await provider.analyzeForGeogebra('题目', '答案', '解析');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'geogebra' }));
        });
    });

    describe('evaluateMastery', () => {
        it('task 为 mastery', async () => {
            await provider.evaluateMastery({ questionText: 'q', knowledgePoints: [], history: [], ruleProbability: 0.5 });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'mastery' }));
        });
    });

    describe('recognizeGrade', () => {
        it('task 为 recognize-grade', async () => {
            await provider.recognizeGrade('题目');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'recognize-grade' }));
        });
    });

    describe('gradeAnswer', () => {
        it('task 为 grading', async () => {
            await provider.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'b' });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'grading' }));
        });
    });

    describe('suggestKnowledgeTags', () => {
        it('task 为 tag-suggest', async () => {
            await provider.suggestKnowledgeTags({ questionText: 'q', subject: '数学', allowedTags: [] });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'tag-suggest' }));
        });

        it('响应包含 questionType 时解析题型', async () => {
            provider.completeText.mockResolvedValue('{"tags":["加法"],"difficultyStars":2,"questionType":"calculation"}');
            const result = await provider.suggestKnowledgeTags({ questionText: 'q', subject: '数学', allowedTags: ['加法'] });
            expect(result.questionType).toBe('calculation');
        });

        it('响应缺少 questionType 时返回 null', async () => {
            provider.completeText.mockResolvedValue('{"tags":["加法"],"difficultyStars":2}');
            const result = await provider.suggestKnowledgeTags({ questionText: 'q', subject: '数学', allowedTags: ['加法'] });
            expect(result.questionType).toBeNull();
        });
    });

    describe('generateFigureSvg', () => {
        it('task 为 figure，附带图片和额外文字', async () => {
            await provider.generateFigureSvg('QUJD', 'image/jpeg');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'figure',
                image: { base64: 'QUJD', mimeType: 'image/jpeg' },
                extraUserText: '请重新绘制图中题目的配图。',
            }));
        });
    });

    describe('fixLatex', () => {
        it('task 为 latex-fix', async () => {
            await provider.fixLatex({ answerText: { text: '$x$', issues: [] } });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'latex-fix' }));
        });
    });

    describe('generateSvgAnimation', () => {
        it('task 为 svg-animation', async () => {
            await provider.generateSvgAnimation('题目', '答案', '解析');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'svg-animation' }));
        });
    });

    describe('generateSvgNarration', () => {
        it('task 为 svg-narration', async () => {
            await provider.generateSvgNarration('题目', '答案', '解析', '<svg/>');
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'svg-narration' }));
        });
    });

    describe('splitQuestions', () => {
        it('图片分题时附带 image', async () => {
            await provider.splitQuestions({ kind: 'image', imageBase64: 'QUJD', mimeType: 'image/png', language: 'zh' });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'question-split',
                image: { base64: 'QUJD', mimeType: 'image/png' },
            }));
        });

        it('文字分题时不附带 image', async () => {
            await provider.splitQuestions({ kind: 'text', lines: ['第一行'], language: 'zh' });
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({
                task: 'question-split',
                image: undefined,
            }));
        });
    });

    describe('fixQuestionText', () => {
        it('task 为 text-fix', async () => {
            await provider.fixQuestionText([{ id: 'q1', text: '原文' }]);
            expect(provider.completeText).toHaveBeenCalledWith(expect.objectContaining({ task: 'text-fix' }));
        });
    });
});

describe('BaseAIProvider 补全观察者', () => {
    let provider: TestProvider;
    let events: CompletionEvent[];

    beforeEach(() => {
        provider = new TestProvider();
        events = [];
        provider.observeCompletions((event) => { events.push(event); });
    });

    it('成功时记录任务、用量、实际模型和请求 ID', async () => {
        provider.completionMeta = { usage: { inputTokens: 120, outputTokens: 30 }, model: 'real-model', requestId: 'req-1' };
        await provider.gradeAnswer({ questionText: '1+1', answerText: '2', userAnswer: '2' });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            task: 'grading',
            status: 'succeeded',
            usage: { inputTokens: 120, outputTokens: 30 },
            model: 'real-model',
            requestId: 'req-1',
        });
        expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('服务商未返回模型时记录配置的模型', async () => {
        await provider.fixQuestionText([{ id: 'q1', text: '原文' }]);
        expect(events[0]).toMatchObject({ task: 'text-fix', status: 'succeeded', model: 'test-model' });
        expect(events[0].usage).toBeUndefined();
    });

    it('失败时记录标准错误码，业务方法照常抛错', async () => {
        provider.completeText.mockRejectedValue(new Error('429 Too Many Requests'));
        await expect(provider.analyzeImage('QUJD')).rejects.toThrow('AI_QUOTA_EXCEEDED');
        expect(events).toEqual([expect.objectContaining({ task: 'analyze', status: 'failed', errorCode: 'AI_QUOTA_EXCEEDED', model: 'test-model' })]);
    });

    it('观察者同步抛错或异步失败都不影响调用结果', async () => {
        provider.observeCompletions(() => { throw new Error('observer broken'); });
        await expect(provider.fixQuestionText([{ id: 'q1', text: '原文' }])).resolves.toBeDefined();
        provider.observeCompletions(() => Promise.reject(new Error('observer broken')));
        await expect(provider.fixQuestionText([{ id: 'q1', text: '原文' }])).resolves.toBeDefined();
    });

    it('未设置观察者时正常调用', async () => {
        provider.observeCompletions(undefined);
        await expect(provider.fixQuestionText([{ id: 'q1', text: '原文' }])).resolves.toBeDefined();
        expect(events).toHaveLength(0);
    });
});
