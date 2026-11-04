import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** 重复导入产生的记录不计入练习统计 */
export const EXCLUDE_DUPLICATE_IMPORT = { source: { not: 'duplicate_import' } } satisfies Prisma.PracticeRecordWhereInput;

/**
 * 校验 subjectId 是否属于当前用户；不属于时返回 null（当作未筛选）。
 */
export async function resolveStatsSubjectId(
    userId: string,
    subjectIdParam: string | null,
): Promise<{ id: string; name: string } | null> {
    if (!subjectIdParam) return null;
    const subject = await prisma.subject.findFirst({
        where: { id: subjectIdParam, userId },
        select: { id: true, name: true },
    });
    return subject;
}

/**
 * 练习统计的学科筛选条件：
 * 关联错题属于该学科，或没有关联错题但学科快照等于该学科名称。
 */
export function practiceSubjectWhere(
    subjectId: string,
    subjectName: string,
): Prisma.PracticeRecordWhereInput {
    return {
        OR: [
            { errorItem: { subjectId } },
            { errorItem: null, subject: subjectName },
        ],
    };
}
