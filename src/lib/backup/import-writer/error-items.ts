/**
 * 导入步骤：卷别分组（paperGroups）预导入与错题（error items）写入。
 */
import { generateUniqueShortId, isShortId } from "@/lib/short-id/short-id";
import { findDuplicateQuestion, recordDuplicateQuestion } from "@/lib/question/question-deduplication";
import { getDefaultPaperLevelGroupId, ensureDefaultPaperGroups } from "@/lib/paper-level";
import type { NormalizedErrorItem } from "@/lib/backup/import-parser";
import type { ImportContext } from "./types";

/** 4.0 预导入卷别分组（paperGroups），建立 id 映射 */
export async function importPaperGroups(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, paperGroupIdMap } = ctx;
    for (const group of normalized.paperGroups) {
        const targetUserId = importAll ? group.userId : user.id;
        const existing = await tx.paperGroup.findFirst({
            where: { id: group.id, userId: targetUserId },
        });
        if (existing) {
            paperGroupIdMap.set(group.id, existing.id);
        } else {
            // 按 name 匹配，避免重复创建
            const byName = await tx.paperGroup.findFirst({
                where: { name: group.name, userId: targetUserId },
            });
            if (byName) {
                paperGroupIdMap.set(group.id, byName.id);
            } else {
                const created = await tx.paperGroup.create({
                    data: {
                        userId: targetUserId,
                        key: group.key,
                        name: group.name,
                        order: group.order || 0,
                        isActive: group.isActive !== false,
                    },
                });
                paperGroupIdMap.set(group.id, created.id);
            }
        }
    }
}

/** 兼容旧版备份：为每个有错题的用户确保默认分组存在 */
async function ensureLegacyPaperGroups(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, legacyLevelMap } = ctx;
    for (const item of normalized.errorItems) {
        const targetUserId = importAll ? item.raw.userId : user.id;
        if (!legacyLevelMap.has(`${targetUserId}:a`)) {
            const defaults = await ensureDefaultPaperGroups(targetUserId, tx);
            legacyLevelMap.set(`${targetUserId}:a`, defaults.a || "");
            legacyLevelMap.set(`${targetUserId}:b`, defaults.b || "");
            legacyLevelMap.set(`${targetUserId}:other`, defaults.other || "");
        }
    }
}

/** 解析 paperLevel：优先查 paperGroupIdMap，其次查 legacyLevelMap，最后按星级推荐 */
async function resolvePaperLevel(
    ctx: ImportContext,
    targetUserId: string,
    rawPaperLevel: string | null,
    difficultyStars: number | null,
): Promise<string | null> {
    const { tx, paperGroupIdMap, legacyLevelMap } = ctx;
    let resolved: string | null = null;
    if (rawPaperLevel) {
        if (paperGroupIdMap.has(rawPaperLevel)) {
            resolved = paperGroupIdMap.get(rawPaperLevel)!;
        } else if (legacyLevelMap.has(`${targetUserId}:${rawPaperLevel}`)) {
            resolved = legacyLevelMap.get(`${targetUserId}:${rawPaperLevel}`) || null;
        } else {
            // 尝试按 id 直接查（同用户）
            const direct = await tx.paperGroup.findFirst({
                where: { id: rawPaperLevel, userId: targetUserId },
            });
            resolved = direct?.id || null;
        }
    }
    if (!resolved && difficultyStars !== null) {
        resolved = await getDefaultPaperLevelGroupId(targetUserId, difficultyStars, tx);
    }
    return resolved;
}

