import type { Prisma } from '@prisma/client';
import { PRACTICE_RECORD_COUNT } from '@/lib/mastery-status';

/** 列表卡片所需字段，避免从 SQLite 读取并传输原图、解答和动画等大字段。 */
export const ERROR_ITEM_LIST_SELECT = {
    id: true,
    shortId: true,
    questionText: true,
    mistakeStatus: true,
    knowledgePoints: true,
    difficultyStars: true,
    masteryProbability: true,
    createdAt: true,
    tags: { select: { name: true } },
    _count: PRACTICE_RECORD_COUNT,
} satisfies Prisma.ErrorItemSelect;

/** 打印按需读取原图、配图和解答，仍不读取动画与历史练习。 */
export const ERROR_ITEM_PRINT_SELECT = {
    ...ERROR_ITEM_LIST_SELECT,
    originalImageUrl: true,
    answerText: true,
    analysis: true,
    figureSvg: true,
    figureScale: true,
    figureAlign: true,
    answerSpacePx: true,
    gradeSemester: true,
    paperLevel: true,
    subject: { select: { name: true } },
} satisfies Prisma.ErrorItemSelect;
