// Re-export the Zod-validated type from schema.ts
export type { ParsedQuestionFromSchema as ParsedQuestion } from './schema';
import type { ParsedQuestionFromSchema } from './schema';

// Import and re-export MistakeStatus from the single source of truth
import type { MistakeStatus } from '../mistake-status';
import type { NarrationSegment } from '../svg-animation';
export type { MistakeStatus };

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'harder';

/** 年级数字：1-6 小学，7-9 初中，10-12 高中 */
export type GradeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface ReanswerQuestionResult {
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: MistakeStatus;
    subject?: string; // AI 判断的学科，自定义模板未输出时为空
    difficultyStars?: number | null; // AI 评定的难度星级 1~5，未输出时为空
}

export type { FigureResult } from './schema';
export type { LatexFixInput, LatexFixResult } from './latex-fix';
import type { LatexFixInput, LatexFixResult } from './latex-fix';
import type { FigureResult } from './schema';

export interface GeogebraAnalysisResult {
    suitable: boolean;
    commands: string[];
    description: string;
}

export type PracticeResult = 'correct' | 'wrong' | 'not_attempted';

export interface MasteryHistoryEntry {
    date: string;            // ISO 时间
    difficulty: DifficultyLevel | string | null;
    result: PracticeResult;
    source: 'practice' | 'exam' | string;
}

export interface MasteryEvaluationInput {
    questionText: string;
    knowledgePoints: string[];
    mistakeStatus?: string | null;
    history: MasteryHistoryEntry[];
    ruleProbability: number; // 0~1，规则公式的参考值
    language?: 'zh' | 'en';
}

export interface AnswerGradingInput {
    questionText: string;
    answerText: string;
    analysis?: string | null;
    userAnswer: string;
    language?: 'zh' | 'en';
}

export interface AnswerGradingResult {
    correct: boolean;
    /** 一句话说明判定依据 */
    reason: string;
}

export interface MasteryEvaluationResult {
    probability: number; // 0~1
    reason: string;
}

export interface TagSuggestionInput {
    questionText: string;
    answerText?: string | null;
    analysis?: string | null;         // 解答过程
    wrongAnswerText?: string | null;  // 学生作答
    mistakeAnalysis?: string | null;  // 错因分析
    subject: string;          // 中文学科名，如「数学」
    allowedTags: string[];    // 可选知识点（标签库中的精确名称）
    gradeSemester?: string | null;
}

export type { TagSuggestionResult } from './schema';
import type { TagSuggestionResult } from './schema';

/** 交给 AI 的候选知识点：来自错题本的学段 + 学科，AI 只能从中选择 */
export interface CandidateTags {
    subjectName: string;   // 中文学科名，如「数学」
    tags: string[];
}

export interface AIService {
    analyzeImage(imageBase64: string, mimeType?: string, language?: 'zh' | 'en', grade?: GradeLevel | null, subject?: string | null, gradeSemester?: string | null, candidateTags?: CandidateTags): Promise<ParsedQuestionFromSchema>;
    /** originalFigureSvg：原题的 SVG 配图，新题需要配图时据此重新绘制 */
    generateSimilarQuestion(originalQuestion: string, knowledgePoints: string[], language?: 'zh' | 'en', difficulty?: DifficultyLevel, gradeSemester?: string | null, originalFigureSvg?: string | null): Promise<ParsedQuestionFromSchema>;
    /** 根据题目图片单独重绘配图 */
    generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult>;
    reanswerQuestion(questionText: string, language?: 'zh' | 'en', subject?: string | null, imageBase64?: string, gradeSemester?: string | null, candidateTags?: CandidateTags): Promise<ReanswerQuestionResult>;
    analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult>;
    /** 只修复各字段中的 LaTeX 语法，返回 AI 修复后的字段内容 */
    fixLatex(input: LatexFixInput): Promise<LatexFixResult>;
    /** 生成 SVG 动画讲解（已净化），无有效 SVG 时返回 null；figureSvg 为题目配图，language 决定动画中文字的语言 */
    generateSvgAnimation(questionText: string, answerText: string, analysis: string, figureSvg?: string | null, language?: 'zh' | 'en'): Promise<string | null>;
    /** 为已有的 SVG 动画补写语音讲解稿（画面不变），无有效讲解稿时返回 null；language 决定讲解的语言 */
    generateSvgNarration(questionText: string, answerText: string, analysis: string, svgAnimation: string, language?: 'zh' | 'en'): Promise<NarrationSegment[] | null>;
    evaluateMastery(input: MasteryEvaluationInput): Promise<MasteryEvaluationResult>;
    /** 对照标准答案判定学生答案是否正确 */
    gradeAnswer(input: AnswerGradingInput): Promise<AnswerGradingResult>;
    /** 从标签库中选知识点，并评定难度星级 */
    suggestKnowledgeTags(input: TagSuggestionInput): Promise<TagSuggestionResult>;
}

export interface AIConfig {
    apiKey?: string;
    /** 以 Authorization: Bearer 发送的令牌（OAuth 登录的渠道），仅 Anthropic 兼容接口使用 */
    authToken?: string;
    baseUrl?: string;
    model?: string;
    // Azure OpenAI 特有字段
    azureDeployment?: string;   // Azure 部署名称
    azureApiVersion?: string;   // API 版本 (如 2024-02-15-preview)
}
