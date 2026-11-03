import { ParsedQuestion } from "@/lib/ai/types";
import type { VendorConfig, VendorProviderId } from "@/lib/ai/vendor-presets";
import type { MiniMaxCodeConfig } from "@/lib/minimax-code/constants";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { TtsConfig } from "@/lib/tts/constants";

// 通用分页响应类型
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

/** 今日待复习列表中的错题，附带复习计划 */
export interface DueReviewItem extends ErrorItem {
    /** 当前所在轮次（从 0 开始），等于末尾连续做对的次数 */
    reviewStage: number;
    nextReviewAt: string;
}

export interface Tag {
    id: string;
    name: string;
    category: string;
    subject: string;
    subcategory?: string | null;
    createdAt: string;
    updatedAt: string;
    _count?: {
        errorItems: number;
    };
}

// AI Model types
export interface AIModel {
    id: string;
    name: string;
    owned_by?: string;
}

export interface ModelsResponse {
    models: AIModel[];
    error?: string;
}

export interface Notebook {
    id: string;
    name: string;
    stage?: string;              // 学段：primary / junior_high / senior_high
    subjectKey?: string | null;  // 学科：math / english 等
    tagSet?: string | null;      // 标签体系：default / cn-math-taxonomy 等
    userId: string;
    createdAt: string;
    updatedAt: string;
    _count?: {
        errorItems: number;
    };
}

export interface ErrorItem {
    id: string;
    shortId?: string | null;
    userId: string;
    subjectId?: string | null;
    subject?: Notebook | null;
    originalImageUrl: string;
    ocrText?: string | null;
    questionText?: string | null;
    answerText?: string | null;
    analysis?: string | null;
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    mistakeStatus?: 'not_attempted' | 'wrong_attempt' | 'unknown' | string | null;
    knowledgePoints?: string | null;

    source?: string | null;
    errorType?: string | null;
    userNotes?: string | null;
    tags?: Tag[];

    masteryLevel: number;
    /** 列表接口根据举一反三记录与掌握概率推导的复习状态 */
    masteryStatus?: MasteryStatus;
    masteryProbability?: number | null;
    masteryReason?: string | null;
    masterySource?: 'ai' | 'rule' | string | null;
    masteryEvaluatedAt?: string | null;
    gradeSemester?: string | null;
    paperLevel?: string | null;
    difficultyStars?: number | null; // 难度星级 1~5
    hasFigure?: boolean;             // 是否有配图
    figureSvg?: string | null;       // AI 重绘的 SVG 配图
    figureScale?: number;            // 配图显示与打印比例，默认 100%
    figureAlign?: 'left' | 'center' | 'right' | string; // 配图显示与打印位置，默认 center
    answerSpacePx?: number | null;   // 打印时手动设置的题下留白（px），为空时按全局档位

    createdAt: string;
    updatedAt: string;
}

/** 列表卡片数据；不包含原图、解答和动画等详情字段。 */
export type ErrorItemSummary = Pick<ErrorItem,
    'id' | 'shortId' | 'questionText' | 'mistakeStatus' | 'knowledgePoints' |
    'difficultyStars' | 'masteryStatus' | 'masteryProbability' | 'createdAt'
> & { tags?: Pick<Tag, 'name'>[] };

/** 打印所需内容，独立于完整详情与列表卡片的数据类型。 */
export type PrintableErrorItem = ErrorItemSummary & Pick<ErrorItem,
    'originalImageUrl' | 'answerText' | 'analysis' | 'figureSvg' | 'figureScale' | 'figureAlign' | 'answerSpacePx' | 'gradeSemester' | 'paperLevel'
> & { subject?: Pick<Notebook, 'name'> | null };

// For creation/updates
export interface CreateErrorItemRequest extends ParsedQuestion {
    originalImageUrl: string;
    figureScale?: number;
    figureAlign?: 'left' | 'center' | 'right';
    subjectId?: string;
    gradeSemester?: string | null;
    recognizedGradeSemester?: string | null;
    paperLevel?: string;
}

export type AnalyzeResponse = ParsedQuestion;

export interface QuestionSimilarityResponse {
    similarity: number;
    threshold: number;
    duplicate: boolean;
    items: { id: string; shortId: string | null; questionText: string; notebookName: string | null }[];
}

export interface UserProfile {
    id: string;
    email: string;
    name?: string | null;
    educationStage?: string | null;
    enrollmentYear?: number | null;
    role: string;
    isActive: boolean;
    confirmBeforeImport?: boolean;
    gradeRecognitionMode?: 'fixed' | 'ai';
    fixedGradeSemester?: string | null;
    enableGeogebra?: boolean;
    enableSvgAnimation?: boolean;
    /** 界面主题偏好：system / light / dark */
    themePreference?: string;
    questionDuplicateThreshold?: number;
    masteryThreshold?: number;
}

