import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { exportSpeeches } from "@/lib/tts/speech-cache";

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

        // 与动画讲解文字一致的云端语音（MP3），导入后无需重新合成
        const ttsSpeeches = await exportSpeeches(errorItems.flatMap((item) => [
            ...(item.svgAnimation ? [{ language: 'zh' as const, svg: item.svgAnimation }] : []),
            ...(item.svgAnimationEn ? [{ language: 'en' as const, svg: item.svgAnimationEn }] : []),
        ]));

        const exportData = {
            version: 2,
            exportedAt: new Date().toISOString(),
            scope: exportAll ? 'all' : 'user',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                educationStage: user.educationStage,
                enrollmentYear: user.enrollmentYear,
                role: user.role,
                confirmBeforeImport: user.confirmBeforeImport,
                questionDuplicateThreshold: user.questionDuplicateThreshold,
                masteryThreshold: user.masteryThreshold,
                enableGeogebra: user.enableGeogebra,
                enableSvgAnimation: user.enableSvgAnimation,
            },
            subjects,
            customTags,
            errorItems,
            reviewSchedules,
            practiceRecords,
            examPapers,
            ttsSpeeches,
        };

        logger.info({
            userId: user.id,
            scope: exportAll ? 'all' : 'user',
            subjectsCount: subjects.length,
            customTagsCount: customTags.length,
            errorItemsCount: errorItems.length,
            reviewSchedulesCount: reviewSchedules.length,
            practiceRecordsCount: practiceRecords.length,
            examPapersCount: examPapers.length,
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
