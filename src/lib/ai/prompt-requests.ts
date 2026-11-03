import { GRADE_SEMESTERS } from '../grade-options';
import { embedNarration, getSvgAnimationDuration } from '../svg-animation';
import {
    createPromptRequest, promptDataReference as ref,
    generateAnalyzePrompt, generateSimilarQuestionPrompt, generateReanswerPrompt,
    generateGeogebraPrompt, generateMasteryPrompt, generateGradingPrompt,
    generateTagSuggestPrompt, generateFigurePrompt, generateSvgAnimationPrompt,
    generateSvgNarrationPrompt, generateLatexFixPrompt, generateGradeRecognitionPrompt, generateQuestionSplitPrompt,
    generateTextFixPrompt,
    SVG_ANIMATION_REQUEST, SVG_NARRATION_REQUEST,
} from './prompts';
import type { PromptOptions, PromptRequest, LatexFixField } from './prompts';
import type { AnswerGradingInput, GradeLevel, MasteryEvaluationInput, TagSuggestionInput } from './types';
import type { LatexFixInput } from './latex-fix';
import type { QuestionSplitInput } from './question-split';
import type { TextFixInput } from './text-fix';

// 只有受限的控制值可以进入系统规则；所有自由文本通过 JSON 数据消息传递。
function safeGrade(value?: string | null): string | null {
    if (!value) return null;
    if (GRADE_SEMESTERS.includes(value)) return value;
    return /^(?:(?:primary_[1-6]|junior_high_[1-3]|senior_high_[1-3])|(?:小学)?[一二三四五六]年级|[七八九]年级|初[一二三]|高[一二三])[上下]?$/.test(value) ? value : null;
}

function safeSubject(value?: string | null): string | null {
    return value && ['数学', '物理', '化学', '生物', '英语', '语文', '历史', '地理', '政治', '其他'].includes(value) ? value : null;
}

/** 保留候选清单是否存在、是否为空的信息，清单正文始终放在用户消息里。 */
function inputOptions(options: PromptOptions): Record<string, unknown> {
    return Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'customTemplate' && key !== 'providerHints'));
}

function referenceOptions(options: PromptOptions): PromptOptions {
    const result = { ...options };
    const fields = ['prefetchedMathTags', 'prefetchedPhysicsTags', 'prefetchedChemistryTags', 'prefetchedBiologyTags', 'prefetchedEnglishTags'] as const;
    for (const field of fields) {
        if (options[field]) result[field] = options[field].length ? [ref('tagOptions.' + field)] : [];
    }
    if (options.candidateTags) {
        result.candidateTags = {
            subjectName: safeSubject(options.candidateTags.subjectName) || '本题学科',
            tags: options.candidateTags.tags.length ? [ref('tagOptions.candidateTags.tags')] : [],
        };
    }
    result.originalFigureSvg = options.originalFigureSvg ? ref('tagOptions.originalFigureSvg') : null;
    return result;
}

export function generateAnalyzeRequest(language: 'zh' | 'en', grade?: GradeLevel | null, subject?: string | null, options: PromptOptions = {}, gradeSemester?: string | null): PromptRequest {
    return createPromptRequest(
        generateAnalyzePrompt(language, grade, safeSubject(subject), referenceOptions(options), safeGrade(gradeSemester)),
        { subject, gradeSemester, tagOptions: inputOptions(options) },
    );
}

export function generateSimilarQuestionRequest(language: 'zh' | 'en', originalQuestion: string, knowledgePoints: string[], difficulty: 'easy' | 'medium' | 'hard' | 'harder' = 'medium', options: PromptOptions = {}, gradeSemester?: string | null): PromptRequest {
    const safeDifficulty = ['easy', 'medium', 'hard', 'harder'].includes(difficulty) ? difficulty : 'medium';
    return createPromptRequest(
        generateSimilarQuestionPrompt(language, ref('originalQuestion'), [ref('knowledgePoints')], safeDifficulty, referenceOptions(options), safeGrade(gradeSemester)),
        { originalQuestion, knowledgePoints, difficulty: safeDifficulty, gradeSemester, tagOptions: inputOptions(options) },
    );
}

export function generateReanswerRequest(language: 'zh' | 'en', questionText: string, subject?: string | null, options: PromptOptions = {}, gradeSemester?: string | null): PromptRequest {
    return createPromptRequest(
        generateReanswerPrompt(language, ref('questionText'), safeSubject(subject), referenceOptions(options), safeGrade(gradeSemester)),
        { questionText, subject, gradeSemester, tagOptions: inputOptions(options) },
    );
}

export function generateGradeRecognitionRequest(questionText: string): PromptRequest {
    return createPromptRequest(generateGradeRecognitionPrompt(ref('questionText')), { questionText });
}

