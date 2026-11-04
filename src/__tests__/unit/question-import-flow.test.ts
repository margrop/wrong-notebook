/**
 * 题目导入流程纯函数：阶段列表、目标错题本、请求参数构造、响应解析
 */
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/translations';
import type { RenderedImage } from '@/lib/image-pipeline';
import {
    buildCreateTaskParams,
    buildImageBatchParams,
    buildStageList,
    buildTextBatchParams,
    buildTextReanswerBody,
    MAX_QUESTION_PARTS,
    parseReanswerResponse,
    resolveTargetSubjectId,
    toStackedBatchImage,
} from '@/lib/import/question-import-flow';
import type { BatchImage } from '@/lib/import/question-import-flow';

vi.mock('@/lib/image-pipeline', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/image-pipeline')>()),
    renderRegion: vi.fn(),
}));

const t = translations.zh;

const rendered: RenderedImage = {
    dataUrl: 'data:image/jpeg;base64,BBBB', width: 2000, height: 1500,
    bytes: 500_000, quality: 0.9, timings: { crop: 20, compress: 100 },
};

function batchImage(patch: Partial<BatchImage> = {}): BatchImage {
    return {
        dataUrl: 'data:image/jpeg;base64,AAAA',
        info: {
            sourceType: 'image/jpeg', sourceBytes: 3_000_000, sourceWidth: 4000, sourceHeight: 3000,
            outputWidth: 2000, outputHeight: 1500, outputBytes: 500_000, quality: 0.9, decoder: 'native',
        },
        timings: { read: 10, convert: 0, crop: 20, compress: 100 },
        ...patch,
    };
}

describe('resolveTargetSubjectId', () => {
    it('固定错题本优先于其他设置', () => {
        expect(resolveTargetSubjectId({ fixedSubjectId: 'nb-fixed', confirmBeforeImport: false, importSubjectId: 'nb-import' }))
            .toBe('nb-fixed');
    });

    it('免确认时放入指定错题本', () => {
        expect(resolveTargetSubjectId({ confirmBeforeImport: false, importSubjectId: 'nb-import' })).toBe('nb-import');
    });

    it('校对时（confirmBeforeImport）由用户选择，返回 null', () => {
        expect(resolveTargetSubjectId({ confirmBeforeImport: true, importSubjectId: 'nb-import' })).toBeNull();
        expect(resolveTargetSubjectId({ fixedSubjectId: 'nb-fixed', confirmBeforeImport: true, importSubjectId: 'nb-import' }))
            .toBe('nb-fixed');
    });

    it('未指定时为 null', () => {
        expect(resolveTargetSubjectId({ confirmBeforeImport: false })).toBeNull();
    });
});

describe('buildStageList', () => {
    it('读取阶段始终存在且默认为 0', () => {
        expect(buildStageList({}, t)).toEqual([{ label: t.upload.stages.read, ms: 0 }]);
    });

    it('有转换耗时时追加转换阶段', () => {
        expect(buildStageList({ read: 5, convert: 8 }, t)).toEqual([
            { label: t.upload.stages.read, ms: 5 },
            { label: t.upload.stages.convert, ms: 8 },
        ]);
    });

    it('压缩阶段耗时含裁剪耗时', () => {
        expect(buildStageList({ read: 5, crop: 7, compress: 9 }, t)).toEqual([
            { label: t.upload.stages.read, ms: 5 },
            { label: t.upload.stages.compress, ms: 16 },
        ]);
    });
});

describe('toStackedBatchImage', () => {
    it('按各段累计耗时与字节数，标注 stacked 段数', () => {
        const parts: BatchImage[] = [
            batchImage({ timings: { read: 10, convert: 5, crop: 20, compress: 100 }, info: { ...batchImage().info, sourceBytes: 1000 } }),
            batchImage({ timings: { read: 8, convert: 3, crop: 10, compress: 60 }, info: { ...batchImage().info, sourceBytes: 500 } }),
        ];
        const result = toStackedBatchImage(parts, rendered);
        expect(result.dataUrl).toBe(rendered.dataUrl);
        expect(result.info).toMatchObject({
            sourceType: 'stacked-2', sourceBytes: 1500,
            outputWidth: 2000, outputHeight: 1500, outputBytes: 500_000, quality: 0.9,
        });
        expect(result.timings).toEqual({ read: 18, convert: 8, crop: 50, compress: 260 });
    });
});

