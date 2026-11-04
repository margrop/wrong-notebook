import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { exportSpeeches } from "@/lib/tts/speech-cache";
import { sortTagsByParent } from "@/lib/tags/tag-hierarchy";
import { collectExtensions } from "@/lib/backup-extensions";
import { BACKUP_VERSION } from "@/lib/backup/format";
import type { BackupFile } from "@/lib/backup/format";

const logger = createLogger('api:export');

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Not authenticated");
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
    });

    if (!user) {
        return unauthorized("User not found");
    }

    const { searchParams } = new URL(req.url);
    const exportAll = searchParams.get('all') === 'true';

    // 只有管理员可以导出全部数据
    if (exportAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    try {
        const userFilter = exportAll ? {} : { userId: user.id };

        const subjects = await prisma.subject.findMany({
            where: userFilter,
        });

        // 系统标签按 tagSet 分组导出，避免不同体系的系统标签混淆
        const systemTags = await prisma.knowledgeTag.findMany({
            where: {
                isSystem: true,
            },
        });
        const customTags = await prisma.knowledgeTag.findMany({
            where: {
                ...userFilter,
                isSystem: false,
            },
        });

        const errorItems = await prisma.errorItem.findMany({
            where: userFilter,
            include: {
                tags: true,
            },
        });

        const reviewSchedules = await prisma.reviewSchedule.findMany({
            where: exportAll
                ? { errorItem: { userId: { not: undefined } } }
                : { errorItem: { userId: user.id } },
        });

        const practiceRecords = await prisma.practiceRecord.findMany({
            where: userFilter,
        });

        const examPapers = await prisma.examPaper.findMany({
            where: userFilter,
            include: {
                questions: { orderBy: { order: 'asc' } },
            },
        });

        const paperGroups = await prisma.paperGroup.findMany({
            where: userFilter,
        });

        // 未完成的多题批次（分题草稿、分题失败、已开始但仍有题未入库），version 6 起导出
        const importBatches = await prisma.importBatch.findMany({
            where: { ...userFilter, OR: [{ status: { not: 'started' } }, { tasks: { some: { status: { not: 'saved' } } } }] },
            select: {
                id: true, clientRequestId: true, userId: true, source: true, splitter: true, status: true, mode: true, language: true,
                subjectId: true, targetSubjectId: true, paperLevel: true, sourceText: true, imageData: true, imageInfo: true, draft: true,
                error: true, attempts: true, createdAt: true, startedAt: true, finishedAt: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        // 尚未处理的识别导入任务（待校对草稿、失败可重试的任务）；单独的已保存任务只是记录，不导出。
        // 未完成批次中已保存的题一并导出（含所关联的错题），恢复后批次的题数、已保存数与题目链接保持不变
        const importTasks = await prisma.importTask.findMany({
            where: { ...userFilter, OR: [{ status: { not: 'saved' } }, { batchId: { in: importBatches.map((batch) => batch.id) } }] },
            select: {
                id: true, clientRequestId: true, userId: true, mode: true, status: true, language: true, subjectId: true, targetSubjectId: true,
                paperLevel: true, imageData: true, imageInfo: true, result: true, error: true, timings: true,
                attempts: true, createdAt: true, finishedAt: true, batchId: true, batchItemKey: true, inputText: true,
                errorItemId: true, duplicate: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        // 与动画讲解文字一致的云端语音（MP3），导入后无需重新合成
        const ttsSpeeches = await exportSpeeches(errorItems.flatMap((item) => [
            ...(item.svgAnimation ? [{ language: 'zh' as const, svg: item.svgAnimation }] : []),
            ...(item.svgAnimationEn ? [{ language: 'en' as const, svg: item.svgAnimationEn }] : []),
        ]));

        // fork 项目注册的扩展数据（上游为空对象），导出文件版本 7 起携带
        const extensions = await collectExtensions({ userIds: exportAll ? null : [user.id] });

        const exportData = {
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            scope: exportAll ? 'all' : 'user',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                educationStage: user.educationStage,
                enrollmentYear: user.enrollmentYear,
                gradeRecognitionMode: user.gradeRecognitionMode,
                fixedGradeSemester: user.fixedGradeSemester,
                role: user.role,
                confirmBeforeImport: user.confirmBeforeImport,
                questionDuplicateThreshold: user.questionDuplicateThreshold,
                masteryThreshold: user.masteryThreshold,
                enableGeogebra: user.enableGeogebra,
                enableSvgAnimation: user.enableSvgAnimation,
                themePreference: user.themePreference,
            },
            subjects,
            systemTags: sortTagsByParent(systemTags),
            customTags: sortTagsByParent(customTags),
            errorItems: errorItems.map((item) => ({
                ...item,
                figureScale: normalizeFigureScale(item.figureScale),
                figureAlign: normalizeFigureAlign(item.figureAlign),
                answerSpacePx: normalizeCustomAnswerSpacePx(item.answerSpacePx),
            })),
            reviewSchedules,
            practiceRecords,
            examPapers: examPapers.map((paper) => ({
                ...paper,
                questions: paper.questions.map((question) => ({
                    ...question,
                    figureScale: normalizeFigureScale(question.figureScale),
                    figureAlign: normalizeFigureAlign(question.figureAlign),
                    answerSpacePx: normalizeCustomAnswerSpacePx(question.answerSpacePx),
                })),
            })),
            paperGroups,
            ttsSpeeches,
            importTasks,
            importBatches,
            extensions,
        } satisfies BackupFile;

        logger.info({
            userId: user.id,
            scope: exportAll ? 'all' : 'user',
            subjectsCount: subjects.length,
            systemTagsCount: systemTags.length,
            customTagsCount: customTags.length,
            errorItemsCount: errorItems.length,
            reviewSchedulesCount: reviewSchedules.length,
            practiceRecordsCount: practiceRecords.length,
            examPapersCount: examPapers.length,
            importTasksCount: importTasks.length,
            importBatchesCount: importBatches.length,
            ttsSpeechesCount: ttsSpeeches.length,
        }, 'Data export completed');

        const jsonString = JSON.stringify(exportData, null, 2);
        const filename = exportAll
            ? `wrong-notebook-export-all-${formatDateTime(new Date(), 'yyyy-MM-dd', getAppTimeZone())}.json`
            : `wrong-notebook-export-${formatDateTime(new Date(), 'yyyy-MM-dd', getAppTimeZone())}.json`;

        return new NextResponse(jsonString, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        logger.error({ error, userId: user.id }, 'Export failed');
        return internalError("Failed to export data");
    }
}