export function generateGradingRequest(input: AnswerGradingInput): PromptRequest {
    return createPromptRequest(generateGradingPrompt({
        questionText: ref('questionText'), answerText: ref('answerText'), analysis: ref('analysis'),
        userAnswer: ref('userAnswer'), language: input.language,
    }), { ...input });
}

export function generateMasteryRequest(input: MasteryEvaluationInput): PromptRequest {
    const evaluatedAt = input.evaluatedAt || new Date().toISOString();
    const system = generateMasteryPrompt({
        ...input, evaluatedAt, questionText: ref('questionText'), knowledgePoints: [ref('knowledgePoints')], history: [],
        mistakeStatus: ['wrong_attempt', 'not_attempted'].includes(input.mistakeStatus || '') ? input.mistakeStatus : 'unknown',
    }).replace('暂无练习记录', () => ref('history'));
    return createPromptRequest(system, {
        ...input, evaluatedAt,
        history: input.history.map(entry => ({
            ...entry,
            daysAgo: Number.isFinite(Date.parse(entry.date))
                ? Math.max(0, Math.floor((Date.parse(evaluatedAt) - Date.parse(entry.date)) / 86_400_000)) : null,
        })),
    });
}

export function generateTagSuggestRequest(input: TagSuggestionInput): PromptRequest {
    return createPromptRequest(generateTagSuggestPrompt({
        questionText: ref('questionText'), answerText: ref('answerText'), analysis: ref('analysis'),
        wrongAnswerText: ref('wrongAnswerText'), mistakeAnalysis: ref('mistakeAnalysis'),
        subject: safeSubject(input.subject) || '本题学科', allowedTags: [ref('allowedTags')], gradeSemester: safeGrade(input.gradeSemester),
    }), { ...input });
}

export function generateFigureRequest(questionText?: string | null): PromptRequest {
    return createPromptRequest(generateFigurePrompt(ref('questionText')), { questionText });
}

export function generateGeogebraRequest(questionText: string, answerText: string, analysis: string, previousErrors?: string): PromptRequest {
    return createPromptRequest(generateGeogebraPrompt(ref('questionText'), ref('answerText'), ref('analysis'), previousErrors ? ref('previousErrors') : undefined), { questionText, answerText, analysis, previousErrors });
}

export function generateLatexFixRequest(input: LatexFixInput): PromptRequest {
    const references: LatexFixInput = {};
    for (const field of Object.keys(input) as LatexFixField[]) {
        references[field] = { text: ref('fields.' + field + '.text'), issues: [ref('fields.' + field + '.issues')] };
    }
    return createPromptRequest(generateLatexFixPrompt(references), { fields: input });
}

export function generateSvgAnimationRequest(questionText: string, answerText: string, analysis: string, figureSvg?: string | null, language: 'zh' | 'en' = 'zh'): PromptRequest {
    return createPromptRequest(generateSvgAnimationPrompt(ref('questionText'), ref('answerText'), ref('analysis'), figureSvg ? ref('figureSvg') : null, language), { questionText, answerText, analysis, figureSvg }, SVG_ANIMATION_REQUEST[language]);
}

export function generateSvgNarrationRequest(questionText: string, answerText: string, analysis: string, svgAnimation: string, language: 'zh' | 'en' = 'zh'): PromptRequest {
    return createPromptRequest(generateSvgNarrationPrompt(ref('questionText'), ref('answerText'), ref('analysis'), ref('svgAnimation'), language, getSvgAnimationDuration(svgAnimation)), { questionText, answerText, analysis, svgAnimation: embedNarration(svgAnimation, null) }, SVG_NARRATION_REQUEST[language]);
}

/** 分题请求：文字按行编号放入 data.lines；图片分题的图片由提供商作为图片内容块随本请求发送 */
export function generateQuestionSplitRequest(input: QuestionSplitInput): PromptRequest {
    if (input.kind === 'text') {
        return createPromptRequest(
            generateQuestionSplitPrompt('text'),
            { lines: input.lines.map((text, index) => ({ n: index + 1, text })) },
            '请按系统规则把 data.lines 中的文字分成独立的题目，只输出 JSON。',
        );
    }
    return createPromptRequest(
        generateQuestionSplitPrompt('image'),
        {},
        '请按系统规则找出图片中的每一道题及其位置，只输出 JSON。',
    );
}

/** 修正题目文字：题目放在 data.questions，系统规则中不含任何题目文字 */
export function generateTextFixRequest(input: TextFixInput): PromptRequest {
    return createPromptRequest(
        generateTextFixPrompt(),
        { questions: input.map(({ id, text }) => ({ id, text })) },
        '请按系统规则逐题整理 data.questions 中的题目文字，只输出 JSON。',
    );
}
