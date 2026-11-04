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

class TestProvider extends BaseAIProvider {
    protected readonly providerName = 'Test';
    complete = vi.fn<(request: CompletionRequest) => Promise<string>>();

    constructor() {
        super();
        this.complete.mockImplementation((request) => Promise.resolve(defaultResponseFor(request.task)));
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
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'analyze',
                system: expect.any(String),
                user: expect.any(String),
                image: { base64: 'QUJD', mimeType: 'image/png' },
            }));
        });

        it('空响应时抛错', async () => {
            provider.complete.mockResolvedValue('');
            await expect(provider.analyzeImage('QUJD')).rejects.toThrow();
        });

        it('异常经 handleError 后抛出', async () => {
            const err = new Error('network unreachable');
            provider.complete.mockRejectedValue(err);
            await expect(provider.analyzeImage('QUJD')).rejects.toThrow('AI_CONNECTION_FAILED');
        });
    });

    describe('generateSimilarQuestion', () => {
        it('task 为 similar，不附带图片', async () => {
            await provider.generateSimilarQuestion('原题', ['加法']);
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'similar',
                system: expect.any(String),
                user: expect.any(String),
            }));
            expect(provider.complete.mock.calls[0][0].image).toBeUndefined();
        });
    });

    describe('reanswerQuestion', () => {
        it('有图片时附带 image，无图片时不附带', async () => {
            await provider.reanswerQuestion('题目', 'zh', '数学', 'QUJD');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'reanswer',
                image: { base64: 'QUJD' },
            }));
            provider.complete.mockClear();
            await provider.reanswerQuestion('题目');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'reanswer',
                image: undefined,
            }));
        });
    });

    describe('analyzeForGeogebra', () => {
        it('task 为 geogebra', async () => {
            await provider.analyzeForGeogebra('题目', '答案', '解析');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'geogebra' }));
        });
    });

    describe('evaluateMastery', () => {
        it('task 为 mastery', async () => {
            await provider.evaluateMastery({ questionText: 'q', knowledgePoints: [], history: [], ruleProbability: 0.5 });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'mastery' }));
        });
    });

    describe('recognizeGrade', () => {
        it('task 为 recognize-grade', async () => {
            await provider.recognizeGrade('题目');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'recognize-grade' }));
        });
    });

    describe('gradeAnswer', () => {
        it('task 为 grading', async () => {
            await provider.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'b' });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'grading' }));
        });
    });

    describe('suggestKnowledgeTags', () => {
        it('task 为 tag-suggest', async () => {
            await provider.suggestKnowledgeTags({ questionText: 'q', subject: '数学', allowedTags: [] });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'tag-suggest' }));
        });
    });

    describe('generateFigureSvg', () => {
        it('task 为 figure，附带图片和额外文字', async () => {
            await provider.generateFigureSvg('QUJD', 'image/jpeg');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'figure',
                image: { base64: 'QUJD', mimeType: 'image/jpeg' },
                extraUserText: '请重新绘制图中题目的配图。',
            }));
        });
    });

    describe('fixLatex', () => {
        it('task 为 latex-fix', async () => {
            await provider.fixLatex({ answerText: { text: '$x$', issues: [] } });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'latex-fix' }));
        });
    });

    describe('generateSvgAnimation', () => {
        it('task 为 svg-animation', async () => {
            await provider.generateSvgAnimation('题目', '答案', '解析');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'svg-animation' }));
        });
    });

    describe('generateSvgNarration', () => {
        it('task 为 svg-narration', async () => {
            await provider.generateSvgNarration('题目', '答案', '解析', '<svg/>');
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'svg-narration' }));
        });
    });

    describe('splitQuestions', () => {
        it('图片分题时附带 image', async () => {
            await provider.splitQuestions({ kind: 'image', imageBase64: 'QUJD', mimeType: 'image/png', language: 'zh' });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'question-split',
                image: { base64: 'QUJD', mimeType: 'image/png' },
            }));
        });

        it('文字分题时不附带 image', async () => {
            await provider.splitQuestions({ kind: 'text', lines: ['第一行'], language: 'zh' });
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
                task: 'question-split',
                image: undefined,
            }));
        });
    });

    describe('fixQuestionText', () => {
        it('task 为 text-fix', async () => {
            await provider.fixQuestionText([{ id: 'q1', text: '原文' }]);
            expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'text-fix' }));
        });
    });
});