export interface UpdateUserProfileRequest {
    gradeRecognitionMode?: 'fixed' | 'ai';
    fixedGradeSemester?: string | null;
    questionDuplicateThreshold?: number;
    masteryThreshold?: number;
    name?: string;
    email?: string;
    educationStage?: string;
    enrollmentYear?: number;
    password?: string;
}

export interface OpenAIInstance {
    id: string;           // 唯一标识 (UUID)
    name: string;         // 用户自定义名称
    apiKey: string;
    baseUrl: string;
    model: string;
}

// MiniMax、GLM 等国产大模型官方渠道，每个渠道一组 { apiKey, baseUrl, model }
type VendorConfigs = { [K in VendorProviderId]?: VendorConfig };

export interface AppConfig extends VendorConfigs {
    aiProvider: 'gemini' | 'openai' | 'azure' | 'anthropic' | 'minimax-code' | VendorProviderId;
    allowRegistration?: boolean;
    /** 普通用户每天可发起的 AI 调用次数，0 表示不限制；管理员不受限制 */
    aiDailyLimit?: number;
    /** 同一模型同时进行的 AI 调用上限，超出的调用排队；默认 5 */
    aiConcurrencyLimit?: number;
    timeZone?: string;
    /** 管理员完成（或跳过）安装向导的时间，ISO 字符串；未设置时新安装会自动进入向导 */
    setupCompletedAt?: string;
    openai?: {
        instances?: OpenAIInstance[];
        activeInstanceId?: string;
    };
    gemini?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    azure?: {
        apiKey?: string;
        endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
        deploymentName?: string; // 部署名称
        apiVersion?: string;     // API 版本 (如 2024-02-15-preview)
        model?: string;          // 显示用模型名 (如 gpt-4o)
    };
    anthropic?: {
        apiKey?: string;
        baseUrl?: string;        // 不含 /v1，如 https://api.anthropic.com
        model?: string;
    };
    minimaxCode?: MiniMaxCodeConfig;
    prompts?: {
        analyze?: string;
        similar?: string;
    };
    timeouts?: {
        analyze?: number; // 毫秒
    };
    /** 动画语音讲解的朗读方式：浏览器本地语音或云端语音合成 */
    tts?: TtsConfig;
}


export type StatsRange = '7d' | '30d' | '6m' | 'all';

export interface AnalyticsData {
    totalErrors: number;
    newCount: number;
    reviewingCount: number;
    masteredCount: number;
    masteryRate: number;
    subjectStats: { name: string; value: number }[];
    /** 错因分布：按 mistakeStatus 分组（not_attempted / wrong_attempt / unknown） */
    mistakeStatusStats: { name: string; value: number }[];
    /** 错误类型分布：按 errorType 分组，自由文本取前 7 个，其余合并为 __other__ */
    errorTypeStats: { name: string; value: number }[];
    /** 难度分布：按 difficultyStars 分组，始终返回 1~5 星，未评定（null）数量大于 0 时附加 */
    difficultyStarsStats: { stars: number | null; total: number; mastered: number }[];
    activityData: { date: string; count: number; added: number; mastered: number }[];
    range: StatsRange;
    granularity: 'day' | 'month';
}

export interface PracticeStatsData {
    subjectStats: { name: string; value: number }[];
    activityStats: { date: string; total: number; correct: number;[key: string]: number | string }[];
    difficultyStats: { name: string; value: number }[];
    overallStats: { total: number; correct: number; attempted: number; rate: string };
    activeDays: number;
    range: StatsRange;
    granularity: 'day' | 'month';
}

/** 学习活动热力图数据 */
export interface ActivityStatsData {
    days: { date: string; errors: number; practices: number }[];
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
    subjectId?: string;
    subjectName?: string;
}

/** 薄弱知识点排行中的一条 */
export interface WeakTagItem {
    tag: string;
    tagSet: string;
    subjectId: string | null;
    subjectName: string;
    total: number;
    unmastered: number;
    recentAttempted: number;
    recentCorrect: number;
    recentErrorRate: number;
    unmasteredRatio: number;
}

export interface WeakTagsData {
    weakTags: WeakTagItem[];
    range: StatsRange;
    subjectId?: string;
    subjectName?: string;
}

