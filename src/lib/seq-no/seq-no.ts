import "server-only";

import type { Prisma } from "@prisma/client";

export { formatSeqNo, parseSeqNoQuery, questionNoLabel } from "@/lib/seq-no/seq-no-format";

/** 为用户分配下一个错题流水号；须在创建错题的同一事务内调用，计数器原子自增，并发保存不会重号 */
export async function allocateSeqNo(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const user = await tx.user.update({
        where: { id: userId },
        data: { errorItemSeq: { increment: 1 } },
        select: { errorItemSeq: true },
    });
    return user.errorItemSeq;
}

/**
 * 导入备份时为错题确定流水号：备份中的编号仍空闲则保留，否则分配新编号。
 * 保留旧编号后把用户计数器推进到不小于该编号，之后新建的错题不会撞号。
 */
export async function resolveImportedSeqNo(tx: Prisma.TransactionClient, userId: string, seqNo: unknown): Promise<number> {
    if (typeof seqNo === "number" && Number.isInteger(seqNo) && seqNo > 0) {
        const taken = await tx.errorItem.findUnique({ where: { userId_seqNo: { userId, seqNo } }, select: { id: true } });
        if (!taken) {
            await tx.user.updateMany({ where: { id: userId, errorItemSeq: { lt: seqNo } }, data: { errorItemSeq: seqNo } });
            return seqNo;
        }
    }
    return allocateSeqNo(tx, userId);
}