/** 关联 tags：优先按备份 ID 还原具体节点，旧备份再按体系和名字兜底。 */
async function connectErrorItemTags(ctx: ImportContext, createdId: string, item: NormalizedErrorItem): Promise<void> {
    const { tx, tagIdMap, systemTagIdMap, subjectTagSetMap, tagBySetAndName, tagNameMap, stats } = ctx;
    const raw = item.raw;
    if (!raw.tags || raw.tags.length === 0) return;
    const itemTagSet = (raw.subjectId && subjectTagSetMap.get(raw.subjectId)) || 'default';
    const tagConnections: { id: string }[] = [];
    for (const tag of raw.tags) {
        if (tagIdMap.has(tag.id)) {
            tagConnections.push({ id: tagIdMap.get(tag.id)! });
        } else if (systemTagIdMap.has(tag.id)) {
            tagConnections.push({ id: systemTagIdMap.get(tag.id)! });
        } else {
            const bySet = tagBySetAndName.get(`${itemTagSet}::${tag.name}`);
            const byName = tagNameMap.get(tag.name);
            const matched = bySet || byName;
            if (matched) {
                tagConnections.push({ id: matched });
            }
        }
    }

    if (tagConnections.length > 0) {
        await tx.errorItem.update({
            where: { id: createdId },
            data: {
                tags: { connect: tagConnections },
            },
        });
        stats.tagsLinked += tagConnections.length;
    }
}

/** 4. 导入 error items */
export async function importErrorItems(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, masteryIds, evaluatedIds, errorItemIdMap, errorItemOwnerMap, subjectIdMap } = ctx;
    await ensureLegacyPaperGroups(ctx);
    for (const item of normalized.errorItems) {
        const { raw } = item;
        const targetUserId = importAll ? raw.userId : user.id;
        errorItemOwnerMap.set(raw.id, targetUserId);
        const newSubjectId = raw.subjectId ? subjectIdMap.get(raw.subjectId) : undefined;

        const duplicate = await findDuplicateQuestion(tx, targetUserId, raw);
        if (duplicate) {
            const existing = await recordDuplicateQuestion(tx, targetUserId, duplicate, raw);
            // 后续复习计划和练习历史映射到原题，保留本次导入的错误快照。
            errorItemIdMap.set(raw.id, existing.id);
            masteryIds.add(existing.id);
            stats.duplicateErrorItems++;
            stats.practiceRecordsCreated++;
            continue;
        }

        // 尽量保留导出数据中的短 ID，冲突时重新生成
        const keepShortId = isShortId(raw.shortId)
            && !(await tx.errorItem.findUnique({ where: { shortId: raw.shortId }, select: { id: true } }));
        const resolvedPaperLevel = await resolvePaperLevel(ctx, targetUserId, raw.paperLevel, item.difficultyStars);

        const created = await tx.errorItem.create({
            data: {
                shortId: keepShortId ? raw.shortId! : await generateUniqueShortId(tx),
                userId: targetUserId,
                subjectId: newSubjectId || undefined,
                originalImageUrl: raw.originalImageUrl || '',
                ocrText: raw.ocrText,
                questionText: raw.questionText,
                answerText: raw.answerText,
                analysis: raw.analysis,
                wrongAnswerText: raw.wrongAnswerText,
                mistakeAnalysis: raw.mistakeAnalysis,
                mistakeStatus: raw.mistakeStatus,
                knowledgePoints: raw.knowledgePoints,
                source: raw.source,
                errorType: raw.errorType,
                userNotes: raw.userNotes,
                masteryLevel: item.masteryLevel,
                gradeSemester: raw.gradeSemester,
                paperLevel: resolvedPaperLevel,
                difficultyStars: item.difficultyStars,
                hasFigure: item.hasFigure,
                figureSvg: item.figureSvg,
                figureScale: item.figureScale,
                figureAlign: item.figureAlign,
                answerSpacePx: item.answerSpacePx,
                geogebraCommands: item.geogebraCommands,
                svgAnimation: item.svgAnimation,
                svgAnimationEn: item.svgAnimationEn,
                lastPractice: item.lastPractice,
                questionType: item.questionType,
                // 掌握概率与评估时间成对保留，缺任一项则导入后重新评估
                ...(item.masteryProbability !== null && item.masteryEvaluatedAt ? {
                    masteryProbability: item.masteryProbability,
                    masteryReason: raw.masteryReason ?? null,
                    masterySource: raw.masterySource === 'ai' || raw.masterySource === 'rule' ? raw.masterySource : null,
                    masteryEvaluatedAt: item.masteryEvaluatedAt,
                } : {}),
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            },
        });
        errorItemIdMap.set(raw.id, created.id);
        if (created.masteryEvaluatedAt) evaluatedIds.add(created.id);
        stats.errorItemsCreated++;

        await connectErrorItemTags(ctx, created.id, item);
    }
}
