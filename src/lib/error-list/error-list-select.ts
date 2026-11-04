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

/**
 * 打印按需读取配图和解答，仍不读取动画与历史练习。
 * 原图不随列表返回，由列表接口换成懒加载的图片接口链接。
 */
export const ERROR_ITEM_PRINT_SELECT = {
    ...ERROR_ITEM_LIST_SELECT,
    updatedAt: true,
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

/** 打印预览中原图的懒加载地址；带更新时间，原图替换后浏览器缓存自动失效 */
export function printImageUrl(id: string, updatedAt: Date): string {
    return `/api/error-items/${encodeURIComponent(id)}/image?v=${updatedAt.getTime()}`;
}

