/**
 * AI 提示词生成器单元测试
 * 测试提示词模板变量替换和生成逻辑
 */
import { describe, it, expect } from 'vitest';
import {
    generateAnalyzePrompt,
    generateSimilarQuestionPrompt,
    generateReanswerPrompt,
    generateMasteryPrompt,
    generateGradingPrompt,
    generateTagSuggestPrompt,
    generateFigurePrompt,
    generateGradeInstruction,
    gradeSemesterToDisplayName,
    gradeSemesterToGradeNumber,
    DEFAULT_ANALYZE_TEMPLATE,
    DEFAULT_SIMILAR_TEMPLATE,
    DEFAULT_REANSWER_TEMPLATE,
} from '@/lib/ai/prompts';

describe('AI Prompts', () => {
    describe('默认模板存在性', () => {
        it('应该导出 DEFAULT_ANALYZE_TEMPLATE', () => {
            expect(DEFAULT_ANALYZE_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_ANALYZE_TEMPLATE).toBe('string');
            expect(DEFAULT_ANALYZE_TEMPLATE.length).toBeGreaterThan(100);
        });

        it('应该导出 DEFAULT_SIMILAR_TEMPLATE', () => {
            expect(DEFAULT_SIMILAR_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_SIMILAR_TEMPLATE).toBe('string');
        });

        it('应该导出 DEFAULT_REANSWER_TEMPLATE', () => {
            expect(DEFAULT_REANSWER_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_REANSWER_TEMPLATE).toBe('string');
        });
    });

    describe('generateAnalyzePrompt', () => {
        it('要求判断是否有配图并用 SVG 重绘', () => {
            const prompt = generateAnalyzePrompt('zh', 7, '数学');
            expect(prompt).toContain('<has_figure>');
            expect(prompt).toContain('<figure_svg>');
            expect(prompt).toContain('14 个 XML 标签');
            expect(prompt).toContain('严禁使用 <image>、<script>');
        });

        it('单独重绘配图的提示词带上题干用于核对标注', () => {
            const prompt = generateFigurePrompt('如图，AB=3');
            expect(prompt).toContain('如图，AB=3');
            expect(prompt).toContain('<figure_svg>');
            expect(generateFigurePrompt(null)).toContain('（无题目文字）');
        });

        it('提供错题本候选知识点时只列出这些标签，不再按学科、年级取标签', () => {
            const prompt = generateAnalyzePrompt('zh', 4, '数学', {
                candidateTags: { subjectName: '数学', tags: ['鸡兔同笼', '植树问题'] },
                prefetchedMathTags: ['不应出现的年级标签'],
            });
            expect(prompt).toContain('**数学标签:**');
            expect(prompt).toContain('"鸡兔同笼", "植树问题"');
            expect(prompt).not.toContain('不应出现的年级标签');
        });

        it('应该生成中文提示词', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('中文');
            expect(typeof prompt).toBe('string');
        });

        it('应该生成英文提示词', () => {
            const prompt = generateAnalyzePrompt('en');
            expect(prompt).toContain('English');
            expect(typeof prompt).toBe('string');
        });

        it('应该包含学科提示（如果提供）', () => {
            const prompt = generateAnalyzePrompt('zh', null, '数学');
            expect(prompt).toContain('数学');
        });

        it('应该根据年级过滤数学标签（初一）', () => {
            const prompt = generateAnalyzePrompt('zh', 7, '数学');
            // 初一应该只包含七年级的标签
            expect(prompt).toBeDefined();
        });

        it('应该根据年级过滤数学标签（初三）', () => {
            const prompt = generateAnalyzePrompt('zh', 9, '数学');
            // 初三应该包含七、八、九年级的累进标签
            expect(prompt).toBeDefined();
        });

        it('应该根据年级过滤数学标签（高一）', () => {
            const prompt = generateAnalyzePrompt('zh', 10, '数学');
            expect(prompt).toBeDefined();
        });

        it('应该支持自定义选项 (providerHints)', () => {
            const prompt = generateAnalyzePrompt('zh', null, null, {
                providerHints: '请特别注意 LaTeX 格式',
            });
            expect(prompt).toContain('请特别注意 LaTeX 格式');
        });

        it('应该支持自定义模板', () => {
            const customTemplate = '自定义模板 {{language_instruction}}';
            const prompt = generateAnalyzePrompt('zh', null, null, {
                customTemplate,
            });
            expect(prompt).toContain('自定义模板');
            // language_instruction 会被替换为实际的语言指令（包含 Chinese）
            expect(prompt).toContain('Chinese');
        });

        it('生成的提示词不应包含未替换的变量占位符', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学');
            // 检查常见的占位符是否已被替换
            expect(prompt).not.toContain('{{language_instruction}}');
            expect(prompt).not.toContain('{{tag_list}}');
            expect(prompt).not.toContain('{{provider_hints}}');
        });

        it('应该要求 AI 输出错因分析相关 XML 标签并过滤人的思考和草稿', () => {
            const prompt = generateAnalyzePrompt('zh', null, '数学');
            expect(prompt).toContain('<wrong_answer_text>');
            expect(prompt).toContain('<mistake_status>');
            expect(prompt).toContain('<mistake_analysis>');
            expect(prompt).toContain('wrong_attempt');
            expect(prompt).toContain('not_attempted');
            expect(prompt).toContain('unknown');
            expect(prompt).toContain('【过滤草稿与思考过程规则】');
            expect(prompt).toContain('必须过滤掉图片中人的思考过程、手写草稿');
            expect(prompt).not.toContain('草稿或错误答案，请尽量按原样摘录');
        });
    });

    describe('generateSimilarQuestionPrompt', () => {
        it('原题有配图时附上原题 SVG，并要求按新题数据重新绘制', () => {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
            const prompt = generateSimilarQuestionPrompt('zh', '如图求面积', ['面积'], 'medium', { originalFigureSvg: svg });
            expect(prompt).toContain('<figure_svg>');
            expect(prompt).toContain(svg);
            expect(prompt).toContain('重新绘制');
            const noFigure = generateSimilarQuestionPrompt('zh', '1+1=?', ['加法'], 'medium');
            expect(noFigure).toContain('原题没有配图');
            expect(noFigure).not.toContain('{{figure_instruction}}');
        });

        const originalQuestion = '已知 x + y = 5，求 x² + y² 的最小值';
        const knowledgePoints = ['一元二次方程', '最值问题'];

        it('应该生成中文类似题提示词', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt).toContain(originalQuestion);
            expect(prompt).toContain('中文');
        });

        it('应该生成英文类似题提示词', () => {
            const prompt = generateSimilarQuestionPrompt('en', originalQuestion, knowledgePoints);
            expect(prompt).toContain(originalQuestion);
            expect(prompt).toContain('English');
        });

        it('应该包含知识点列表', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt).toContain('一元二次方程');
            expect(prompt).toContain('最值问题');
        });

        it('应该根据难度级别调整提示词', () => {
            const easyPrompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, 'easy');
            const hardPrompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, 'hard');

            expect(easyPrompt.toUpperCase()).toContain('EASY');
            expect(hardPrompt.toUpperCase()).toContain('HARD');
        });

        it('应该支持所有难度级别', () => {
            const difficulties = ['easy', 'medium', 'hard', 'harder'] as const;

            difficulties.forEach(difficulty => {
                const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, difficulty);
                expect(prompt).toBeDefined();
                expect(typeof prompt).toBe('string');
            });
        });

        it('默认难度应该是 MEDIUM', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt.toUpperCase()).toContain('MEDIUM');
        });
    });

    describe('generateReanswerPrompt', () => {
        it('提供错题本候选知识点时要求只从中选择，否则不出现该约束', () => {
            const withTags = generateReanswerPrompt('zh', '鸡兔同笼', '数学', { candidateTags: { subjectName: '数学', tags: ['鸡兔同笼'] } });
            expect(withTags).toContain('只能从以下数学知识点中选择');
            expect(withTags).toContain('"鸡兔同笼"');
            expect(generateReanswerPrompt('zh', '鸡兔同笼', '数学')).not.toContain('只能从以下');
            expect(generateReanswerPrompt('zh', '鸡兔同笼', '数学')).not.toContain('{{knowledge_points_rule}}');
        });

        const questionText = '求解方程 2x + 3 = 7';

        it('应该生成中文重新解题提示词', () => {
            const prompt = generateReanswerPrompt('zh', questionText);
            expect(prompt).toContain(questionText);
            expect(prompt).toContain('中文');
        });

        it('应该生成英文重新解题提示词', () => {
            const prompt = generateReanswerPrompt('en', questionText);
            expect(prompt).toContain(questionText);
            expect(prompt).toContain('English');
        });

        it('应该包含学科提示（如果提供）', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).toContain('数学');
        });

        it('应该支持自定义 provider hints', () => {
            const prompt = generateReanswerPrompt('zh', questionText, null, {
                providerHints: '输出格式要求',
            });
            expect(prompt).toContain('输出格式要求');
        });

        it('生成的提示词不应包含未替换的变量占位符', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).not.toContain('{{question_text}}');
            expect(prompt).not.toContain('{{language_instruction}}');
            expect(prompt).not.toContain('{{provider_hints}}');
        });

        it('重新解题提示词应该要求同步输出新的错因分析', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).toContain('<wrong_answer_text>');
            expect(prompt).toContain('<mistake_status>');
            expect(prompt).toContain('<mistake_analysis>');
            expect(prompt).toContain('重新判断');
        });

        it('重新解题提示词不应允许无依据推断学生错因，并要求过滤草稿和思考过程', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).not.toContain('推断');
            expect(prompt).toContain('不要猜测');
            expect(prompt).toContain('当前图片中可见');
            expect(prompt).toContain('【过滤草稿与思考过程规则】');
            expect(prompt).not.toContain('草稿或错误答案，请尽量按原样摘录');
        });
    });

    describe('模板变量替换', () => {
        it('应该正确处理多行文本', () => {
            const multiLineQuestion = `第一行
第二行
第三行`;
            const prompt = generateReanswerPrompt('zh', multiLineQuestion);
            expect(prompt).toContain('第一行');
            expect(prompt).toContain('第三行');
        });

        it('应该正确处理特殊字符', () => {
            const questionWithSpecialChars = '求解 x² + y² = r² 的圆的面积（其中 r > 0）';
            const prompt = generateReanswerPrompt('zh', questionWithSpecialChars);
            expect(prompt).toContain('x²');
            expect(prompt).toContain('r > 0');
        });
    });

    describe('gradeSemesterToDisplayName', () => {
        it('应该转换 primary_3 为 小学三年级', () => {
            expect(gradeSemesterToDisplayName('primary_3')).toBe('小学三年级');
        });

        it('应该转换 junior_high_2 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('junior_high_2')).toBe('初中二年级');
        });

        it('应该转换 senior_high_1 为 高中一年级', () => {
            expect(gradeSemesterToDisplayName('senior_high_1')).toBe('高中一年级');
        });

        it('应该转换 初一 为 初中一年级', () => {
            expect(gradeSemesterToDisplayName('初一')).toBe('初中一年级');
        });

        it('应该转换 初二上 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('初二上')).toBe('初中二年级');
        });

        it('应该转换 高一 为 高中一年级', () => {
            expect(gradeSemesterToDisplayName('高一')).toBe('高中一年级');
        });

        it('应该转换 七年级 为 初中一年级', () => {
            expect(gradeSemesterToDisplayName('七年级')).toBe('初中一年级');
        });

        it('应该转换 八年级上 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('八年级上')).toBe('初中二年级');
        });

        it('空字符串应返回 null', () => {
            expect(gradeSemesterToDisplayName('')).toBeNull();
        });

        it('无法识别的格式应返回 null', () => {
            expect(gradeSemesterToDisplayName('unknown_format')).toBeNull();
        });
    });

    describe('gradeSemesterToGradeNumber', () => {
        it('应该转换 初一 为 7', () => {
            expect(gradeSemesterToGradeNumber('初一')).toBe(7);
        });

        it('应该转换 初二 为 8', () => {
            expect(gradeSemesterToGradeNumber('初二')).toBe(8);
        });

        it('应该转换 高一 为 10', () => {
            expect(gradeSemesterToGradeNumber('高一')).toBe(10);
        });

        it('应该转换 junior_high_1 为 7', () => {
            expect(gradeSemesterToGradeNumber('junior_high_1')).toBe(7);
        });

        it('小学应返回 null', () => {
            expect(gradeSemesterToGradeNumber('primary_3')).toBeNull();
        });

        it('空字符串应返回 null', () => {
            expect(gradeSemesterToGradeNumber('')).toBeNull();
        });
    });

    describe('generateGradeInstruction', () => {
        it('无 gradeSemester 时返回空字符串', () => {
            expect(generateGradeInstruction()).toBe('');
            expect(generateGradeInstruction(null)).toBe('');
            expect(generateGradeInstruction('')).toBe('');
        });

        it('有效的 gradeSemester 应生成约束指令', () => {
            const instruction = generateGradeInstruction('初二上');
            expect(instruction).toContain('学历约束');
            expect(instruction).toContain('初中二年级');
            expect(instruction).toContain('禁止使用超纲知识');
        });

        it('无法识别的 gradeSemester 应返回空字符串', () => {
            expect(generateGradeInstruction('unknown_format')).toBe('');
        });
    });

    describe('gradeSemester 学历约束注入', () => {
        it('analyze 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学', undefined, '初二上');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('初中二年级');
        });

        it('analyze 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学');
            expect(prompt).not.toContain('学历约束');
        });

        it('similar 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateSimilarQuestionPrompt('zh', '1+1=?', ['算术'], 'medium', undefined, 'primary_3');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('小学三年级');
        });

        it('similar 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateSimilarQuestionPrompt('zh', '1+1=?', ['算术']);
            expect(prompt).not.toContain('学历约束');
        });

        it('reanswer 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateReanswerPrompt('zh', '1+1=?', '数学', undefined, '高一');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('高中一年级');
        });

        it('reanswer 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateReanswerPrompt('zh', '1+1=?', '数学');
            expect(prompt).not.toContain('学历约束');
        });

        it('analyze 提示词不应包含未替换的 grade_instruction 占位符', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学', undefined, '初二上');
            expect(prompt).not.toContain('{{grade_instruction}}');
        });
    });

    describe('表格处理指令', () => {
        it('analyze 提示词应包含表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('表格处理规则');
            expect(prompt).toContain('Markdown 表格语法');
        });

        it('表格处理规则应包含标准表格示例', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('| 列标题1 | 列标题2 | 列标题3 |');
            expect(prompt).toContain('|---------|---------|---------|');
        });

        it('表格处理规则应包含复杂表格处理说明', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('复杂表格');
            expect(prompt).toContain('合并单元格');
            expect(prompt).toContain('多级表头');
        });

        it('表格处理规则应要求完整性', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('表格完整性要求');
            expect(prompt).toContain('必须转录所有单元格内容');
            expect(prompt).toContain('保留表格标题、单位、注释');
        });

        it('表格处理规则应包含特殊情况处理', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('特殊情况处理');
            expect(prompt).toContain('手写表格');
            expect(prompt).toContain('模糊表格');
        });

        it('answer_text 应引用表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('<answer_text>');
            expect(prompt).toMatch(/<answer_text>[\s\S]*表格处理规则[\s\S]*<\/answer_text>/);
        });

        it('analysis 应引用表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('<analysis>');
            expect(prompt).toMatch(/<analysis>[\s\S]*表格处理规则[\s\S]*<\/analysis>/);
        });
    });
});

