/**
 * fromErrorItem 纯函数单元测试：字段映射、空题干跳过、includeImages 开关、图片上限。
 */
import { describe, expect, it } from 'vitest';
import { fromErrorItem } from '@/lib/question-format/from-error-item';
import { parseQuestionFile } from '@/lib/question-format';
import type { ErrorItemExportSource } from '@/lib/question-format/from-error-item';
import { MAX_IMAGE_DATA_URL_LENGTH } from '@/lib/question-format';

/** 1x1 透明 PNG 的 base64 */
const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 构造一个最小可用的 ErrorItemExportSource */
function makeSource(overrides: Partial<ErrorItemExportSource> = {}): ErrorItemExportSource {
    return {
        id: 'item-1',
        questionText: '计算：1+1=？',
        answerText: '2',
        analysis: '基础加法',
        wrongAnswerText: '3',
        difficultyStars: 3,
        questionType: 'fill_blank',
        gradeSemester: '初一，上期',
        source: '期中考试',
        figureSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        originalImageUrl: '',
        subjectName: '数学',
        tags: [{ name: '整数加法' }, { name: '计算' }],
        ...overrides,
    };
}

describe('fromErrorItem', () => {
    it('空题干返回 null', () => {
        expect(fromErrorItem(makeSource({ questionText: '' }))).toBeNull();
        expect(fromErrorItem(makeSource({ questionText: '   ' }))).toBeNull();
        expect(fromErrorItem(makeSource({ questionText: null }))).toBeNull();
        expect(fromErrorItem(makeSource({ questionText: undefined }))).toBeNull();
    });

    it('完整字段映射正确', () => {
        const result = fromErrorItem(makeSource());
        expect(result).not.toBeNull();
        expect(result!.text).toBe('计算：1+1=？');
        expect(result!.answer).toBe('2');
        expect(result!.analysis).toBe('基础加法');
        expect(result!.wrongAnswer).toBe('3');
        expect(result!.difficultyStars).toBe(3);
        expect(result!.questionType).toBe('fill_blank');
        expect(result!.gradeSemester).toBe('初一，上期');
        expect(result!.source).toBe('期中考试');
        expect(result!.figureSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
        expect(result!.subject).toBe('数学');
        expect(result!.knowledgePoints).toEqual(['整数加法', '计算']);
    });

    it('可选字段为空时省略', () => {
        const result = fromErrorItem(makeSource({
            answerText: null,
            analysis: null,
            wrongAnswerText: null,
            difficultyStars: null,
            gradeSemester: null,
            source: null,
            figureSvg: null,
            subjectName: null,
            tags: [],
        }));
        expect(result).not.toBeNull();
        expect(result!.text).toBe('计算：1+1=？');
        expect(result!.answer).toBeUndefined();
        expect(result!.analysis).toBeUndefined();
        expect(result!.wrongAnswer).toBeUndefined();
        expect(result!.difficultyStars).toBeUndefined();
        expect(result!.gradeSemester).toBeUndefined();
        expect(result!.source).toBeUndefined();
        expect(result!.figureSvg).toBeUndefined();
        expect(result!.subject).toBeUndefined();
        expect(result!.knowledgePoints).toBeUndefined();
    });

    it('difficultyStars 为 null 时不写入', () => {
        const result = fromErrorItem(makeSource({ difficultyStars: null }));
        expect(result!.difficultyStars).toBeUndefined();
    });

    it('includeImages=false 时不导出图片', () => {
        const result = fromErrorItem(makeSource({ originalImageUrl: TINY_PNG_DATA_URL }), false);
        expect(result!.images).toBeUndefined();
    });

    it('includeImages=true 且 originalImageUrl 是 data:image/png 时放入 images', () => {
        const result = fromErrorItem(makeSource({ originalImageUrl: TINY_PNG_DATA_URL }), true);
        expect(result!.images).toEqual([{ dataUrl: TINY_PNG_DATA_URL }]);
    });

    it('includeImages=true 但 originalImageUrl 不是 data URL 时不放入 images', () => {
        const result = fromErrorItem(makeSource({ originalImageUrl: 'https://example.com/img.png' }), true);
        expect(result!.images).toBeUndefined();
    });

    it('includeImages=true 但 originalImageUrl 是 data:image/gif 时不放入 images', () => {
        const result = fromErrorItem(
            makeSource({ originalImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
            true,
        );
        expect(result!.images).toBeUndefined();
    });

    it('includeImages=true 但图片超过单图上限时跳过', () => {
        const bigImage = `data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}`;
        const result = fromErrorItem(makeSource({ originalImageUrl: bigImage }), true);
        expect(result!.images).toBeUndefined();
    });

    it('原始题干有首尾空白时保留原样（由序列化器处理）', () => {
        const result = fromErrorItem(makeSource({ questionText: '  计算：1+1=？  ' }));
        expect(result!.text).toBe('  计算：1+1=？  ');
    });

    it('输出能被 parseQuestionFile 无错误解析（往返）', () => {
        const item = fromErrorItem(makeSource({ originalImageUrl: TINY_PNG_DATA_URL }), true)!;
        const parseResult = parseQuestionFile({
            format: 'wrong-notebook-questions',
            version: 1,
            questions: [item],
        });
        expect(parseResult.errors).toEqual([]);
        expect(parseResult.questions).toHaveLength(1);
        expect(parseResult.questions[0].text).toBe('计算：1+1=？');
        expect(parseResult.questions[0].answer).toBe('2');
        expect(parseResult.questions[0].knowledgePoints).toEqual(['整数加法', '计算']);
        expect(parseResult.questions[0].images).toEqual([{ dataUrl: TINY_PNG_DATA_URL }]);
    });
});
