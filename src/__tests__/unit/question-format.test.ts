/**
 * 题目交换格式 JSON v1 的单元测试：宽松解析、错误定位、规范化、上限、序列化往返。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
    MAX_QUESTIONS_PER_FILE,
    parseQuestionFile,
    questionFileToJson,
    serializeQuestions,
} from '@/lib/question-format';
import { structuredQuestionSchema } from '@/lib/question-format/schema';
import type { StructuredQuestion } from '@/lib/question-format';

/** 1x1 透明 PNG 的 base64 */
const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const validFile = {
    format: 'wrong-notebook-questions',
    version: 1,
    questions: [{ text: '计算：1+1=？' }],
};

describe('parseQuestionFile', () => {
    it('解析合法文件', () => {
        const result = parseQuestionFile(validFile);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe('计算：1+1=？');
    });

    it('根为数组时视为 questions 数组并给 warning', () => {
        const result = parseQuestionFile([{ text: 'a' }, { text: 'b' }]);
        expect(result.questions.map((q) => q.text)).toEqual(['a', 'b']);
        expect(result.warnings).toContain('MISSING_FORMAT');
        expect(result.warnings).toContain('MISSING_VERSION');
        expect(result.errors).toEqual([]);
    });

    it('缺 format 时给 warning 并按 v1 解析', () => {
        const result = parseQuestionFile({ version: 1, questions: [{ text: 'a' }] });
        expect(result.warnings).toContain('MISSING_FORMAT');
        expect(result.questions).toHaveLength(1);
    });

    it('缺 version 时给 warning', () => {
        const result = parseQuestionFile({ format: 'wrong-notebook-questions', questions: [{ text: 'a' }] });
        expect(result.warnings).toContain('MISSING_VERSION');
    });

    it('高版本给 UNSUPPORTED_VERSION warning 并尽力解析', () => {
        const result = parseQuestionFile({
            format: 'wrong-notebook-questions',
            version: 99,
            questions: [{ text: 'a', futureField: 'x' }],
        });
        expect(result.warnings).toContain('UNSUPPORTED_VERSION');
        expect(result.questions[0].text).toBe('a');
    });

    it('非对象非数组输入给整体错误 INVALID_QUESTION_SHAPE（index=-1）', () => {
        const result = parseQuestionFile('not-an-object');
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: 'INVALID_QUESTION_SHAPE' }]);
    });

    it('对象形态但 questions 缺失或不是数组时给整体错误 QUESTIONS_REQUIRED（index=-1）', () => {
        for (const bad of [{ format: 'wrong-notebook-questions', version: 1 }, { format: 'wrong-notebook-questions', version: 1, questions: 'not-array' }, { format: 'wrong-notebook-questions', version: 1, questions: 42 }]) {
            const result = parseQuestionFile(bad);
            expect(result.questions).toEqual([]);
            expect(result.errors).toEqual([{ index: -1, reason: 'QUESTIONS_REQUIRED' }]);
        }
    });

    it('format 存在但不匹配时给 UNKNOWN_FORMAT warning', () => {
        const result = parseQuestionFile({ format: 'other-format', version: 1, questions: [{ text: 'a' }] });
        expect(result.warnings).toContain('UNKNOWN_FORMAT');
        expect(result.warnings).not.toContain('MISSING_FORMAT');
        expect(result.questions).toHaveLength(1);
    });

    describe('逐题错误定位', () => {
        it('缺题干记 TEXT_REQUIRED，其余题照常返回', () => {
            const result = parseQuestionFile({
                questions: [{ answer: 'x' }, { text: 'ok' }, {}],
            });
            expect(result.questions.map((q) => q.text)).toEqual(['ok']);
            expect(result.errors).toEqual([
                { index: 0, reason: 'TEXT_REQUIRED' },
                { index: 2, reason: 'TEXT_REQUIRED' },
            ]);
        });

        it('题干超长记 TEXT_TOO_LONG', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a'.repeat(20001) }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'TEXT_TOO_LONG' }]);
        });

        it('解析超长记 ANALYSIS_TOO_LONG', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', analysis: 'b'.repeat(50001) }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'ANALYSIS_TOO_LONG' }]);
        });

        it('难度非法记 INVALID_DIFFICULTY', () => {
            for (const difficultyStars of [0, 6, 2.5, 'abc', {}, true]) {
                const result = parseQuestionFile({ questions: [{ text: 'a', difficultyStars }] });
                expect(result.errors).toEqual([{ index: 0, reason: 'INVALID_DIFFICULTY' }]);
            }
        });

        it('单题不是对象记 INVALID_QUESTION_SHAPE', () => {
            const result = parseQuestionFile({ questions: ['str', 42, null, ['arr']] });
            expect(result.errors).toHaveLength(4);
            for (const error of result.errors) expect(error.reason).toBe('INVALID_QUESTION_SHAPE');
        });
    });

    describe('规范化', () => {
        it('去首尾空白并省略空字符串字段', () => {
            const result = parseQuestionFile({
                questions: [
                    {
                        text: '  题干  ',
                        answer: '   ',
                        analysis: ' 解析 ',
                        subject: '',
                    },
                ],
            });
            expect(result.errors).toEqual([]);
            expect(result.questions[0]).toEqual({ text: '题干', analysis: '解析' });
        });

        it('knowledgePoints 接受分隔字符串并去空白', () => {
            const result = parseQuestionFile({
                questions: [{ text: 'a', knowledgePoints: '方程、函数，几何；三角;向量' }],
            });
            expect(result.questions[0].knowledgePoints).toEqual(['方程', '函数', '几何', '三角', '向量']);
        });

        it('knowledgePoints 空字符串视为缺省', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', knowledgePoints: '  ' }] });
            expect(result.questions[0].knowledgePoints).toBeUndefined();
        });

        it('knowledgePoints 元素非字符串记 INVALID_QUESTION_SHAPE', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', knowledgePoints: [1, 2] }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'INVALID_QUESTION_SHAPE' }]);
        });

        it('knowledgePoints 单点超长记 KNOWLEDGE_POINT_TOO_LONG', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', knowledgePoints: ['x'.repeat(201)] }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'KNOWLEDGE_POINT_TOO_LONG' }]);
        });

        it('difficultyStars 接受数字字符串', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', difficultyStars: ' 3 ' }] });
            expect(result.questions[0].difficultyStars).toBe(3);
        });

        it('空字符串 difficultyStars 视为缺省', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', difficultyStars: '' }] });
            expect(result.questions[0].difficultyStars).toBeUndefined();
        });
    });

    describe('图片校验', () => {
        it('接受合法 dataUrl 并保留 alt', () => {
            const result = parseQuestionFile({
                questions: [{ text: 'a', images: [{ dataUrl: TINY_PNG_DATA_URL, alt: ' 图 ' }] }],
            });
            expect(result.errors).toEqual([]);
            expect(result.questions[0].images).toEqual([{ dataUrl: TINY_PNG_DATA_URL, alt: '图' }]);
        });

        it('非法 dataUrl 记 INVALID_IMAGE_DATA_URL', () => {
            for (const dataUrl of [
                'data:image/gif;base64,xxxx',
                'data:image/png,xxxx',
                'https://example.com/a.png',
            ]) {
                const result = parseQuestionFile({ questions: [{ text: 'a', images: [{ dataUrl }] }] });
                expect(result.errors).toEqual([{ index: 0, reason: 'INVALID_IMAGE_DATA_URL' }]);
            }
        });

        it('超过 10 张图片记 TOO_MANY_IMAGES', () => {
            const images = Array.from({ length: 11 }, () => ({ dataUrl: TINY_PNG_DATA_URL }));
            const result = parseQuestionFile({ questions: [{ text: 'a', images }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'TOO_MANY_IMAGES' }]);
        });

        it('单张图片 dataUrl 超长记 IMAGE_TOO_LARGE', () => {
            const largeDataUrl = `${TINY_PNG_DATA_URL}${'A'.repeat(5 * 1024 * 1024)}`;
            const result = parseQuestionFile({ questions: [{ text: 'a', images: [{ dataUrl: largeDataUrl }] }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'IMAGE_TOO_LARGE' }]);
        });
    });

    describe('figureSvg 上限', () => {
        it('figureSvg 超过 100000 字符记 FIGURE_SVG_TOO_LONG', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', figureSvg: 'x'.repeat(100001) }] });
            expect(result.errors).toEqual([{ index: 0, reason: 'FIGURE_SVG_TOO_LONG' }]);
        });

        it('figureSvg 恰好 100000 字符可通过', () => {
            const result = parseQuestionFile({ questions: [{ text: 'a', figureSvg: 'x'.repeat(100000) }] });
            expect(result.errors).toEqual([]);
            expect(result.questions[0].figureSvg).toHaveLength(100000);
        });
    });

    describe('上限', () => {
        it('题目数超过 5000 截断并给 warning', () => {
            const questions = Array.from({ length: MAX_QUESTIONS_PER_FILE + 1 }, () => ({ text: 'a' }));
            const result = parseQuestionFile({ questions });
            expect(result.questions).toHaveLength(MAX_QUESTIONS_PER_FILE);
            expect(result.warnings).toContain('TOO_MANY_QUESTIONS');
            expect(result.errors).toEqual([]);
        });
    });

    it('未知字段忽略、extensions 原样保留', () => {
        const result = parseQuestionFile({
            questions: [{ text: 'a', unknownField: 1, extensions: { custom: { nested: true } } }],
        });
        expect(result.questions[0]).toEqual({
            text: 'a',
            extensions: { custom: { nested: true } },
        });
    });
});