describe('掌握概率与学科相关提示词', () => {
    it('掌握概率提示词包含练习历史、知识点和规则参考值', () => {
        const prompt = generateMasteryPrompt({
            questionText: '求 x',
            knowledgePoints: ['方程', '移项'],
            mistakeStatus: 'not_attempted',
            history: [
                { date: '2026-10-01T08:00:00.000Z', difficulty: 'easy', result: 'wrong', source: 'practice' },
                { date: '2026-10-05T08:00:00.000Z', difficulty: 'harder', result: 'correct', source: 'exam' },
            ],
            ruleProbability: 0.456,
        });

        expect(prompt).toContain('求 x');
        expect(prompt).toContain('方程、移项');
        expect(prompt).toContain('1. 2026-10-01｜难度：简单｜来源：单题练习｜结果：做错');
        expect(prompt).toContain('2. 2026-10-05｜难度：挑战｜来源：试卷｜结果：做对');
        expect(prompt).toContain('46%');
        expect(prompt).toContain('【最初的错误情况】\n不会做');
    });

    it('重新解题提示词要求输出学科标签', () => {
        const prompt = generateReanswerPrompt('zh', '1+1=?');
        expect(prompt).toContain('<subject>');
        expect(prompt).toContain('10 个 XML 标签');
        expect(prompt).toContain('<difficulty_stars>');
        expect(prompt).toContain('<question_type>');
    });
});

