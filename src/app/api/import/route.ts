import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, badRequest, forbidden, taskAlreadyRunning } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findRunningTask, reserveBackgroundTask } from "@/lib/background-tasks";
import { importSpeeches } from "@/lib/tts/speech-cache";
import { parseBackupFile } from "@/lib/backup/format";
import { normalizeBackupForImport } from "@/lib/backup/import-parser";
import { importBackupData, scheduleImportMasteryEvaluation } from "@/lib/backup/import-writer";
import { rowsBucket } from "@/lib/telemetry/schema";
import { recordEvent } from "@/lib/telemetry/server";

const logger = createLogger('api:import');

export async function POST(req: Request) {
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
    const importAll = searchParams.get('all') === 'true';

    // 只有管理员可以导入全部数据
    if (importAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
            return badRequest("Request body too large (max 50MB)");
        }

        const rawBody: unknown = await req.json();
        const parsed = parseBackupFile(rawBody);
        if (!parsed.success) {
            return badRequest("Invalid import data format");
        }
        const body = parsed.data;

        // 非管理员模式：验证导出数据属于当前用户
        if (!importAll && body.user.email !== user.email) {
            return badRequest("Import data does not belong to current user");
        }

        const normalized = normalizeBackupForImport(body, body.user.email === user.email);

        // 按目标防重复：同一用户同一时刻只允许一个数据导入任务（reserve 失败返回 409，不写库）
        const target = `user:${user.id}:data-import`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'data_import',
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'data_import', startedAt: '', target });
        }

        try {
            // 使用事务确保数据一致性
            const { stats, masteryIds } = await prisma.$transaction(
                (tx) => importBackupData({ tx, user, importAll, normalized }),
                { timeout: 60000 },
            );

            scheduleImportMasteryEvaluation(masteryIds);
            // 语音缓存不在数据库中，数据导入成功后再写入；失败只记录日志，不影响已导入的数据
            stats.ttsSpeechesImported = await importSpeeches(body.ttsSpeeches).catch((error: unknown) => {
                logger.warn({ error }, 'Failed to import TTS speeches');
                return 0;
            });
            handle.succeed();

            logger.info({
                userId: user.id,
                scope: importAll ? 'all' : 'user',
                ...stats,
            }, 'Data import completed');

            void recordEvent("data_imported", { rows: rowsBucket(stats.errorItemsCreated) });
            return NextResponse.json({
                success: true,
                stats,
            });
        } catch (error) {
            handle.fail(error);
            throw error;
        }
    } catch (error) {
        logger.error({ error, userId: user.id }, 'Import failed');
        return internalError("Failed to import data", { error, scope: "api:import" });
    }
}
