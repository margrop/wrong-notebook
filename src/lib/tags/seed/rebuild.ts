import type { Prisma } from '@prisma/client';

/** 数学：年级 → 章 → 节 → 知识点 */
export type SectionedCurriculum = Record<string, Array<{ chapter: string; sections: Array<{ section: string; tags: string[] }> }>>;
/** 其他学科：年级 → 章 → 知识点 */
export type ChapterCurriculum = Record<string, Array<{ chapter: string; tags: string[] }>>;

/** 数学为四层（年级→章→节→知识点），其余学科为三层（年级→章→知识点） */
export async function seedMath(tx: Prisma.TransactionClient, curriculum: SectionedCurriculum, gradeOrder: Record<string, number>): Promise<number> {
    let count = 0;
    for (const [gradeSemester, chapters] of Object.entries(curriculum)) {
        const gradeNode = await tx.knowledgeTag.create({
            data: {
                name: gradeSemester,
                subject: 'math',
                parentId: null,
                isSystem: true,
                order: gradeOrder[gradeSemester] || 99,
            },
        });
        count++;

        for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
            const chapter = chapters[chapterIdx];
            const chapterNode = await tx.knowledgeTag.create({
                data: {
                    name: chapter.chapter,
                    subject: 'math',
                    parentId: gradeNode.id,
                    isSystem: true,
                    order: chapterIdx + 1,
                },
            });
            count++;

            for (let sectionIdx = 0; sectionIdx < chapter.sections.length; sectionIdx++) {
                const section = chapter.sections[sectionIdx];
                const sectionNode = await tx.knowledgeTag.create({
                    data: {
                        name: section.section,
                        subject: 'math',
                        parentId: chapterNode.id,
                        isSystem: true,
                        order: sectionIdx + 1,
                    },
                });
                count++;

                for (let tagIdx = 0; tagIdx < section.tags.length; tagIdx++) {
                    const tagName = section.tags[tagIdx];
                    await tx.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: 'math',
                            parentId: sectionNode.id,
                            isSystem: true,
                            order: tagIdx + 1,
                        },
                    });
                    count++;
                }
            }
        }
    }
    return count;
}

/** 标准学科（除数学外）：年级 → 章 → 知识点 三层结构 */
export async function seedStandardSubject(
    tx: Prisma.TransactionClient,
    subject: string,
    curriculum: ChapterCurriculum,
    gradeOrder: Record<string, number>,
): Promise<number> {
    let count = 0;
    for (const [gradeSemester, chapters] of Object.entries(curriculum)) {
        const gradeNode = await tx.knowledgeTag.create({
            data: {
                name: gradeSemester,
                subject,
                parentId: null,
                isSystem: true,
                order: gradeOrder[gradeSemester] || 99,
            },
        });
        count++;

        for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
            const chapter = chapters[chapterIdx];
            const chapterNode = await tx.knowledgeTag.create({
                data: {
                    name: chapter.chapter,
                    subject,
                    parentId: gradeNode.id,
                    isSystem: true,
                    order: chapterIdx + 1,
                },
            });
            count++;

            for (let tagIdx = 0; tagIdx < chapter.tags.length; tagIdx++) {
                const tagName = chapter.tags[tagIdx];
                await tx.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject,
                        parentId: chapterNode.id,
                        isSystem: true,
                        order: tagIdx + 1,
                    },
                });
                count++;
            }
        }
    }
    return count;
}