describe('知识点重新标注提示词', () => {
    it('包含题目、可选知识点和学生年级，不含超纲限制', () => {
        const prompt = generateTagSuggestPrompt({
            questionText: '鸡兔同笼，共 10 个头 28 条腿',
            answerText: '鸡 6 兔 4',
            subject: '数学',
            allowedTags: ['鸡兔同笼', '植树问题'],
            gradeSemester: '四年级上',
        });

        expect(prompt).toContain('鸡兔同笼，共 10 个头 28 条腿');
        expect(prompt).toContain('"鸡兔同笼"、"植树问题"');
        expect(prompt).toContain('【学生年级】');
        expect(prompt).toContain('数学老师');
        expect(prompt).not.toContain('禁止使用超纲知识');
    });

    it('题目与解答过程、学生作答、错因分析一并交给 AI', () => {
        const prompt = generateTagSuggestPrompt({
            questionText: '鸡兔同笼，共 10 个头 28 条腿',
            answerText: '鸡 6 兔 4',
            analysis: '假设全是鸡，则有 20 条腿，少 8 条，每只兔多 2 条腿，兔有 4 只',
            wrongAnswerText: '鸡 4 兔 6',
            mistakeAnalysis: '把鸡和兔的数量算反',
            subject: '数学',
            allowedTags: ['假设法解鸡兔同笼'],
        });

        expect(prompt).toContain('【解答过程】\n假设全是鸡，则有 20 条腿');
        expect(prompt).toContain('【学生作答】\n鸡 4 兔 6');
        expect(prompt).toContain('【错因分析】\n把鸡和兔的数量算反');
        expect(prompt).not.toContain('{{');
    });

    it('缺少解答过程时以「（无）」占位', () => {
        const prompt = generateTagSuggestPrompt({ questionText: '1+1=?', subject: '数学', allowedTags: ['加法'] });
        expect(prompt).toContain('【解答过程】\n（无）');
        expect(prompt).toContain('【学生作答】\n（无）');
    });

    it('提示词同时要求输出题型 key（与识别提示词的 question_type 一致）', () => {
        const prompt = generateTagSuggestPrompt({
            questionText: '下列说法正确的是（　）A.… B.…',
            subject: '数学',
            allowedTags: ['加法'],
        });
        expect(prompt).toContain('【题型规则】');
        expect(prompt).toContain('single_choice');
        expect(prompt).toContain('questionType');
        expect(prompt).toContain('"questionType": "single_choice"');
    });
});


describe('按题型判题', () => {
    it('证明题检查论证，同时保留等价答案与其他正确解法', () => {
        const prompt = generateGradingPrompt({ questionText: '证明两个底角相等', answerText: '两角相等', userAnswer: '两角相等' });
        expect(prompt).toContain('只有结论而没有证明不能判对');
        expect(prompt).toContain('接受正确的其他解法');
        expect(prompt).toContain('核对答案是否等价');
        expect(prompt).not.toContain('只看最终结论');
        expect(prompt).toContain('【学生答案】\n两角相等');
    });
});
