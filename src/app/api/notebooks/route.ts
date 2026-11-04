import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { badRequest, conflict, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { createNotebookSchema } from "@/lib/schemas/notebooks";
import { stageFromEducationStage, STAGE_SUBJECTS, type NotebookSubject } from "@/lib/notebook-scope";

const logger = createLogger('api:notebooks');

/**
 * GET /api/notebooks
 * 获取用户所有错题本（Subjects）
 */
async function handleGet(_req: Request, { user }: AuthenticatedContext) {
    let notebooks = await prisma.subject.findMany({
        where: {
            userId: user.id,
        },
        include: {
            _count: {
                select: {
                    errorItems: true,
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    // If no notebooks exist, create default ones（学段取用户的教育阶段）
    if (notebooks.length === 0) {
        const stage = stageFromEducationStage(user.educationStage);
        const defaults: { name: string; subjectKey: NotebookSubject }[] = [
            { name: "数学", subjectKey: "math" },
            { name: "英语", subjectKey: "english" },
        ];
        const defaultSubjects = defaults.filter((subject) => STAGE_SUBJECTS[stage].includes(subject.subjectKey));

        await Promise.all(defaultSubjects.map(({ name, subjectKey }) =>
            prisma.subject.create({
                data: {
                    name,
                    stage,
                    subjectKey,
                    userId: user.id,
                }
            })
        ));

        // Fetch again
        notebooks = await prisma.subject.findMany({
            where: {
                userId: user.id,
            },
            include: {
                _count: {
                    select: {
                        errorItems: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    return NextResponse.json(notebooks);
}

export const GET = withUser(async (req, ctx) => {
    try {
        return await handleGet(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error fetching notebooks');
        return internalError("Failed to fetch notebooks");
    }
});

/**
 * POST /api/notebooks
 * 创建新错题本
 */
async function handlePost(req: Request, { user }: AuthenticatedContext) {
    const parsed = createNotebookSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue?.path[0] === 'name') {
            return badRequest("Notebook name is required");
        }
        return badRequest("A valid stage and subject are required");
    }
    const { name, stage, subjectKey } = parsed.data;
    // 标签体系：非空字符串，默认 default
    const finalTagSet = parsed.data.tagSet?.trim() || 'default';

    // 检查是否已存在同名错题本
    const existing = await prisma.subject.findUnique({
        where: {
            name_userId: {
                name: name.trim(),
                userId: user.id,
            },
        },
    });

    if (existing) {
        return conflict("Notebook with this name already exists");
    }

    const notebook = await prisma.subject.create({
        data: {
            name: name.trim(),
            stage,
            subjectKey,
            tagSet: finalTagSet,
            userId: user.id,
        },
        include: {
            _count: {
                select: {
                    errorItems: true,
                },
            },
        },
    });

    return NextResponse.json(notebook, { status: 201 });
}

export const POST = withUser(async (req, ctx) => {
    try {
        return await handlePost(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error creating notebook');
        return internalError("Failed to create notebook");
    }
});
