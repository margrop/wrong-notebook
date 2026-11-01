import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { badRequest, forbidden, internalError, unauthorized } from "@/lib/api-errors";
import { CNM_MAX_FILE_BYTES, cnmTopicsSchema, getCnmStatus, importCnmTopics } from "@/lib/cnm-tags";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger('api:admin:cnm-tags');

export const dynamic = 'force-dynamic';

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: unauthorized() };
    if (!requireAdmin(session)) return { error: forbidden("Admin access required") };
    return { session };
}

/** 查询已导入的人教版课标知识点数量 */
export async function GET() {
    const { error } = await checkAdmin();
    if (error) return error;
    return NextResponse.json(await getCnmStatus(prisma));
}

/** 导入 cn-math-taxonomy 的 topics.json（请求体为 { topics: 文件内容 }），增量写入 cnm 标签体系 */
export async function POST(req: Request) {
    const { error, session } = await checkAdmin();
    if (error) return error;

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > CNM_MAX_FILE_BYTES) return badRequest('CNM_FILE_TOO_LARGE');

    const body: unknown = await req.json().catch(() => null);
    const json = body && typeof body === 'object' && 'topics' in body ? body.topics : null;
    const parsed = cnmTopicsSchema.safeParse(json);
    if (!parsed.success) return badRequest('CNM_INVALID_FORMAT');

    try {
        const result = await importCnmTopics(prisma, parsed.data);
        logger.info({ userId: session.user.id, ...result }, 'CNM tags imported');
        return NextResponse.json({ result, status: await getCnmStatus(prisma) });
    } catch (err) {
        logger.error({ error: err }, 'CNM tags import failed');
        return internalError('CNM_IMPORT_FAILED');
    }
}
