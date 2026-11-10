import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { gzipSync } from "node:zlib";
import { unauthorized, internalError, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { normalizeExamScore } from "@/lib/exam/exam-score";
import { exportSpeeches } from "@/lib/tts/speech-cache";
import { sortTagsByParent } from "@/lib/tags/tag-hierarchy";
import { collectExtensions } from "@/lib/backup-extensions";
import { BACKUP_VERSION } from "@/lib/backup/format";
import type { BackupFile } from "@/lib/backup/format";
import { rowsBucket } from "@/lib/telemetry/schema";
import { recordEvent } from "@/lib/telemetry/server";

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
    // 备份含题目原图与云端语音，网页导出默认请求 gzip 压缩，导入时自动解压
    const compress = searchParams.get('compress') === 'gzip';

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

        const questionBanks = await prisma.questionBank.findMany({
            where: userFilter,
            include: {
                questions: { orderBy: { createdAt: 'asc' } },
            },
        });

        // 待校对任务与未完成批次不再进入备份（第 13 版）：它们带整页图片，只在原设备继续处理
        const importBatches: unknown[] = [];
        const importTasks: unknown[] = [];

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
                    score: normalizeExamScore(question.score ?? null),
                })),
            })),
            paperGroups,
            questionBanks,
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
            questionBanksCount: questionBanks.length,
        }, 'Data export completed');

        void recordEvent("data_exported", { scope: exportAll ? "all" : "user", rows: rowsBucket(errorItems.length) });
        const jsonString = JSON.stringify(exportData, null, 2);
        const body = compress ? gzipSync(Buffer.from(jsonString, 'utf8')) : jsonString;
        const filename = exportAll
            ? `wrong-notebook-export-all-${formatDateTime(new Date(), 'yyyy-MM-dd', getAppTimeZone())}.json`
            : `wrong-notebook-export-${formatDateTime(new Date(), 'yyyy-MM-dd', getAppTimeZone())}.json`;

        return new NextResponse(body, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        logger.error({ error, userId: user.id }, 'Export failed');
        return internalError("Failed to export data", { error, scope: "api:export" });
    }
}