describe('buildCreateTaskParams', () => {
    it('组装上传参数：图片、语言、识别参考错题本与目标错题本', () => {
        const image = batchImage();
        const params = buildCreateTaskParams(image, {
            language: 'zh', analyzeSubjectId: 'nb-analyze', confirmBeforeImport: false, importSubjectId: 'nb-import',
        });
        expect(params).toEqual({
            imageBase64: image.dataUrl,
            language: 'zh',
            subjectId: 'nb-analyze',
            targetSubjectId: 'nb-import',
            clientTimings: image.timings,
            imageInfo: image.info,
        });
    });
});

describe('buildTextBatchParams', () => {
    it('文字批次带上分题方式与强制编号', () => {
        const params = buildTextBatchParams(
            { text: '1+1=? 2+2=?', splitter: 'ai', forceNumbered: true, language: 'zh', analyzeSubjectId: null, textNotebookId: 'nb-text' },
            { confirmBeforeImport: false, importSubjectId: 'nb-import' },
        );
        expect(params).toEqual({
            source: 'text',
            splitter: 'ai',
            forceNumbered: true,
            text: '1+1=? 2+2=?',
            language: 'zh',
            subjectId: 'nb-text',
            targetSubjectId: 'nb-import',
        });
    });

    it('forceNumbered 为 false 时不传该字段', () => {
        const params = buildTextBatchParams(
            { text: 'x', splitter: 'local', language: 'en' },
            { confirmBeforeImport: true },
        );
        expect(params.forceNumbered).toBeUndefined();
        expect(params.targetSubjectId).toBeNull();
    });

    it('识别参考错题本优先于文字解题参考错题本', () => {
        const params = buildTextBatchParams(
            { text: 'x', splitter: 'local', language: 'zh', analyzeSubjectId: 'nb-analyze', textNotebookId: 'nb-text' },
            { confirmBeforeImport: false },
        );
        expect(params.subjectId).toBe('nb-analyze');
    });
});

describe('buildImageBatchParams', () => {
    it('照片自动分题批次带上裁剪后的图片信息', () => {
        const image = batchImage();
        const params = buildImageBatchParams(image, { language: 'zh', analyzeSubjectId: 'nb-analyze', confirmBeforeImport: true });
        expect(params).toEqual({
            source: 'image',
            imageBase64: image.dataUrl,
            imageInfo: image.info,
            language: 'zh',
            subjectId: 'nb-analyze',
            targetSubjectId: null,
        });
    });
});

describe('buildTextReanswerBody', () => {
    it('携带题目文本、语言、导入标记与参考错题本', () => {
        expect(buildTextReanswerBody({ questionText: '1+1=?', language: 'zh', textNotebook: { id: 'nb-1', name: '数学' } }))
            .toEqual({ questionText: '1+1=?', language: 'zh', forImport: true, subject: '数学', subjectId: 'nb-1' });
    });

    it('未指定错题本时不带 subject 字段', () => {
        expect(buildTextReanswerBody({ questionText: 'q', language: 'en' }))
            .toEqual({ questionText: 'q', language: 'en', forImport: true, subject: undefined, subjectId: undefined });
    });
});

describe('parseReanswerResponse', () => {
    it('规范化作答状态与学科，缺失字段补默认值', () => {
        const result = parseReanswerResponse({
            answerText: '2', analysis: '加法', knowledgePoints: ['加法'],
            wrongAnswerText: '3', mistakeAnalysis: '算错', mistakeStatus: 'bogus', subject: '数学',
        }, '1+1=?');
        expect(result).toEqual({
            questionText: '1+1=?',
            answerText: '2',
            analysis: '加法',
            knowledgePoints: ['加法'],
            wrongAnswerText: '3',
            mistakeAnalysis: '算错',
            mistakeStatus: 'unknown',
            subject: '数学',
            requiresImage: false,
            difficultyStars: null,
            questionType: null,
            gradeSemester: null,
        });
    });

    it('AI 给出题型时透传，缺失时为 null', () => {
        const withType = parseReanswerResponse({
            answerText: '2', analysis: 'a', knowledgePoints: [], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'wrong_attempt',
            questionType: 'single_choice',
        }, 'q');
        expect(withType.questionType).toBe('single_choice');
        const withoutType = parseReanswerResponse({
            answerText: '2', analysis: 'a', knowledgePoints: [], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'wrong_attempt',
        }, 'q');
        expect(withoutType.questionType).toBeNull();
    });

    it('学科缺失时回退为「其他」', () => {
        const result = parseReanswerResponse({
            answerText: '2', analysis: 'a', knowledgePoints: [], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'wrong_attempt',
        }, 'q');
        expect(result.subject).toBe('其他');
        expect(result.mistakeStatus).toBe('wrong_attempt');
    });
});

describe('MAX_QUESTION_PARTS', () => {
    it('一道题最多分 4 段拍摄', () => {
        expect(MAX_QUESTION_PARTS).toBe(4);
    });
});