describe('serializeQuestions', () => {
    it('生成规范 v1 对象并省略空字段', () => {
        const items: StructuredQuestion[] = [
            { text: 'a', answer: '', difficultyStars: 4, extensions: {} },
        ];
        const file = serializeQuestions(items, { generator: 'test' });
        expect(file.format).toBe('wrong-notebook-questions');
        expect(file.version).toBe(1);
        expect(file.generator).toBe('test');
        expect(file.questions[0]).toEqual({ text: 'a', difficultyStars: 4 });
    });

    it('questionFileToJson 使用 2 空格缩进', () => {
        const file = serializeQuestions([{ text: 'a' }]);
        const json = questionFileToJson(file);
        expect(json).toBe(JSON.stringify(file, null, 2));
        expect(json).toContain('\n  "format"');
    });

    it('serialize → parse 往返一致', () => {
        const items: StructuredQuestion[] = [
            {
                text: '题干',
                material: '材料',
                section: '大题',
                label: '3',
                answer: '答案',
                analysis: '解析',
                knowledgePoints: ['点1', '点2'],
                difficultyStars: 5,
                wrongAnswer: '错答',
                subject: '数学',
                gradeSemester: '七年级上',
                source: '2025 期中',
                questionType: '选择',
                images: [{ dataUrl: TINY_PNG_DATA_URL, alt: '图' }],
                extensions: { x: 1 },
            },
            { text: '只有题干' },
        ];
        const file = serializeQuestions(items, { generator: 'roundtrip', exportedAt: '2025-11-04T00:00:00.000Z' });
        const result = parseQuestionFile(JSON.parse(questionFileToJson(file)));
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.questions).toEqual(items);
    });
});

describe('文档示例与 JSON Schema 一致性', () => {
    const examplePath = join(process.cwd(), 'doc', 'schemas', 'questions-v1.example.json');
    const schemaPath = join(process.cwd(), 'doc', 'schemas', 'questions-v1.schema.json');

    it('完整示例可被解析且无错误', () => {
        const example = JSON.parse(readFileSync(examplePath, 'utf8')) as unknown;
        const result = parseQuestionFile(example);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.questions).toHaveLength(2);
    });

    it('zod schema 字段列表与 JSON Schema 一致', () => {
        const questionShape = structuredQuestionSchema._zod.def.shape as Record<string, unknown>;
        const zodFields = Object.keys(questionShape).sort();

        const schemaDoc = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
            properties: { questions: { items: { properties: Record<string, unknown> } } };
        };
        const jsonSchemaFields = Object.keys(schemaDoc.properties.questions.items.properties).sort();

        expect(zodFields).toEqual(jsonSchemaFields);
    });

    it('JSON Schema required 仅含 text', () => {
        const schemaDoc = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
            properties: { questions: { items: { required: string[] } } };
        };
        expect(schemaDoc.properties.questions.items.required).toEqual(['text']);
    });
});
