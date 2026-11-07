import type { Prisma } from '@prisma/client';
// Docker 与安装包构建时用 tsc 单独编译种子脚本（不读取 tsconfig 路径别名），本文件及其依赖只能用相对路径导入
import { UNIVERSITY_GRADES, UNIVERSITY_SUBJECTS } from '../data/university';

/**
 * 增量补齐各学科的大学年级根节点（大一 ~ 大四），不建章节点和知识点。
 * 保留已有节点与题目关联；重复执行不会重复创建。
 */
export async function seedUniversityGrades(tx: Prisma.TransactionClient, subjects: readonly string[] = UNIVERSITY_SUBJECTS): Promise<number> {
    let created = 0;
    for (const subject of subjects) {
        for (const [index, name] of UNIVERSITY_GRADES.entries()) {
            const existing = await tx.knowledgeTag.findFirst({
                where: { subject, name, parentId: null, isSystem: true, userId: null, tagSet: 'default' },
                select: { id: true, order: true },
            });
            const order = 13 + index;
            if (existing) {
                if (existing.order !== order) {
                    await tx.knowledgeTag.update({ where: { id: existing.id }, data: { order } });
                }
                continue;
            }
            await tx.knowledgeTag.create({
                data: { name, subject, parentId: null, isSystem: true, tagSet: 'default', order },
            });
            created++;
        }
    }
    return created;
}