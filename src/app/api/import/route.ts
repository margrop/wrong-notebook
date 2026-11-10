import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { gunzipSync } from "node:zlib";
import { unauthorized, internalError, badRequest, forbidden, taskAlreadyRunning } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findRunningTask, reserveBackgroundTask } from "@/lib/background-tasks";
import { importSpeeches } from "@/lib/tts/speech-cache";
import { parseBackupFile } from "@/lib/backup/format";
import { MAX_BACKUP_IMPORT_BYTES } from "@/lib/backup/limits";
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
    // 合并其他账号的备份：非本人邮箱时也允许导入，数据全部归到当前账号，偏好设置不还原
    const merge = searchParams.get('merge') === 'true';

    // 只有管理员可以导入全部数据
    if (importAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    try {
        const contentLength = req.headers.get('content-length');
        // 网页导出的备份为 gzip 压缩的 JSON，上传时按压缩后体积判断；解压后再校验一次，避免压缩炸弹
        if (contentLength && parseInt(contentLength, 10) > MAX_BACKUP_IMPORT_BYTES) {
            return badRequest(`Request body too large (max ${MAX_BACKUP_IMPORT_BYTES / (1024 * 1024)}MB)`);
        }

        const raw = Buffer.from(await req.arrayBuffer());
        const gzipped = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
        const decompressed = gzipped ? gunzipSync(raw) : raw;
        if (decompressed.length > MAX_BACKUP_IMPORT_BYTES) {
            return badRequest(`Import file too large after decompression (max ${MAX_BACKUP_IMPORT_BYTES / (1024 * 1024)}MB)`);
        }
        const rawBody: unknown = JSON.parse(decompressed.toString('utf8'));
        const parsed = parseBackupFile(rawBody);
        if (!parsed.success) {
            return badRequest("Invalid import data format");
        }
        const body = parsed.data;

        // 非管理员模式：导出数据属于当前用户，或显式要求合并其他账号的备份
        if (!importAll && body.user.email !== user.email && !merge) {
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
                { timeout: 300000 },
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
                scope: importAll ? 'all' : merge && body.user.email !== user.email ? 'merge' : 'user',
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
