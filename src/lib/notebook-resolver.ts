import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";
import { isNotebookSubject, stageFromEducationStage } from "@/lib/notebook-scope";

/**
 * 按学科名为用户找到错题本：先做包含匹配（如「数学」匹配「初二数学」），
 * 找不到时新建同名错题本（学段取用户的教育阶段，学科由名称推断）。并发导入同一学科时用 upsert 避免重复创建。
 */
export async function resolveNotebookForSubject(userId: string, subjectName: string, client: Prisma.TransactionClient = prisma): Promise<{ id: string; name: string }> {
    const name = subjectName.trim();
    const notebooks = await client.subject.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
    });

    const matched = notebooks.find((notebook) => notebook.name === name)
        || notebooks.find((notebook) => notebook.name.includes(name) || name.includes(notebook.name));
    if (matched) {
        return matched;
    }

    const user = await client.user.findUnique({ where: { id: userId }, select: { educationStage: true } });
    const subjectKey = inferSubjectFromName(name);
    try {
        return await client.subject.upsert({
            where: { name_userId: { name, userId } },
            update: {},
            create: {
                name,
                userId,
                stage: stageFromEducationStage(user?.educationStage),
                subjectKey: isNotebookSubject(subjectKey) ? subjectKey : null,
            },
            select: { id: true, name: true },
        });
    } catch (error) {
        // 并发创建同名错题本时，另一请求已创建成功，直接读取
        if ((error as { code?: string })?.code === 'P2002') {
            return client.subject.findUniqueOrThrow({
                where: { name_userId: { name, userId } },
                select: { id: true, name: true },
            });
        }
        throw error;
    }
}
