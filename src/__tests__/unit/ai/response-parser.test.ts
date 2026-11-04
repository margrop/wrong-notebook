/**
 * response-parser 单元测试
 *
 * 覆盖 extractTag / splitKnowledgePoints / parseQuestionResponse 的边界情况：
 * - 正常标签提取
 * - analysis 截断（缺少闭合标签）
 * - 其他标签缺少闭合标签返回 null
 * - 空标签内容返回 null
 * - thinking 标签过滤
 * - 必需标签缺失抛错
 * - subject / requiresImage / knowledgePoints 默认值
 */
import { describe, it, expect } from 'vitest';
import { extractTag, splitKnowledgePoints, parseQuestionResponse } from '@/lib/ai/response-parser';

describe('extractTag', () => {
    it('提取基本标签内容', () => {
        expect(extractTag('<test>content</test>', 'test')).toBe('content');
    });

    it('去除首尾空格', () => {
        expect(extractTag('<test>  content  </test>', 'test')).toBe('content');
    });

    it('支持多行内容', () => {
        const text = '<test>\nline 1\nline 2\n</test>';
        expect(extractTag(text, 'test')).toBe('line 1\nline 2');
    });

    it('标签不存在时返回 null', () => {
        expect(extractTag('<other>x</other>', 'test')).toBeNull();
    });

    it('只有开始标签时返回 null（analysis 除外）', () => {
        expect(extractTag('<test>content', 'test')).toBeNull();
    });

    it('空标签内容返回 null', () => {
        expect(extractTag('<test></test>', 'test')).toBeNull();
    });

    it('analysis 缺少闭合标签时读取到文本末尾', () => {
        const text = '<analysis>二次函数开口向上';
        expect(extractTag(text, 'analysis')).toBe('二次函数开口向上');
    });

    it('analysis 有闭合标签时正常提取', () => {
        expect(extractTag('<analysis>完整</analysis>', 'analysis')).toBe('完整');
    });

    it('过滤 thinking 标签后再提取', () => {
        const text = '<thinking>推理过程</thinking><test>content</test>';
        expect(extractTag(text, 'test')).toBe('content');
    });

    it('取最后一个闭合标签之前的内容', () => {
        const text = '<test>a</test>some text<test>b</test>';
        expect(extractTag(text, 'test')).toBe('a</test>some text<test>b');
    });
});

describe('splitKnowledgePoints', () => {
    it('英文逗号分隔', () => {
        expect(splitKnowledgePoints('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('中文逗号分隔', () => {
        expect(splitKnowledgePoints('甲，乙，丙')).toEqual(['甲', '乙', '丙']);
    });

    it('换行分隔', () => {
        expect(splitKnowledgePoints('a\nb\nc')).toEqual(['a', 'b', 'c']);
    });

    it('混合分隔', () => {
        expect(splitKnowledgePoints('a, b，c\nd')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('null 或 undefined 返回空数组', () => {
        expect(splitKnowledgePoints(null)).toEqual([]);
        expect(splitKnowledgePoints(undefined)).toEqual([]);
    });

    it('空字符串返回空数组', () => {
        expect(splitKnowledgePoints('')).toEqual([]);
    });

    it('过滤空片段', () => {
        expect(splitKnowledgePoints('a,,b,  ,c')).toEqual(['a', 'b', 'c']);
    });
});

describe('parseQuestionResponse', () => {
    const BASE_XML = [
        '<question_text>求函数 f(x) = x^2 的最小值</question_text>',
        '<answer_text>最小值为 0</answer_text>',
        '<analysis>这是一个二次函数,开口向上,顶点在原点,因此最小值为 0</analysis>',
    ].join('\n');

    it('解析完整标签的所有字段', () => {
        const xml = [
            BASE_XML,
            '<subject>数学</subject>',
            '<knowledge_points>二次函数, 函数最值</knowledge_points>',
            '<requires_image>true</requires_image>',
            '<grade_semester>四年级上</grade_semester>',
            '<difficulty_stars>3</difficulty_stars>',
        ].join('\n');

        const result = parseQuestionResponse(xml);
        expect(result.questionText).toBe('求函数 f(x) = x^2 的最小值');
        expect(result.answerText).toBe('最小值为 0');
        expect(result.analysis).toContain('二次函数');
        expect(result.subject).toBe('数学');
        expect(result.knowledgePoints).toEqual(['二次函数', '函数最值']);
        expect(result.requiresImage).toBe(true);
        expect(result.gradeSemester).toBe('四年级上');
        expect(result.difficultyStars).toBe(3);
    });

    it('缺少必需标签时抛错', () => {
        expect(() => parseQuestionResponse('<question_text>只有题目</question_text>')).toThrow(
            'Missing critical XML tags'
        );
    });

    it('缺少 subject 时默认为其他', () => {
        expect(parseQuestionResponse(BASE_XML).subject).toBe('其他');
    });

    it('无效 subject 时默认为其他', () => {
        const xml = BASE_XML + '<subject>天文</subject>';
        expect(parseQuestionResponse(xml).subject).toBe('其他');
    });

    it('requires_image 非 true 时默认为 false', () => {
        expect(parseQuestionResponse(BASE_XML + '<requires_image>false</requires_image>').requiresImage).toBe(false);
        expect(parseQuestionResponse(BASE_XML).requiresImage).toBe(false);
    });

    it('缺少 knowledge_points 时默认为空数组', () => {
        expect(parseQuestionResponse(BASE_XML).knowledgePoints).toEqual([]);
    });

    it('analysis 截断时读取到文本末尾', () => {
        const xml = [
            '<question_text>题目</question_text>',
            '<answer_text>答案</answer_text>',
            '<analysis>解析被截断',
        ].join('\n');
        const result = parseQuestionResponse(xml);
        expect(result.analysis).toBe('解析被截断');
    });

    it('错因相关可选标签缺失时使用默认值', () => {
        const result = parseQuestionResponse(BASE_XML);
        expect(result.wrongAnswerText).toBe('');
        expect(result.mistakeAnalysis).toBe('');
        expect(result.mistakeStatus).toBe('unknown');
    });

    it('wrongAnswerText 存在时 mistakeStatus 强制为 wrong_attempt', () => {
        const xml = BASE_XML + '<wrong_answer_text>错误答案</wrong_answer_text>';
        expect(parseQuestionResponse(xml).mistakeStatus).toBe('wrong_attempt');
    });
});
