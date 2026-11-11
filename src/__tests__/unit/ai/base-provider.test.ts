/**
 * BaseAIProvider 单元测试
 *
 * 用最小测试子类验证：14 个业务方法调用 complete 时传入的 task/system/user/image 正确；
 * 空响应抛错；异常经 handleError 后抛出。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));

const appConfig = vi.hoisted(() => ({ aiProvider: 'test', prompts: {}, figureReview: false }));
vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => appConfig),
}));

vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

// 配图图片处理默认原样返回；需要裁剪结果的用例单独设置
const figureImage = vi.hoisted(() => ({
    prepareFigureImage: vi.fn((base64: string, mimeType: string) => Promise.resolve<PreparedFigureImage>({ base64, mimeType, width: null, height: null, cropped: false })),
    renderFigureComparison: vi.fn(() => Promise.resolve<string | null>('Q01Q')),
}));
vi.mock('@/lib/ai/figure-image', () => figureImage);

import { AI_CALL_DEADLINE_MS, MIN_FIGURE_REDRAW_MS, VERCEL_AI_CALL_DEADLINE_MS, aiCallDeadlineMs, BaseAIProvider } from '@/lib/ai/base-provider';
import type { CompletionRequest } from '@/lib/ai/base-provider';
import type { PreparedFigureImage } from '@/lib/ai/figure-image';
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

        describe('识别后单独重绘配图', () => {
            const NS = 'xmlns="http://www.w3.org/2000/svg"';
            const analyzed = '<question_text>如图</question_text><answer_text>A</answer_text><analysis>解析</analysis><subject>化学</subject><knowledge_points>原电池</knowledge_points><requires_image>true</requires_image><has_figure>true</has_figure><figure_box>300,250,700,750</figure_box>';
            const drawn = `<svg ${NS} viewBox="0 0 800 468"><rect width="10" height="10"/></svg>`;

            afterEach(() => {
                vi.unstubAllEnvs();
            });

            it('按识别给出的位置裁剪后用 figure 任务重绘，结果写入识别结果', async () => {
                figureImage.prepareFigureImage.mockResolvedValueOnce({ base64: 'Q1JPUA==', mimeType: 'image/png', width: 800, height: 468, cropped: true });
                provider.completeText
                    .mockResolvedValueOnce(analyzed)
                    .mockResolvedValueOnce(`<has_figure>true</has_figure><figure_outline>外框</figure_outline><figure_svg>${drawn}</figure_svg>`);

                const result = await provider.analyzeImage('QUJD', 'image/jpeg');

                expect(figureImage.prepareFigureImage).toHaveBeenCalledWith('QUJD', 'image/jpeg', { x1: 300, y1: 250, x2: 700, y2: 750 });
                const figureRequest = provider.completeText.mock.calls[1][0];
                expect(figureRequest).toMatchObject({ task: 'figure', image: { base64: 'Q1JPUA==', mimeType: 'image/png' } });
                expect(figureRequest.system).toContain('viewBox="0 0 800 468"');
                expect(JSON.parse(figureRequest.user).data.questionText).toBe('如图');
                expect(result).toMatchObject({ hasFigure: true, figureSvg: drawn, questionText: '如图' });
            });

            it('无配图时不额外调用模型', async () => {
                await provider.analyzeImage('QUJD');
                expect(provider.completeText).toHaveBeenCalledTimes(1);
            });

            it('重绘失败不影响识别结果，配图留空', async () => {
                provider.completeText.mockResolvedValueOnce(analyzed).mockRejectedValueOnce(new Error('AI_SERVICE_UNAVAILABLE'));
                const result = await provider.analyzeImage('QUJD');
                expect(result).toMatchObject({ hasFigure: true, figureSvg: null, answerText: 'A' });
            });

            it('识别回复仍带 SVG（旧自定义模板）且重绘没有结果时沿用该 SVG', async () => {
                const legacy = `<svg ${NS}><circle r="3"/></svg>`;
                provider.completeText
                    .mockResolvedValueOnce(`${analyzed}<figure_svg>${legacy}</figure_svg>`)
                    .mockResolvedValueOnce('<has_figure>true</has_figure><figure_svg></figure_svg>');
                const result = await provider.analyzeImage('QUJD');
                expect(result.figureSvg).toBe(legacy);
            });

            it('Vercel 上识别后剩余时间不足时跳过重绘', async () => {
                vi.stubEnv('VERCEL', '1');
                vi.useFakeTimers({ toFake: ['Date'] });
                const start = Date.now();
                // 识别本身耗时到只剩不足重绘所需的时间
                provider.completeText.mockImplementationOnce(async () => {
                    vi.setSystemTime(start + VERCEL_AI_CALL_DEADLINE_MS - MIN_FIGURE_REDRAW_MS + 1000);
                    return analyzed;
                });
                const result = await provider.analyzeImage('QUJD');
                vi.useRealTimers();
                expect(provider.completeText).toHaveBeenCalledTimes(1);
                expect(result).toMatchObject({ hasFigure: true, figureSvg: null });
            });
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

        const NS = 'xmlns="http://www.w3.org/2000/svg"';
        const invalid = `<has_figure>true</has_figure><figure_svg><svg ${NS}><g><rect width="1" height="1"/></svg></figure_svg>`;
        const fixedSvg = `<svg ${NS}><g><rect width="1" height="1"/></g></svg>`;

        it('合法配图不再额外调用模型，裸 & 在本地修复', async () => {
            provider.completeText.mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg><svg ${NS}><text>A & B</text></svg></figure_svg>`);
            const figure = await provider.generateFigureSvg('QUJD', 'image/jpeg');
            expect(figure.figureSvg).toContain('A &amp; B');
            expect(provider.completeText).toHaveBeenCalledTimes(1);
        });

        it('配图不是合法 XML 时把解析错误交给模型修正一次', async () => {
            provider.completeText
                .mockResolvedValueOnce(invalid)
                .mockResolvedValueOnce(`<figure_svg>${fixedSvg}</figure_svg>`);
            const figure = await provider.generateFigureSvg('QUJD', 'image/jpeg');
            expect(figure).toEqual({ hasFigure: true, figureSvg: fixedSvg });
            const fixRequest = provider.completeText.mock.calls[1][0];
            expect(fixRequest.task).toBe('figure');
            expect(fixRequest.image).toBeUndefined();
            expect(JSON.parse(fixRequest.user).data.xmlError).toBeTruthy();
        });

        describe('比对校正', () => {
            const canvasImage: PreparedFigureImage = { base64: 'Q1JPUA==', mimeType: 'image/png', width: 800, height: 468, cropped: true };
            const drawn = `<svg ${NS} viewBox="0 0 800 468"><line x1="0" y1="0" x2="10" y2="0"/></svg>`;
            const revised = `<svg ${NS} viewBox="0 0 800 468"><line x1="10" y1="0" x2="0" y2="0"/></svg>`;

            beforeEach(() => {
                appConfig.figureReview = true;
                figureImage.prepareFigureImage.mockResolvedValueOnce(canvasImage);
            });
            afterEach(() => {
                appConfig.figureReview = false;
            });

            it('开启后把并排对比图交给模型，采用修正后的 SVG', async () => {
                provider.completeText
                    .mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg>${drawn}</figure_svg>`)
                    .mockResolvedValueOnce(`<figure_differences>箭头方向相反</figure_differences><figure_svg>${revised}</figure_svg>`);
                const figure = await provider.generateFigureSvg('QUJD', 'image/jpeg', '如图');

                expect(figureImage.renderFigureComparison).toHaveBeenCalledWith(canvasImage, drawn);
                const reviewRequest = provider.completeText.mock.calls[1][0];
                expect(reviewRequest).toMatchObject({ task: 'figure', image: { base64: 'Q01Q', mimeType: 'image/png' } });
                expect(reviewRequest.system).toContain('各宽 800 像素、高 468 像素');
                expect(JSON.parse(reviewRequest.user).data.figureSvg).toBe(drawn);
                expect(figure.figureSvg).toBe(revised);
            });

            it('模型认为一致（不输出 SVG）或调用失败时保留原 SVG', async () => {
                provider.completeText
                    .mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg>${drawn}</figure_svg>`)
                    .mockResolvedValueOnce('<figure_differences>无</figure_differences><figure_svg></figure_svg>');
                expect((await provider.generateFigureSvg('QUJD', 'image/jpeg')).figureSvg).toBe(drawn);

                figureImage.prepareFigureImage.mockResolvedValueOnce(canvasImage);
                provider.completeText
                    .mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg>${drawn}</figure_svg>`)
                    .mockRejectedValueOnce(new Error('AI_TIMEOUT_ERROR'));
                expect((await provider.generateFigureSvg('QUJD', 'image/jpeg')).figureSvg).toBe(drawn);
            });

            it('无法渲染对比图时不调用模型比对', async () => {
                figureImage.renderFigureComparison.mockResolvedValueOnce(null);
                provider.completeText.mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg>${drawn}</figure_svg>`);
                expect((await provider.generateFigureSvg('QUJD', 'image/jpeg')).figureSvg).toBe(drawn);
                expect(provider.completeText).toHaveBeenCalledTimes(1);
            });

            it('关闭时不比对', async () => {
                appConfig.figureReview = false;
                provider.completeText.mockResolvedValueOnce(`<has_figure>true</has_figure><figure_svg>${drawn}</figure_svg>`);
                await provider.generateFigureSvg('QUJD', 'image/jpeg');
                expect(figureImage.renderFigureComparison).not.toHaveBeenCalled();
                expect(provider.completeText).toHaveBeenCalledTimes(1);
            });
        });

        it('修正后仍不合法或修正调用失败时丢弃配图，保留有配图的判断', async () => {
            provider.completeText.mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid);
            expect(await provider.generateFigureSvg('QUJD', 'image/jpeg')).toEqual({ hasFigure: true, figureSvg: null });

            provider.completeText.mockResolvedValueOnce(invalid).mockRejectedValueOnce(new Error('AI_TIMEOUT_ERROR'));
            expect(await provider.generateFigureSvg('QUJD', 'image/jpeg')).toEqual({ hasFigure: true, figureSvg: null });
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

describe('BaseAIProvider 调用总时限', () => {
    /** 模拟一直不返回、直到收到中止信号才失败的服务商 */
    function hangingProvider(): TestProvider {
        const provider = new TestProvider();
        provider.completeText.mockImplementation((request) => new Promise((_, reject) => {
            request.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')));
        }));
        return provider;
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('超过总时限后中止请求（含 SDK 重试），按 AI_TIMEOUT_ERROR 失败', async () => {
        expect(AI_CALL_DEADLINE_MS).toBe(10 * 60 * 1000);
        const provider = hangingProvider();
        const result = provider.splitQuestions({ kind: 'text', lines: ['1. 题目'], language: 'zh' }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(AI_CALL_DEADLINE_MS - 1);
        expect(provider.completeText.mock.calls[0][0].signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const error = await result;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('AI_TIMEOUT_ERROR');
    });

    it('Vercel 上在函数被强制结束（300 秒）前超时', async () => {
        vi.stubEnv('VERCEL', '1');
        try {
            expect(aiCallDeadlineMs()).toBe(VERCEL_AI_CALL_DEADLINE_MS);
            expect(VERCEL_AI_CALL_DEADLINE_MS).toBeLessThan(300_000);
            const provider = hangingProvider();
            const result = provider.splitQuestions({ kind: 'text', lines: ['1. 题目'], language: 'zh' }).catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(VERCEL_AI_CALL_DEADLINE_MS);
            expect(((await result) as Error).message).toBe('AI_TIMEOUT_ERROR');
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('未超时的服务商错误照常归类，不被当成超时', async () => {
        const provider = new TestProvider();
        provider.completeText.mockRejectedValue(new Error('401 Unauthorized'));
        await expect(provider.splitQuestions({ kind: 'text', lines: ['1. 题目'], language: 'zh' })).rejects.toThrow('AI_AUTH_ERROR');
    });

    it('按时返回时清除计时器', async () => {
        const provider = new TestProvider();
        await provider.splitQuestions({ kind: 'text', lines: ['1. 题目'], language: 'zh' });
        expect(vi.getTimerCount()).toBe(0);
    });
});