export interface TagStats {
    tag: string;
    count: number;
    /** 学科标识，如 math */
    subject: string;
    /** 标签体系，default 为内置体系 */
    tagSet: string;
    /** 计入该条统计的标签 ID（同一体系、学科下的同名标签） */
    tagIds: string[];
}

export interface TagStatsResponse {
    stats: TagStats[];
}

export interface TagSuggestionsResponse {
    suggestions: string[];
}

export interface AdminUser extends UserProfile {
    createdAt: string;
    _count: {
        errorItems: number;
        practiceRecords: number;
    };
    /** 今日发起的 AI 调用次数 */
    aiUsageToday: number;
}

export interface AdminDashboardData {
    overview: {
        totalUsers: number;
        totalErrorItems: number;
        totalPracticeRecords: number;
        totalSubjects: number;
    };
    userStats: AdminUserStats[];
    subjectDistribution: { name: string; count: number }[];
    dailyTrend: { date: string; count: number }[];
    masteryDistribution: {
        new: number;
        reviewing: number;
        mastered: number;
    };
}

export interface AdminUserStats {
    id: string;
    name: string | null;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: string;
    educationStage: string | null;
    enrollmentYear: number | null;
    errorCount: number;
    practiceCount: number;
    notebookCount: number;
}

export interface AdminUserDetail {
    user: {
        id: string;
        name: string | null;
        email: string;
        role: string;
        isActive: boolean;
        createdAt: string;
        educationStage: string | null;
        enrollmentYear: number | null;
    };
    notebooks: { id: string; name: string; errorCount: number }[];
    errorCount: number;
    practiceCount: number;
    notebookCount: number;
    recent7DaysCount: number;
    masteryDistribution: {
        new: number;
        reviewing: number;
        mastered: number;
    };
    subjectDistribution: { name: string; count: number }[];
    recentErrorItems: {
        id: string;
        questionText: string | null;
        ocrText: string | null;
        masteryStatus: MasteryStatus;
        createdAt: string;
        subject: { name: string } | null;
    }[];
}

export interface RegisterRequest {
    name: string;
    email: string;
    password: string;
    educationStage: string;
    enrollmentYear: number;
}

// ============ 举一反三记录与掌握概率 ============

export type PracticeResult = 'correct' | 'wrong' | 'not_attempted';

export interface PracticeHistoryRecord {
    id: string;
    result: PracticeResult | string;
    difficulty?: string | null;
    source: string;
    questionText?: string | null;
    answerText?: string | null;
    analysis?: string | null;
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    originalImageUrl?: string | null;
    figureSvg?: string | null;
    createdAt: string;
    exam: { paperId: string; order: number; title: string } | null;
}

export interface PracticeHistoryResponse {
    masteryLevel: number;
    masteryStatus: MasteryStatus;
    masteryProbability: number | null;
    masteryReason: string | null;
    masterySource: string | null;
    masteryEvaluatedAt: string | null;
    /** 当前用户的已掌握阈值（百分比） */
    masteryThreshold: number;
    records: PracticeHistoryRecord[];
}

// ============ 错题试卷 ============

export type ExamScope = 'unmastered' | 'mastered' | 'all';
export type ExamPickRule = 'least_practiced' | 'random';
export type ExamStatus = 'generating' | 'ready' | 'partial' | 'failed';
export type ExamMode = 'generate' | 'original';

export interface ExamPaperSummary {
    id: string;
    title: string;
    status: ExamStatus;
    scope: ExamScope;
    difficulty: string;
    mode: ExamMode;
    requestedCount: number;
    questionCount: number;
    readyCount: number;
    recordedCount: number;
    resultsRecordedAt: string | null;
    createdAt: string;
}

export interface ExamQuestionDetail {
    id: string;
    order: number;
    errorItemId: string | null;
    sourceShortId: string;
    status: 'pending' | 'ready' | 'failed';
    questionText: string | null;
    answerText: string | null;
    analysis: string | null;
    figureSvg?: string | null;
    figureScale?: number;
    figureAlign?: 'left' | 'center' | 'right' | string;
    /** 打印时手动设置的题下留白（px），为空时按全局档位 */
    answerSpacePx?: number | null;
    error: string | null;
    notebookName: string | null;
    /** 历次录入的结果，按时间正序 */
    attempts: ExamQuestionAttempt[];
}

export interface ExamQuestionAttempt {
    id: string;
    result: PracticeResult;
    createdAt: string;
}

export interface ExamPaperDetail {
    id: string;
    title: string;
    status: ExamStatus;
    scope: ExamScope;
    difficulty: string;
    mode: ExamMode;
    requestedCount: number;
    resultsRecordedAt: string | null;
    createdAt: string;
    questions: ExamQuestionDetail[];
}
